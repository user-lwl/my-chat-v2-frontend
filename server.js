const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const url = require('url');
const querystring = require('querystring');

// 加载配置文件
let config;
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch (error) {
  console.error('读取配置文件失败:', error.message);
  process.exit(1);
}

// 端口配置
const PORT = config.server.port || 3001;

// DeepSeek配置
const DEEPSEEK_API_KEY = config.deepseek.apiKey;
const DEEPSEEK_BASE_URL = config.deepseek.baseUrl;

// 模型映射
const MODEL_MAP = {
  'deepseek-v4-flash': 'deepseek-v4-flash',    // DeepSeek-V4 Flash
  // 'deepseek-v4-pro': 'deepseek-v4-pro'   // DeepSeek-V4 Pro
};

// MIME类型映射
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

// 数据库配置
const DB_CONFIG = {
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// 会话存储（内存中）
const sessions = new Map();
const SESSION_TIMEOUT = config.server.sessionTimeout || 24 * 60 * 60 * 1000;

// 数据库连接池
let pool;

// 初始化数据库连接
async function initDatabase() {
  try {
    // 创建连接池
    pool = mysql.createPool(DB_CONFIG);
    
    // 测试连接
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    
    console.log('数据库连接成功');
    return true;
  } catch (error) {
    console.error('数据库连接失败:', error.message);
    console.log('将使用内存存储作为备选方案');
    return false;
  }
}

// 内存存储（备选方案）
const memoryStorage = {
  users: [],
  tokenUsage: [],
  conversations: [],
  chatMessages: [],
  nextUserId: 1,
  nextTokenUsageId: 1,
  nextConversationId: 1,
  nextChatMessageId: 1
};

// ============================================================
// 对话历史配置
// ============================================================
// 触发摘要压缩的最大历史消息条数（超过则对最早的旧消息进行摘要压缩）
const SUMMARY_TRIGGER_MESSAGE_COUNT = 8;
// 压缩后保留的最近消息条数（保留最近几条原文）
const SUMMARY_KEEP_RECENT_COUNT = 4;
// 摘要提示词
const SUMMARY_PROMPT = `请对以下对话历史进行简洁、准确的摘要总结，保留关键信息和上下文脉络，使用中文，控制在200字以内，直接输出摘要内容，不要添加任何额外说明或前缀。`;

// 生成会话ID
function generateSessionId() {
  return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 解析请求体
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// 发送JSON响应
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cookie',
    'Access-Control-Allow-Credentials': 'true'
  });
  res.end(JSON.stringify(data));
}

// 设置Cookie
function setCookie(res, name, value, options = {}) {
  let cookie = `${name}=${value}`;
  if (options.path) cookie += `; Path=${options.path}`;
  if (options.httpOnly) cookie += '; HttpOnly';
  if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;
  res.setHeader('Set-Cookie', cookie);
}

// 解析Cookie
function parseCookies(req) {
  const cookieHeader = req.headers.cookie;
  const cookies = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      cookies[name] = value;
    });
  }
  return cookies;
}

// 验证用户
async function authenticateUser(username, password) {
  if (pool) {
    // 使用数据库
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) return null;
    
    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (isValid) {
      return { id: user.id, username: user.username, role: user.role || 'user' };
    }
    return null;
  } else {
    // 使用内存存储
    const user = memoryStorage.users.find(u => u.username === username);
    if (!user) return null;
    
    const isValid = await bcrypt.compare(password, user.password);
    if (isValid) {
      return { id: user.id, username: user.username, role: user.role || 'user' };
    }
    return null;
  }
}

// 创建用户
async function createUser(username, password) {
  const hashedPassword = await bcrypt.hash(password, 10);
  
  if (pool) {
    // 使用数据库
    try {
      const [result] = await pool.query(
        'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
        [username, hashedPassword, 'user']
      );
      return { id: result.insertId, username, role: 'user' };
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw new Error('用户名已存在');
      }
      throw error;
    }
  } else {
    // 使用内存存储
    if (memoryStorage.users.find(u => u.username === username)) {
      throw new Error('用户名已存在');
    }
    
    const user = {
      id: memoryStorage.nextUserId++,
      username,
      password: hashedPassword,
      role: 'user',
      created_at: new Date()
    };
    memoryStorage.users.push(user);
    return { id: user.id, username, role: 'user' };
  }
}

