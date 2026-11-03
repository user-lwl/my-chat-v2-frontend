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
  console.error('请复制 config.example.json 为 config.json 并填写配置');
  process.exit(1);
}

// 环境变量优先（建议生产环境用环境变量注入，避免密钥落盘）
if (process.env.DEEPSEEK_API_KEY) {
  config.deepseek = config.deepseek || {};
  config.deepseek.apiKey = process.env.DEEPSEEK_API_KEY;
}
if (process.env.DEEPSEEK_BASE_URL) {
  config.deepseek.baseUrl = process.env.DEEPSEEK_BASE_URL;
}
if (process.env.DB_PASSWORD && config.database) {
  config.database.password = process.env.DB_PASSWORD;
}
if (process.env.PORT) {
  config.server = config.server || {};
  config.server.port = Number(process.env.PORT);
}

// 端口配置
const PORT = config.server.port || 3001;

// DeepSeek配置
const DEEPSEEK_API_KEY = config.deepseek.apiKey;
const DEEPSEEK_BASE_URL = config.deepseek.baseUrl;

// 模型映射（同时作为白名单：只允许映射表中出现的模型，防止客户端透传任意模型）
const MODEL_MAP = {
  'deepseek-v4-flash': 'deepseek-v4-flash',    // DeepSeek-V4 Flash
  // 'deepseek-v4-pro': 'deepseek-v4-pro'   // DeepSeek-V4 Pro
};

// MIME类型映射（仅用于对外可公开的静态资源类型）
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ============================================================
// 安全配置
// ============================================================

// 静态资源只允许这些后缀，其余一律 404（config.json / server.js / *.md / *.sql 等均不可访问）
const STATIC_ALLOWED_EXT = new Set(Object.keys(MIME_TYPES));
// 即使后缀命中，也禁止访问的文件名（纵深防御）
const STATIC_DENY_FILENAMES = new Set([
  'config.json', 'package.json', 'package-lock.json', 'server.js',
  'config.example.json', 'readme.md'
]);
// 即使后缀命中，也禁止访问的目录（这些目录不对外提供任何静态文件）
const STATIC_DENY_DIRS = ['sql', 'node_modules', '.git', '.trae', 'data', 'logs'];

// 单次请求体上限（1MB），防止超大 body 打满内存
const MAX_BODY_BYTES = 1024 * 1024;
// 单次对话请求允许的消息条数与正文字符总量上限
const MAX_MESSAGE_COUNT = 30;
const MAX_TOTAL_CHARS = 20000;
// 每个用户每日 token 配额（服务端统计，可在 config.json 中覆盖）
const DAILY_TOKEN_QUOTA = Number(
  (config.security && config.security.dailyTokenQuota) || process.env.DAILY_TOKEN_QUOTA || 50000
);

// 频率限制规则：窗口期内的最大请求次数
const RATE_RULES = {
  chat: { windowMs: 60 * 1000, max: 20 },          // 每分钟最多 20 次对话请求
  login: { windowMs: 15 * 60 * 1000, max: 10 },    // 15 分钟最多 10 次登录尝试
  register: { windowMs: 60 * 60 * 1000, max: 5 },  // 每小时最多注册 5 个账号
  default: { windowMs: 60 * 1000, max: 60 }
};

const rateBuckets = new Map();

// 获取客户端 IP（兼容 nginx 反代）
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// 简单的滑动窗口限流，返回 true 表示放行
function checkRateLimit(ruleKey, identity) {
  const rule = RATE_RULES[ruleKey] || RATE_RULES.default;
  const key = ruleKey + ':' + identity;
  const now = Date.now();

  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start >= rule.windowMs) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;

  // 顺手清理过期桶，避免内存无限增长
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (now - v.start > rule.windowMs) rateBuckets.delete(k);
    }
  }

  return bucket.count <= rule.max;
}

// 让 sendJSON 能拿到请求来源，用于输出精确的 CORS 头
function setCorsHeaders(res) {
  const req = res.req;
  const origin = req && req.headers ? req.headers.origin : null;
  if (!origin) return;
  const host = req.headers.host;
  // 同源（或来源与 Host 一致的）才允许携带凭据的跨域请求
  if (host && origin === 'http://' + host) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  } else if (host && origin === 'https://' + host) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
}

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
    // 释放半初始化的连接池，否则后续每次查询都会直连数据库并抛错，
    // 与"内存备选方案"的预期行为不一致
    try {
      if (pool) await pool.end();
    } catch (e) { /* 忽略关闭异常 */ }
    pool = null;
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

// 粗略估算 token 数（中文约 1 字 ≈ 1.3 token，其余约 3 字符 ≈ 1 token）
function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  const chineseChars = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = s.length - chineseChars;
  return Math.ceil(chineseChars * 1.3 + otherChars / 3);
}