// 记录Token消耗
async function logTokenUsage(userId, model, inputTokens, outputTokens) {
  const totalTokens = inputTokens + outputTokens;
  
  if (pool) {
    // 使用数据库
    await pool.query(
      'INSERT INTO token_usage (user_id, model, input_tokens, output_tokens, total_tokens) VALUES (?, ?, ?, ?, ?)',
      [userId, model, inputTokens, outputTokens, totalTokens]
    );
  } else {
    // 使用内存存储
    memoryStorage.tokenUsage.push({
      id: memoryStorage.nextTokenUsageId++,
      user_id: userId,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      created_at: new Date()
    });
  }
}

// ============================================================
// 对话历史辅助函数
// ============================================================

// 创建对话会话
async function createConversation(userId, model, title) {
  const convTitle = title || '新对话';
  if (pool) {
    const [result] = await pool.query(
      'INSERT INTO conversations (user_id, title, model) VALUES (?, ?, ?)',
      [userId, convTitle, model || 'deepseek-v4-flash']
    );
    return { id: result.insertId, user_id: userId, title: convTitle, model: model || 'deepseek-v4-flash' };
  } else {
    const conv = {
      id: memoryStorage.nextConversationId++,
      user_id: userId,
      title: convTitle,
      model: model || 'deepseek-v4-flash',
      summary: '',
      summary_message_count: 0,
      message_count: 0,
      is_active: 1,
      created_at: new Date(),
      updated_at: new Date()
    };
    memoryStorage.conversations.push(conv);
    return { id: conv.id, user_id: userId, title: convTitle, model: conv.model };
  }
}

// 获取用户的对话列表（按最后活跃时间倒序）
async function listConversations(userId) {
  if (pool) {
    const [rows] = await pool.query(
      `SELECT id, title, model, message_count, updated_at 
       FROM conversations 
       WHERE user_id = ? AND is_active = 1 
       ORDER BY updated_at DESC`,
      [userId]
    );
    return rows;
  } else {
    return memoryStorage.conversations
      .filter(c => c.user_id === userId && c.is_active === 1)
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .map(c => ({ id: c.id, title: c.title, model: c.model, message_count: c.message_count, updated_at: c.updated_at }));
  }
}

// 获取单个对话详情
async function getConversation(conversationId, userId) {
  if (pool) {
    const [rows] = await pool.query(
      'SELECT * FROM conversations WHERE id = ? AND user_id = ? AND is_active = 1',
      [conversationId, userId]
    );
    if (rows.length === 0) return null;
    const conv = rows[0];
    const [msgs] = await pool.query(
      'SELECT id, role, content FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC',
      [conversationId]
    );
    return { conversation: conv, messages: msgs };
  } else {
    const conv = memoryStorage.conversations.find(c => c.id === conversationId && c.user_id === userId && c.is_active === 1);
    if (!conv) return null;
    const msgs = memoryStorage.chatMessages
      .filter(m => m.conversation_id === conversationId)
      .sort((a, b) => a.id - b.id)
      .map(m => ({ id: m.id, role: m.role, content: m.content }));
    return { conversation: conv, messages: msgs };
  }
}

// 获取某会话的所有消息（用于构建多轮对话上下文）
async function getConversationMessages(conversationId) {
  if (pool) {
    const [rows] = await pool.query(
      'SELECT id, role, content FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC',
      [conversationId]
    );
    return rows;
  } else {
    return memoryStorage.chatMessages
      .filter(m => m.conversation_id === conversationId)
      .sort((a, b) => a.id - b.id)
      .map(m => ({ id: m.id, role: m.role, content: m.content }));
  }
}

// 保存一条消息
async function saveMessage(conversationId, role, content) {
  if (pool) {
    await pool.query(
      'INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, ?, ?)',
      [conversationId, role, content]
    );
    await pool.query(
      'UPDATE conversations SET message_count = message_count + 1 WHERE id = ?',
      [conversationId]
    );
  } else {
    memoryStorage.chatMessages.push({
      id: memoryStorage.nextChatMessageId++,
      conversation_id: conversationId,
      role,
      content,
      created_at: new Date()
    });
    const conv = memoryStorage.conversations.find(c => c.id === conversationId);
    if (conv) {
      conv.message_count = (conv.message_count || 0) + 1;
      conv.updated_at = new Date();
    }
  }
}

// 更新对话标题（使用第一条用户消息的前N个字符）
async function updateConversationTitle(conversationId, title) {
  const shortTitle = title.length > 50 ? title.substring(0, 50) + '...' : title;
  if (pool) {
    await pool.query('UPDATE conversations SET title = ? WHERE id = ?', [shortTitle, conversationId]);
  } else {
    const conv = memoryStorage.conversations.find(c => c.id === conversationId);
    if (conv) conv.title = shortTitle;
  }
}

// 保存压缩摘要到会话
async function saveConversationSummary(conversationId, summary, summaryMessageCount) {
  if (pool) {
    await pool.query(
      'UPDATE conversations SET summary = ?, summary_message_count = ? WHERE id = ?',
      [summary, summaryMessageCount, conversationId]
    );
  } else {
    const conv = memoryStorage.conversations.find(c => c.id === conversationId);
    if (conv) {
      conv.summary = summary;
      conv.summary_message_count = summaryMessageCount;
    }
  }
}

// 获取会话的摘要（用于对话记忆）
async function getConversationSummary(conversationId) {
  if (pool) {
    const [rows] = await pool.query(
      'SELECT summary FROM conversations WHERE id = ?',
      [conversationId]
    );
    return rows.length > 0 ? (rows[0].summary || '') : '';
  } else {
    const conv = memoryStorage.conversations.find(c => c.id === conversationId);
    return conv ? (conv.summary || '') : '';
  }
}

// 删除对话（软删除）
async function deleteConversation(conversationId, userId) {
  if (pool) {
    await pool.query(
      'UPDATE conversations SET is_active = 0 WHERE id = ? AND user_id = ?',
      [conversationId, userId]
    );
  } else {
    const conv = memoryStorage.conversations.find(c => c.id === conversationId && c.user_id === userId);
    if (conv) conv.is_active = 0;
  }
}

// 调用 DeepSeek 生成摘要（非流式）
function callDeepSeekForSummary(messages) {
  return new Promise((resolve, reject) => {
    const requestBody = {
      model: MODEL_MAP['deepseek-v4-flash'] || 'deepseek-v4-flash',
      messages: messages,
      stream: false
    };
    
    const deepseekUrl = new url.URL(DEEPSEEK_BASE_URL);
    const chatEndpoint = deepseekUrl.pathname.endsWith('/')
      ? `${deepseekUrl.pathname}chat/completions`
      : `${deepseekUrl.pathname}/chat/completions`;

    const deepseekOptions = {
      hostname: deepseekUrl.hostname,
      port: deepseekUrl.port || 443,
      path: chatEndpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      }
    };

    const req = https.request(deepseekOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`DeepSeek摘要请求失败: ${res.statusCode} ${data}`));
        }
        try {
          const parsed = JSON.parse(data);
          const summary = parsed.choices?.[0]?.message?.content || '';
          resolve(summary.trim());
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(requestBody));
    req.end();
  });
}

// 生成并保存摘要（对旧消息压缩，保留最近消息原文）
async function summarizeConversation(conversationId, allMessages) {
  try {
    // 需要压缩的消息 = 总消息 - 保留的最近消息
    const toSummarize = allMessages.slice(0, Math.max(0, allMessages.length - SUMMARY_KEEP_RECENT_COUNT));
    if (toSummarize.length === 0) return;

    // 获取已有摘要
    const existingSummary = await getConversationSummary(conversationId);

    // 构建用于摘要的消息（已有摘要 + 本次需压缩的旧消息）
    const summarizeMessages = [];
    if (existingSummary) {
      summarizeMessages.push({ role: 'system', content: existingSummary });
    }
    toSummarize.forEach(m => {
      summarizeMessages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content });
    });
    summarizeMessages.push({ role: 'user', content: SUMMARY_PROMPT });

    const summary = await callDeepSeekForSummary(summarizeMessages);

    // 保存摘要及已压缩条数
    const compressedCount = (existingSummary ? toSummarize.length + 0 : toSummarize.length);
    await saveConversationSummary(conversationId, summary, toSummarize.length);
    console.log(`会话 ${conversationId} 已生成摘要`);
  } catch (error) {
    console.error('生成摘要失败:', error.message);
    // 摘要失败不影响对话流程
  }
}