// 统计某个用户「今天」已消耗的 token（服务端统计，不信任前端上报）
async function getTodayTokenUsage(userId) {
  if (pool) {
    try {
      const [rows] = await pool.query(
        'SELECT COALESCE(SUM(total_tokens), 0) AS total FROM token_usage WHERE user_id = ? AND created_at >= CURDATE()',
        [userId]
      );
      return Number(rows[0] && rows[0].total) || 0;
    } catch (error) {
      console.error('查询当日用量失败:', error);
      return 0;
    }
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return memoryStorage.tokenUsage
    .filter(r => r.user_id === userId && new Date(r.created_at) >= startOfDay)
    .reduce((sum, r) => sum + r.total_tokens, 0);
}

// 校验并规整客户端传来的消息数组，返回 { ok, message, messages }
function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, message: '消息列表不能为空' };
  }
  if (messages.length > MAX_MESSAGE_COUNT) {
    return { ok: false, message: `单次请求最多 ${MAX_MESSAGE_COUNT} 条消息` };
  }

  let totalChars = 0;
  const cleaned = [];
  for (const item of messages) {
    if (!item || typeof item !== 'object') {
      return { ok: false, message: '消息格式不正确' };
    }
    const role = item.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') {
      return { ok: false, message: '消息角色不合法' };
    }
    if (typeof item.content !== 'string') {
      return { ok: false, message: '消息内容必须是字符串' };
    }
    totalChars += item.content.length;
    if (totalChars > MAX_TOTAL_CHARS) {
      return { ok: false, message: `单次请求总内容不能超过 ${MAX_TOTAL_CHARS} 字符` };
    }
    cleaned.push({ role, content: item.content });
  }

  return { ok: true, messages: cleaned };
}

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