// 处理API请求
async function handleAPIRequest(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;
  
  // 处理CORS预检请求
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Cookie',
      'Access-Control-Allow-Credentials': 'true'
    });
    res.end();
    return;
  }
  
  try {
    // 注册接口
    if (pathname === '/api/register' && method === 'POST') {
      const body = await parseBody(req);
      const { username, password } = body;
      
      if (!username || !password) {
        return sendJSON(res, 400, { success: false, message: '用户名和密码不能为空' });
      }
      
      if (username.length < 3 || username.length > 20) {
        return sendJSON(res, 400, { success: false, message: '用户名长度应为3-20个字符' });
      }
      
      if (password.length < 6) {
        return sendJSON(res, 400, { success: false, message: '密码长度至少为6个字符' });
      }
      
      try {
        const user = await createUser(username, password);
        return sendJSON(res, 200, { success: true, message: '注册成功', user: { id: user.id, username: user.username } });
      } catch (error) {
        return sendJSON(res, 400, { success: false, message: error.message });
      }
    }
    
    // 登录接口
    if (pathname === '/api/login' && method === 'POST') {
      const body = await parseBody(req);
      const { username, password } = body;
      
      if (!username || !password) {
        return sendJSON(res, 400, { success: false, message: '用户名和密码不能为空' });
      }
      
      const user = await authenticateUser(username, password);
      if (!user) {
        return sendJSON(res, 401, { success: false, message: '用户名或密码错误' });
      }
      
      // 创建会话
      const sessionId = generateSessionId();
      sessions.set(sessionId, {
        userId: user.id,
        username: user.username,
        role: user.role || 'user',
        createdAt: Date.now()
      });
      
      // 设置Cookie
      setCookie(res, 'sessionId', sessionId, {
        path: '/',
        httpOnly: false,
        maxAge: SESSION_TIMEOUT / 1000
      });
      
      return sendJSON(res, 200, {
        success: true,
        message: '登录成功',
        user: { id: user.id, username: user.username, role: user.role || 'user' }
      });
    }
    
    // 检查登录状态接口
    if (pathname === '/api/check-auth' && method === 'GET') {
      const cookies = parseCookies(req);
      const sessionId = cookies.sessionId;
      
      if (!sessionId || !sessions.has(sessionId)) {
        return sendJSON(res, 200, { isLoggedIn: false });
      }
      
      const session = sessions.get(sessionId);
      
      // 检查会话是否过期
      if (Date.now() - session.createdAt > SESSION_TIMEOUT) {
        sessions.delete(sessionId);
        return sendJSON(res, 200, { isLoggedIn: false });
      }
      
      return sendJSON(res, 200, {
        isLoggedIn: true,
        user: { id: session.userId, username: session.username, role: session.role || 'user' }
      });
    }
    
    // 管理员获取用户Token统计接口
    if (pathname === '/api/admin/stats' && method === 'GET') {
      const cookies = parseCookies(req);
      const sessionId = cookies.sessionId;
      
      if (!sessionId || !sessions.has(sessionId)) {
        return sendJSON(res, 401, { success: false, message: '未登录' });
      }
      
      const session = sessions.get(sessionId);
      
      // 检查是否是管理员
      if (session.role !== 'admin') {
        return sendJSON(res, 403, { success: false, message: '无权限访问' });
      }
      
      try {
        let stats;
        
        if (pool) {
          // 使用数据库查询
          const [rows] = await pool.query(`
            SELECT 
              u.id as user_id,
              u.username,
              u.role,
              COALESCE(SUM(tu.input_tokens), 0) as total_input_tokens,
              COALESCE(SUM(tu.output_tokens), 0) as total_output_tokens,
              COALESCE(SUM(tu.total_tokens), 0) as total_tokens,
              COUNT(tu.id) as usage_count
            FROM users u
            LEFT JOIN token_usage tu ON u.id = tu.user_id
            GROUP BY u.id, u.username, u.role
            ORDER BY total_tokens DESC
          `);
          stats = rows;
        } else {
          // 使用内存存储
          stats = memoryStorage.users.map(user => {
            const userUsage = memoryStorage.tokenUsage.filter(tu => tu.user_id === user.id);
            return {
              user_id: user.id,
              username: user.username,
              role: user.role || 'user',
              total_input_tokens: userUsage.reduce((sum, tu) => sum + (tu.input_tokens || 0), 0),
              total_output_tokens: userUsage.reduce((sum, tu) => sum + (tu.output_tokens || 0), 0),
              total_tokens: userUsage.reduce((sum, tu) => sum + (tu.total_tokens || 0), 0),
              usage_count: userUsage.length
            };
          }).sort((a, b) => b.total_tokens - a.total_tokens);
        }
        
        return sendJSON(res, 200, { success: true, data: stats });
      } catch (error) {
        console.error('获取统计数据失败:', error);
        return sendJSON(res, 500, { success: false, message: '获取统计数据失败' });
      }
    }
    
    // 登出接口
    if (pathname === '/api/logout' && method === 'POST') {
      const cookies = parseCookies(req);
      const sessionId = cookies.sessionId;
      
      if (sessionId) {
        sessions.delete(sessionId);
      }
      
      // 清除Cookie
      setCookie(res, 'sessionId', '', {
        path: '/',
        maxAge: 0
      });
      
      return sendJSON(res, 200, { success: true, message: '登出成功' });
    }
    
    // 记录Token消耗接口
    if (pathname === '/api/log-token' && method === 'POST') {
      const cookies = parseCookies(req);
      const sessionId = cookies.sessionId;
      
      if (!sessionId || !sessions.has(sessionId)) {
        return sendJSON(res, 401, { success: false, message: '未登录' });
      }
      
      const session = sessions.get(sessionId);
      const body = await parseBody(req);
      const { model, inputTokens, outputTokens } = body;
      
      if (!model || inputTokens === undefined || outputTokens === undefined) {
        return sendJSON(res, 400, { success: false, message: '缺少必要参数' });
      }
      
      try {
        await logTokenUsage(session.userId, model, inputTokens, outputTokens);
        return sendJSON(res, 200, { success: true, message: 'Token消耗已记录' });
      } catch (error) {
        return sendJSON(res, 500, { success: false, message: '记录失败: ' + error.message });
      }
    }
    
    // 创建新对话接口
    if (pathname === '/api/conversations' && method === 'POST') {
      const cookies = parseCookies(req);
      const sessionId = cookies.sessionId;
      
      if (!sessionId || !sessions.has(sessionId)) {
        return sendJSON(res, 401, { success: false, message: '未登录' });
      }
      
      const session = sessions.get(sessionId);
      const body = await parseBody(req);
      const { model, title } = body;
      
      try {
        const conversation = await createConversation(session.userId, model, title);
        return sendJSON(res, 200, { success: true, data: conversation });
      } catch (error) {
        console.error('创建对话失败:', error);
        return sendJSON(res, 500, { success: false, message: '创建对话失败: ' + error.message });
      }
    }
    
    // 获取对话列表接口
    if (pathname === '/api/conversations' && method === 'GET') {
      const cookies = parseCookies(req);
      const sessionId = cookies.sessionId;
      
      if (!sessionId || !sessions.has(sessionId)) {
        return sendJSON(res, 401, { success: false, message: '未登录' });
      }
      
      const session = sessions.get(sessionId);
      
      try {
        const conversations = await listConversations(session.userId);
        return sendJSON(res, 200, { success: true, data: conversations });
      } catch (error) {
        console.error('获取对话列表失败:', error);
        return sendJSON(res, 500, { success: false, message: '获取对话列表失败: ' + error.message });
      }
    }
    
    // 获取单个对话详情接口
    if (pathname.startsWith('/api/conversations/') && method === 'GET') {
      const cookies = parseCookies(req);
      const sessionId = cookies.sessionId;
      
      if (!sessionId || !sessions.has(sessionId)) {
        return sendJSON(res, 401, { success: false, message: '未登录' });
      }
      
      const session = sessions.get(sessionId);
      const conversationId = parseInt(pathname.split('/')[3], 10);
      
      if (!conversationId) {
        return sendJSON(res, 400, { success: false, message: '对话ID无效' });
      }
      
      try {
        const data = await getConversation(conversationId, session.userId);
        if (!data) {
          return sendJSON(res, 404, { success: false, message: '对话不存在' });
        }
        return sendJSON(res, 200, { success: true, data });
      } catch (error) {
        console.error('获取对话详情失败:', error);
        return sendJSON(res, 500, { success: false, message: '获取对话详情失败: ' + error.message });
      }
    }
    
    // 删除对话接口
    if (pathname.startsWith('/api/conversations/') && method === 'DELETE') {
      const cookies = parseCookies(req);
      const sessionId = cookies.sessionId;
      
      if (!sessionId || !sessions.has(sessionId)) {
        return sendJSON(res, 401, { success: false, message: '未登录' });
      }
      
      const session = sessions.get(sessionId);
      const conversationId = parseInt(pathname.split('/')[3], 10);
      
      if (!conversationId) {
        return sendJSON(res, 400, { success: false, message: '对话ID无效' });
      }
      
      try {
        await deleteConversation(conversationId, session.userId);
        return sendJSON(res, 200, { success: true, message: '删除成功' });
      } catch (error) {
        console.error('删除对话失败:', error);
        return sendJSON(res, 500, { success: false, message: '删除对话失败: ' + error.message });
      }
    }
    
    // 聊天API接口（代理DeepSeek，支持对话记忆与摘要压缩）
    if (pathname === '/api/chat' && method === 'POST') {
      const cookies = parseCookies(req);
      const sessionId = cookies.sessionId;
      
      if (!sessionId || !sessions.has(sessionId)) {
        return sendJSON(res, 401, { success: false, message: '未登录' });
      }
      
      const session = sessions.get(sessionId);
      const body = await parseBody(req);
      const { model, messages, conversationId } = body;
      
      if (!model || !messages || !Array.isArray(messages) || messages.length === 0) {
        return sendJSON(res, 400, { success: false, message: '缺少必要参数' });
      }
      
      // 映射模型名称
      const mappedModel = MODEL_MAP[model] || model;
      
      // ---- 对话历史保存与对话记忆逻辑 ----
      // 确定会话ID：若未指定则创建一个新会话
      let convId = conversationId;
      let isNewConversation = false;
      let savedAssistantContent = null;
      let shouldSummarizeAfter = false;
      let allMessagesAfterSave = null;
      let deepSeekMessages = null;
      
      try {
        // 如果没有 conversationId，创建新会话
        if (!convId) {
          const conv = await createConversation(session.userId, model);
          convId = conv.id;
          isNewConversation = true;
          // 更新标题为第一条用户消息
          const firstUserMsg = messages.find(m => m.role === 'user');
          if (firstUserMsg && firstUserMsg.content) {
            await updateConversationTitle(convId, firstUserMsg.content);
          }
        } else {
          // 校验会话归属
          const convData = await getConversation(convId, session.userId);
          if (!convData) {
            return sendJSON(res, 403, { success: false, message: '无权访问该对话' });
          }
        }
        
        // 保存用户消息到历史
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role === 'user') {
          await saveMessage(convId, 'user', lastMessage.content);
        }
        
        // 构建发送给DeepSeek的消息（含对话记忆：摘要 + 最近消息）
        // 获取已有摘要作为记忆
        const summary = await getConversationSummary(convId);
        // 获取该会话最近的消息作为上下文（从数据库读取，含刚保存的用户消息）
        allMessagesAfterSave = await getConversationMessages(convId);
        
        if (summary) {
          // 有摘要：使用摘要 + 最近消息（不含已被压缩进摘要的旧消息）
          const recentMessages = allMessagesAfterSave.slice(allMessagesAfterSave.length - SUMMARY_KEEP_RECENT_COUNT);
          deepSeekMessages = [
            { role: 'system', content: `以下是这段对话的早期摘要，请在此基础上继续对话：\n${summary}` },
            ...recentMessages.map(m => ({ role: m.role, content: m.content }))
          ];
        } else {
          // 无摘要：直接使用全部消息
          deepSeekMessages = messages;
        }
        
        // 判断是否需要压缩（消息条数达到阈值）
        if (allMessagesAfterSave.length >= SUMMARY_TRIGGER_MESSAGE_COUNT) {
          shouldSummarizeAfter = true;
        }
      } catch (error) {
        console.error('对话历史处理失败:', error);
      }
      
      // 构建DeepSeek请求
      const requestBody = {
        model: mappedModel,
        messages: (deepSeekMessages && deepSeekMessages.length) ? deepSeekMessages : messages,
        stream: true
      };
      
      // 解析DeepSeek API URL
      const deepseekUrl = new url.URL(DEEPSEEK_BASE_URL);
      const chatEndpoint = deepseekUrl.pathname.endsWith('/') 
        ? `${deepseekUrl.pathname}chat/completions` 
        : `${deepseekUrl.pathname}/chat/completions`;
      
      const deepseekOptions = {
        hostname: deepseekUrl.hostname,
        port: deepseekUrl.port || 443,
        path: chatEndpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        }
      };
      
      // 发送流式响应头
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': 'true'
      });
      
      // 向DeepSeek发送请求
      const deepseekReq = https.request(deepseekOptions, (deepseekRes) => {
        if (deepseekRes.statusCode !== 200) {
          let errorData = '';
          deepseekRes.on('data', (chunk) => {
            errorData += chunk;
          });
          deepseekRes.on('end', () => {
            console.error('DeepSeek API错误:', deepseekRes.statusCode, errorData);
            res.write(`data: ${JSON.stringify({ error: `API请求失败: ${deepseekRes.statusCode}` })}\n\n`);
            res.end();
          });
          return;
        }
        
        // 代理DeepSeek的流式响应
        deepseekRes.on('data', (chunk) => {
          // 解析流式数据，提取助手回复内容（用于保存到历史）
          const chunkStr = chunk.toString();
          const lines = chunkStr.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const dataStr = line.substring(5).trim();
              if (dataStr && dataStr !== '[DONE]') {
                try {
                  const data = JSON.parse(dataStr);
                  const delta = data.choices?.[0]?.delta;
                  if (delta && delta.content && typeof delta.content === 'string') {
                    savedAssistantContent = (savedAssistantContent || '') + delta.content;
                  }
                } catch (e) {
                  // 忽略解析错误
                }
              }
            }
          }
          res.write(chunk);
        });
        
        deepseekRes.on('end', async () => {
          // 保存助手回复到历史
          if (convId && savedAssistantContent) {
            try {
              await saveMessage(convId, 'assistant', savedAssistantContent);
              
              // 如果需要压缩摘要，异步进行（不影响响应）
              if (shouldSummarizeAfter && allMessagesAfterSave) {
                // 异步触发，不阻塞响应
                setTimeout(async () => {
                  const msgs = await getConversationMessages(convId);
                  await summarizeConversation(convId, msgs);
                }, 0);
              }
            } catch (error) {
              console.error('保存助手消息失败:', error);
            }
          }
          // 发送会话ID事件，供前端识别当前对话
          if (convId) {
            res.write(`data: ${JSON.stringify({ conversation_id: convId })}\n\n`);
          }
          res.end();
        });
        
        deepseekRes.on('error', (error) => {
          console.error('DeepSeek响应错误:', error);
          res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
          res.end();
        });
      });
      
      deepseekReq.on('error', (error) => {
        console.error('DeepSeek请求错误:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      });
      
      deepseekReq.write(JSON.stringify(requestBody));
      deepseekReq.end();
      
      return;
    }
    
    // 404
    return sendJSON(res, 404, { success: false, message: '接口不存在' });
    
  } catch (error) {
    console.error('API请求错误:', error);
    return sendJSON(res, 500, { success: false, message: '服务器内部错误' });
  }
}