// 解析请求体（带大小上限）
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        const err = new Error('请求体过大');
        err.statusCode = 413;
        reject(err);
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        const err = new Error('请求体不是合法的 JSON');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// 发送JSON响应
function sendJSON(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

// 把上游 HTTP 状态码翻译成用户能看懂的提示（避免把裸数字抛给前端）
function mapUpstreamError(statusCode) {
  switch (statusCode) {
    case 401:
      return 'AI 服务密钥无效，请联系管理员检查配置';
    case 402:
      return 'AI 服务账户余额不足，请联系管理员充值后再试';
    case 429:
      return 'AI 服务当前请求过于频繁，请稍后再试';
    case 500:
    case 502:
    case 503:
      return 'AI 服务暂时不可用，请稍后再试';
    default:
      return `AI 服务调用失败（${statusCode}）`;
  }
}

// 设置Cookie
function setCookie(res, name, value, options = {}) {
  let cookie = `${name}=${value}`;
  if (options.path) cookie += `; Path=${options.path}`;
  if (options.httpOnly) cookie += '; HttpOnly';
  if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;
  cookie += '; SameSite=' + (options.sameSite || 'Lax');
  if (options.secure) cookie += '; Secure';
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
    setCorsHeaders(res);
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Cookie'
    });
    res.end();
    return;
  }
  
  try {
    // 注册接口
    if (pathname === '/api/register' && method === 'POST') {
      // 限制单 IP 注册频率，防止脚本批量注册账号白嫖额度
      if (!checkRateLimit('register', getClientIp(req))) {
        return sendJSON(res, 429, { success: false, message: '注册过于频繁，请稍后再试' });
      }

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
      // 限制登录尝试频率，防止撞库
      if (!checkRateLimit('login', getClientIp(req))) {
        return sendJSON(res, 429, { success: false, message: '登录尝试过于频繁，请 15 分钟后再试' });
      }

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
        httpOnly: true,
        sameSite: 'Lax',
        secure: !!(config.server && config.server.https),
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
    
    // 记录Token消耗接口（已废弃）
    // 说明：原先由前端上报 token 数，数据可被任意伪造/忽略，统计与配额形同虚设。
    // 现在用量在 /api/chat 的响应流结束时由服务端记录，此接口仅保留兼容，不再写库。
    if (pathname === '/api/log-token' && method === 'POST') {
      return sendJSON(res, 200, {
        success: false,
        message: '该接口已废弃，用量由服务端自动统计'
      });
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
      
      if (!model || !messages) {
        return sendJSON(res, 400, { success: false, message: '缺少必要参数' });
      }

      // 1) 频率限制：按用户 + IP 双重限制，防止单账号脚本轰炸
      if (!checkRateLimit('chat', 'u' + session.userId) || !checkRateLimit('chat', getClientIp(req))) {
        return sendJSON(res, 429, { success: false, message: '请求过于频繁，请稍后再试' });
      }

      // 2) 模型白名单：不在映射表里的模型一律拒绝，避免被用来调用更贵的模型
      if (!Object.prototype.hasOwnProperty.call(MODEL_MAP, model)) {
        return sendJSON(res, 400, { success: false, message: '不支持的模型' });
      }

      // 3) 消息规整与长度上限：防止单次请求塞入超长上下文烧额度
      const validated = validateMessages(messages);
      if (!validated.ok) {
        return sendJSON(res, 400, { success: false, message: validated.message });
      }
      const safeMessages = validated.messages;

      // 4) 每日配额：服务端统计当日用量，超限直接拒绝
      const todayUsage = await getTodayTokenUsage(session.userId);
      if (DAILY_TOKEN_QUOTA > 0 && todayUsage >= DAILY_TOKEN_QUOTA) {
        return sendJSON(res, 429, {
          success: false,
          message: `今日额度已用完（${todayUsage}/${DAILY_TOKEN_QUOTA}），请明天再试`
        });
      }

      // 映射模型名称
      const mappedModel = MODEL_MAP[model];
      
      // ---- 对话历史保存与对话记忆逻辑 ----
      // 确定会话ID：若未指定则创建一个新会话
      let convId = conversationId;
      let isNewConversation = false;
      let savedAssistantContent = null;
      let shouldSummarizeAfter = false;
      let allMessagesAfterSave = null;
      let deepSeekMessages = null;
      let upstreamUsage = null;
      
      try {
        // 如果没有 conversationId，创建新会话
        if (!convId) {
          const conv = await createConversation(session.userId, model);
          convId = conv.id;
          isNewConversation = true;
          // 更新标题为第一条用户消息
          const firstUserMsg = safeMessages.find(m => m.role === 'user');
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
        const lastMessage = safeMessages[safeMessages.length - 1];
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
          deepSeekMessages = safeMessages;
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
        messages: (deepSeekMessages && deepSeekMessages.length) ? deepSeekMessages : safeMessages,
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
      setCorsHeaders(res);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Content-Type-Options': 'nosniff'
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
            res.write(`data: ${JSON.stringify({ error: mapUpstreamError(deepseekRes.statusCode) })}\n\n`);
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
                  // 若上游返回了真实 usage，优先采用（配额统计以此为准）
                  if (data.usage && typeof data.usage === 'object') {
                    upstreamUsage = data.usage;
                  }
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
          // 记录本次真实用量（服务端统计，不再依赖前端上报）
          try {
            const inputText = (deepSeekMessages && deepSeekMessages.length ? deepSeekMessages : safeMessages)
              .map(m => m.content).join('\n');
            const inputTokens = (upstreamUsage && typeof upstreamUsage.prompt_tokens === 'number')
              ? upstreamUsage.prompt_tokens
              : estimateTokens(inputText);
            const outputTokens = (upstreamUsage && typeof upstreamUsage.completion_tokens === 'number')
              ? upstreamUsage.completion_tokens
              : estimateTokens(savedAssistantContent);
            await logTokenUsage(session.userId, model, inputTokens, outputTokens);
          } catch (error) {
            console.error('记录Token消耗失败:', error);
          }

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
    const status = error && error.statusCode ? error.statusCode : 500;
    const message = status === 500 ? '服务器内部错误' : error.message;
    return sendJSON(res, status, { success: false, message });
  }
}

// 处理静态文件请求
// 安全策略：只对外提供「前端资源目录 + 可公开后缀」的文件，
// 项目根目录下的 config.json / server.js / sql / 说明文件等一律不可访问。
function handleStaticRequest(req, res, parsedUrl) {
  let requestPath;
  try {
    requestPath = decodeURIComponent(parsedUrl.pathname);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }

  // 处理根路径请求
  if (requestPath === '/') {
    requestPath = '/index.html';
  }

  // 拒绝空字节与路径穿越
  if (requestPath.indexOf('\0') !== -1 || requestPath.split(/[\\/]/).indexOf('..') !== -1) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  // 解析成绝对路径
  const rootDir = __dirname;
  const filePath = path.resolve(rootDir, '.' + path.posix.normalize('/' + requestPath));

  // 必须落在项目目录内（用相对路径判断，避免 /app 与 /application 这类前缀误判）
  const relative = path.relative(rootDir, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  const segments = relative.split(path.sep);

  // 拒绝隐藏文件/隐藏目录（.env、.git、.trae 等）
  if (segments.some(seg => seg.startsWith('.'))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  // 拒绝敏感目录
  if (segments.length > 0 && STATIC_DENY_DIRS.indexOf(segments[0].toLowerCase()) !== -1) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const baseName = path.basename(filePath).toLowerCase();

  // 拒绝敏感文件名
  if (STATIC_DENY_FILENAMES.has(baseName)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  // 只放行白名单后缀（config.json 因此天然不可访问）
  const extname = path.extname(baseName);
  const contentType = MIME_TYPES[extname];
  if (!contentType || !STATIC_ALLOWED_EXT.has(extname)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  // 读取文件
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        console.log(`静态资源读取失败: ${err.code}`);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error');
      }
    } else {
      // 成功响应
      res.writeHead(200, {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin'
      });
      res.end(content);
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