// 处理静态文件请求
function handleStaticRequest(req, res, parsedUrl) {
  let filePath = parsedUrl.pathname;
  
  // 处理根路径请求
  if (filePath === '/') {
    filePath = '/index.html';
  }
  
  // 构建文件路径
  filePath = path.join(__dirname, filePath);
  
  // 安全检查：防止目录遍历
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('403 Forbidden');
    return;
  }
  
  // 获取文件扩展名
  const extname = path.extname(filePath);
  
  // 设置内容类型
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';
  
  // 读取文件
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // 文件不存在
        console.log(`文件不存在: ${filePath}`);
        res.writeHead(404);
        res.end('404 Not Found');
      } else {
        // 服务器错误
        console.log(`服务器错误: ${err.code}`);
        res.writeHead(500);
        res.end(`服务器错误: ${err.code}`);
      }
    } else {
      // 成功响应
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
}

// 创建HTTP服务器
const server = http.createServer(async (req, res) => {
  console.log(`请求: ${req.method} ${req.url}`);
  
  try {
    const parsedUrl = url.parse(req.url, true);
    
    // 处理API请求
    if (parsedUrl.pathname.startsWith('/api/')) {
      await handleAPIRequest(req, res, parsedUrl);
    } else {
      // 处理静态文件请求
      handleStaticRequest(req, res, parsedUrl);
    }
  } catch (error) {
    console.error('服务器错误:', error);
    res.writeHead(500);
    res.end('服务器内部错误');
  }
});

// 启动服务器
async function startServer() {
  // 初始化数据库
  await initDatabase();
  
  // 启动服务器
  server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}/`);
    console.log('按 Ctrl+C 停止服务器');
  });
}

// 启动
startServer();
