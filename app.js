/**
 * DeepSeek Chat 应用
 * 一个简洁的AI聊天界面，支持多种模型和代码高亮
 */

// 全局变量
var isProcessing = false;
var conversationHistory = [];
var currentUser = null;
var isLoggedIn = false;

// DOM 元素
var elements = {
  chatInput: document.getElementById('chat-input'),
  sendButton: document.getElementById('send-button'),
  messagesContainer: document.getElementById('messages'),
  modelSelect: document.getElementById('model-select'),
  loadingIndicator: document.getElementById('loading'),
  // 用户认证相关元素
  loginButton: document.getElementById('login-button'),
  userInfo: document.getElementById('user-info'),
  usernameDisplay: document.getElementById('username-display'),
  logoutButton: document.getElementById('logout-button'),
  authModal: document.getElementById('auth-modal'),
  closeModal: document.getElementById('close-modal'),
  // 登录表单
  loginForm: document.getElementById('login-form'),
  loginUsername: document.getElementById('login-username'),
  loginPassword: document.getElementById('login-password'),
  submitLogin: document.getElementById('submit-login'),
  loginError: document.getElementById('login-error'),
  // 注册表单
  registerForm: document.getElementById('register-form'),
  registerUsername: document.getElementById('register-username'),
  registerPassword: document.getElementById('register-password'),
  registerConfirmPassword: document.getElementById('register-confirm-password'),
  submitRegister: document.getElementById('submit-register'),
  registerError: document.getElementById('register-error'),
  // 表单切换
  switchToRegister: document.getElementById('switch-to-register'),
  switchToLogin: document.getElementById('switch-to-login'),
  // 管理员统计页面
  adminStatsButton: document.getElementById('admin-stats-button'),
  statsModal: document.getElementById('stats-modal'),
  closeStats: document.getElementById('close-stats'),
  statsTableBody: document.getElementById('stats-table-body'),
  totalUsers: document.getElementById('total-users'),
  totalTokens: document.getElementById('total-tokens'),
  totalUsage: document.getElementById('total-usage')
};

// API基础URL
const API_BASE = '';

// 初始化应用
document.addEventListener('DOMContentLoaded', async () => {
  // 初始化Markdown解析库
  initMarked();
  
  // 加载KaTeX库
  loadKaTeX();
  
  // 设置事件监听器
  setupEventListeners();
  
  // 检查登录状态
  await checkAuthStatus();
  
  // 更新UI状态
  updateAuthUI();
});

// 初始化marked库
function initMarked() {
  if (typeof marked !== 'undefined') {
    // 配置marked - 使用默认渲染器，避免自定义渲染器的问题
    marked.setOptions({
      breaks: true,           // 支持换行
      gfm: true,              // 支持GitHub风格的Markdown
      tables: true,           // 支持表格
      taskLists: true,        // 支持任务列表
      smartLists: true,       // 智能列表
      smartypants: true,      // 智能标点
    });
  }
}

// 动态加载KaTeX库
function loadKaTeX() {
  // 加载KaTeX CSS
  const katexCSS = document.createElement('link');
  katexCSS.rel = 'stylesheet';
  katexCSS.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css';
  katexCSS.integrity = 'sha384-GvrOXuhMATgEsSwCs4smul74iXGOixntILdUW9XmUC6+HX0sLNAK3q71HotJqlAn';
  katexCSS.crossOrigin = 'anonymous';
  document.head.appendChild(katexCSS);
  
  // 加载KaTeX JS
  const katexJS = document.createElement('script');
  katexJS.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js';
  katexJS.integrity = 'sha384-cpW21h6RZv/phavutF+AuVYrr+dA8xD9zs6FwLpaCct6O9ctzYFfFr4dgmgccOTx';
  katexJS.crossOrigin = 'anonymous';
  katexJS.defer = true;
  document.head.appendChild(katexJS);
  
  // 添加数学公式块的样式
  const style = document.createElement('style');
  style.textContent = `
    .math-block {
      background-color: #f9f9f9;
      padding: 10px;
      border-radius: 0 0 5px 5px;
      margin: 0 0 10px 0;
      overflow-x: auto;
      text-align: center;
    }
    
    .math-title {
      background-color: #e9e9e9;
      padding: 5px 10px;
      border-top-left-radius: 5px;
      border-top-right-radius: 5px;
      font-size: 0.8em;
      color: #555;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0;
    }
    
    .inline-math {
      display: inline-block;
      vertical-align: middle;
    }
  `;
  document.head.appendChild(style);
}

// 设置事件监听器
function setupEventListeners() {
  // 发送按钮点击事件
  elements.sendButton.addEventListener('click', handleSendMessage);
  
  // 输入框按键事件（Ctrl+Enter发送）
  elements.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });
  
  // 输入框自动调整高度
  elements.chatInput.addEventListener('input', adjustTextareaHeight);
  
  // 用户认证相关事件监听器
  elements.loginButton.addEventListener('click', showLoginModal);
  elements.logoutButton.addEventListener('click', handleLogout);
  elements.closeModal.addEventListener('click', closeAuthModal);
  
  // 表单切换
  elements.switchToRegister.addEventListener('click', showRegisterForm);
  elements.switchToLogin.addEventListener('click', showLoginForm);
  
  // 登录提交
  elements.submitLogin.addEventListener('click', handleLogin);
  elements.loginPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLogin();
    }
  });
  
  // 注册提交
  elements.submitRegister.addEventListener('click', handleRegister);
  elements.registerConfirmPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRegister();
    }
  });
  
  // 管理员统计页面
  elements.adminStatsButton.addEventListener('click', openStatsModal);
  elements.closeStats.addEventListener('click', closeStatsModal);
}

// 检查登录状态
async function checkAuthStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/check-auth`, {
      method: 'GET',
      credentials: 'include'
    });
    const data = await response.json();
    
    if (data.isLoggedIn && data.user) {
      isLoggedIn = true;
      currentUser = data.user;
    }
  } catch (error) {
    console.error('检查登录状态失败:', error);
  }
}

// 更新认证相关UI
function updateAuthUI() {
  if (isLoggedIn && currentUser) {
    // 已登录状态
    elements.loginButton.style.display = 'none';
    elements.userInfo.style.display = 'flex';
    elements.usernameDisplay.textContent = currentUser.username;
    
    // 检查是否是管理员，显示/隐藏统计按钮
    if (currentUser.role === 'admin') {
      elements.adminStatsButton.style.display = 'inline-block';
    } else {
      elements.adminStatsButton.style.display = 'none';
    }
    
    // 启用聊天功能
    enableChat();
    
    // 显示欢迎消息（包含用户名和角色标识）
    if (!window.__welcomeDisplayed) {
      const roleText = currentUser.role === 'admin' ? '（管理员）' : '';
      displayBotMessage(`👋 你好，${currentUser.username}${roleText}！我是 DeepSeek AI 助手，有什么我可以帮助你的吗？`);
      window.__welcomeDisplayed = true;
    }
  } else {
    // 未登录状态
    elements.loginButton.style.display = 'block';
    elements.userInfo.style.display = 'none';
    
    // 禁用聊天功能
    disableChat();
    
    // 显示未登录提示
    if (!window.__welcomeDisplayed) {
      showLoginHint();
      window.__welcomeDisplayed = true;
    }
  }
}

// 启用聊天功能
function enableChat() {
  elements.chatInput.disabled = false;
  elements.sendButton.disabled = false;
  elements.chatInput.placeholder = '输入消息...';
  elements.chatInput.parentElement.parentElement.classList.remove('disabled');
}

// 禁用聊天功能
function disableChat() {
  elements.chatInput.disabled = true;
  elements.sendButton.disabled = true;
  elements.chatInput.placeholder = '请先登录后再发送消息...';
  elements.chatInput.parentElement.parentElement.classList.add('disabled');
}

// 显示登录提示
function showLoginHint() {
  const hintElement = document.createElement('div');
  hintElement.className = 'message bot';
  hintElement.innerHTML = `
    <img src="src/bot-avatar.png" alt="Bot">
    <div class="message-content login-hint">
      👋 欢迎使用 My Chat！<br><br>
      请先<strong>登录</strong>后再开始与AI对话。<br>
      点击右上角的<strong>登录</strong>按钮开始使用。
    </div>
  `;
  elements.messagesContainer.appendChild(hintElement);
  scrollToBottom();
}

// 显示登录模态框
function showLoginModal() {
  elements.authModal.style.display = 'flex';
  showLoginForm();
  elements.loginError.style.display = 'none';
  elements.registerError.style.display = 'none';
  elements.loginUsername.focus();
}

// 关闭认证模态框
function closeAuthModal() {
  elements.authModal.style.display = 'none';
  clearAuthForms();
}

// 显示登录表单
function showLoginForm() {
  elements.loginForm.style.display = 'flex';
  elements.registerForm.style.display = 'none';
  elements.loginError.style.display = 'none';
  elements.registerError.style.display = 'none';
  elements.loginUsername.focus();
}

// 显示注册表单
function showRegisterForm() {
  elements.loginForm.style.display = 'none';
  elements.registerForm.style.display = 'flex';
  elements.loginError.style.display = 'none';
  elements.registerError.style.display = 'none';
  elements.registerUsername.focus();
}

// 清空认证表单
function clearAuthForms() {
  elements.loginUsername.value = '';
  elements.loginPassword.value = '';
  elements.registerUsername.value = '';
  elements.registerPassword.value = '';
  elements.registerConfirmPassword.value = '';
  elements.loginError.style.display = 'none';
  elements.registerError.style.display = 'none';
}

// 处理登录
async function handleLogin() {
  const username = elements.loginUsername.value.trim();
  const password = elements.loginPassword.value;
  
  // 验证输入
  if (!username || !password) {
    showAuthError(elements.loginError, '请输入用户名和密码');
    return;
  }
  
  try {
    elements.submitLogin.disabled = true;
    elements.submitLogin.textContent = '登录中...';
    
    const response = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });
    
    const data = await response.json();
    
    if (data.success) {
      isLoggedIn = true;
      currentUser = data.user;
      closeAuthModal();
      
      // 清除之前的提示，显示欢迎消息
      elements.messagesContainer.innerHTML = '';
      window.__welcomeDisplayed = false;
      updateAuthUI();
      
      // 重新聚焦输入框
      elements.chatInput.focus();
    } else {
      showAuthError(elements.loginError, data.message || '登录失败');
    }
  } catch (error) {
    console.error('登录错误:', error);
    showAuthError(elements.loginError, '网络错误，请稍后再试');
  } finally {
    elements.submitLogin.disabled = false;
    elements.submitLogin.textContent = '登录';
  }
}

// 处理注册
async function handleRegister() {
  const username = elements.registerUsername.value.trim();
  const password = elements.registerPassword.value;
  const confirmPassword = elements.registerConfirmPassword.value;
  
  // 验证输入
  if (!username || !password || !confirmPassword) {
    showAuthError(elements.registerError, '请填写所有字段');
    return;
  }
  
  if (username.length < 3 || username.length > 20) {
    showAuthError(elements.registerError, '用户名长度应为3-20个字符');
    return;
  }
  
  if (password.length < 6) {
    showAuthError(elements.registerError, '密码长度至少为6个字符');
    return;
  }
  
  if (password !== confirmPassword) {
    showAuthError(elements.registerError, '两次输入的密码不一致');
    return;
  }
  
  try {
    elements.submitRegister.disabled = true;
    elements.submitRegister.textContent = '注册中...';
    
    const response = await fetch(`${API_BASE}/api/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 注册成功后自动登录
      await handleAutoLogin(username, password);
    } else {
      showAuthError(elements.registerError, data.message || '注册失败');
    }
  } catch (error) {
    console.error('注册错误:', error);
    showAuthError(elements.registerError, '网络错误，请稍后再试');
  } finally {
    elements.submitRegister.disabled = false;
    elements.submitRegister.textContent = '注册';
  }
}

// 自动登录（注册成功后）
async function handleAutoLogin(username, password) {
  try {
    const response = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });
    
    const data = await response.json();
    
    if (data.success) {
      isLoggedIn = true;
      currentUser = data.user;
      closeAuthModal();
      
      // 清除之前的提示，显示欢迎消息
      elements.messagesContainer.innerHTML = '';
      window.__welcomeDisplayed = false;
      updateAuthUI();
      
      // 重新聚焦输入框
      elements.chatInput.focus();
    } else {
      // 登录失败，切换到登录表单
      showLoginForm();
      showAuthError(elements.loginError, '注册成功，请手动登录');
    }
  } catch (error) {
    console.error('自动登录错误:', error);
    showLoginForm();
    showAuthError(elements.loginError, '注册成功，请手动登录');
  }
}

// 处理登出
async function handleLogout() {
  if (!confirm('确定要退出登录吗？')) {
    return;
  }
  
  try {
    await fetch(`${API_BASE}/api/logout`, {
      method: 'POST',
      credentials: 'include'
    });
  } catch (error) {
    console.error('登出错误:', error);
  }
  
  isLoggedIn = false;
  currentUser = null;
  conversationHistory = [];
  
  // 清除聊天记录，显示未登录提示
  elements.messagesContainer.innerHTML = '';
  window.__welcomeDisplayed = false;
  updateAuthUI();
}

// 显示认证错误
function showAuthError(element, message) {
  element.textContent = message;
  element.style.display = 'block';
}

// 处理发送消息
async function handleSendMessage() {
  // 检查登录状态
  if (!isLoggedIn) {
    showLoginModal();
    return;
  }
  
  // 获取用户输入
  const userMessage = elements.chatInput.value.trim();
  
  // 验证输入
  if (!userMessage || isProcessing) return;
  
  // 显示用户消息
  displayUserMessage(userMessage);
  
  // 清空输入框并重置高度
  elements.chatInput.value = '';
  elements.chatInput.style.height = 'auto'; // 直接重置高度，避免间距
  
  // 设置处理状态
  isProcessing = true;
  toggleLoadingState(true);
  
  try {
    // 获取AI回复（流式响应已在fetchAIResponse中显示）
    const result = await fetchAIResponse(userMessage);
    
    // 记录Token消耗
    if (result && result.tokenUsage) {
      await logTokenUsage(result.tokenUsage);
    }
  } catch (error) {
    console.error('Error:', error);
    displayBotMessage('抱歉，发生了错误。请稍后再试。');
  } finally {
    // 重置处理状态
    isProcessing = false;
    toggleLoadingState(false);
    
    // 聚焦到输入框
    elements.chatInput.focus();
  }
}

// 获取AI回复（流式）
async function fetchAIResponse(message) {
  let selectedModel = elements.modelSelect.value;
  
  // 添加到对话历史
  conversationHistory.push({ role: 'user', content: message });
  
  // 创建新的消息元素用于流式显示
  const messageElement = createMessageElement('bot', '', true);
  elements.messagesContainer.appendChild(messageElement);
  const messageContent = messageElement.querySelector('.message-content');
  
  // 在消息内容中添加加载提示
  const loadingElement = document.createElement('div');
  loadingElement.className = 'message-loading';
  loadingElement.innerHTML = `
    <div class="loading-spinner"></div>
    <span>AI正在思考...</span>
  `;
  messageContent.appendChild(loadingElement);
  
  // 记录输入Token的估算
  const inputTokens = estimateTokens(message);
  
  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({
        model: selectedModel,
        messages: conversationHistory
      })
    });
    
    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let buffer = '';  // 用于缓冲不完整的数据
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      // 将新数据添加到缓冲区
      buffer += decoder.decode(value, { stream: true });
      
      // 按SSE格式解析：以 \n\n 分隔消息
      const messages = buffer.split('\n\n');
      
      // 最后一个可能不完整，放回缓冲区
      buffer = messages.pop() || '';
      
      for (const message of messages) {
        if (!message.trim()) continue;
        
        // SSE消息可以包含多行，每行可能是 data: xxx 或 event: xxx 等
        const lines = message.split('\n');
        let dataStr = '';
        
        for (const line of lines) {
          if (line.startsWith('data:')) {
            dataStr += line.substring(5).trim();
          }
        }
        
        if (!dataStr) continue;
        
        if (dataStr === '[DONE]') continue;
        
        try {
          const data = JSON.parse(dataStr);
          
          // 检查是否有错误
          if (data.error) {
            throw new Error(data.error);
          }
          
          // 获取delta内容（可能是content或reasoning_content）
          const delta = data.choices?.[0]?.delta;
          if (delta) {
            // 优先使用content，如果没有则使用reasoning_content
            let content = delta.content;
            let reasoningContent = delta.reasoning_content;
            
            // 确保content是字符串
            if (content && typeof content === 'string') {
              fullResponse += content;
            }
            
            // 处理思考过程（可以选择是否显示）
            if (reasoningContent && typeof reasoningContent === 'string') {
              // 这里可以选择是否显示思考过程，暂时不显示
              // fullResponse += reasoningContent;
            }
            
            // 如果有内容，更新显示
            if ((content || reasoningContent) && fullResponse.trim().length > 0) {
              // 移除加载提示（只在第一次收到内容时）
              if (loadingElement && loadingElement.parentNode) {
                loadingElement.remove();
              }
              
              // 确保fullResponse是字符串
              const fullResponseStr = typeof fullResponse === 'string' ? fullResponse : String(fullResponse);
              messageContent.innerHTML = formatMessage(fullResponseStr, true);
              
              // 应用代码高亮
              if (typeof hljs !== 'undefined') {
                messageContent.querySelectorAll('pre code').forEach(block => {
                  if (!block.classList.contains('hljs')) {
                    try {
                      hljs.highlightElement(block);
                    } catch (e) {
                      // 忽略高亮错误
                    }
                  }
                });
              }
              
              scrollToBottom();
            }
          }
        } catch (e) {
          console.warn('解析流数据出错，跳过:', e);
        }
      }
    }
    
    // 处理缓冲区中剩余的数据（如果有完整的消息）
    if (buffer.trim()) {
      const lines = buffer.split('\n');
      let dataStr = '';
      
      for (const line of lines) {
        if (line.startsWith('data:')) {
          dataStr += line.substring(5).trim();
        }
      }
      
      if (dataStr && dataStr !== '[DONE]') {
        try {
          const data = JSON.parse(dataStr);
          const delta = data.choices?.[0]?.delta;
          if (delta) {
            let content = delta.content;
            let reasoningContent = delta.reasoning_content;
            
            if (content && typeof content === 'string') {
              fullResponse += content;
            }
            
            if ((content || reasoningContent) && fullResponse.trim().length > 0) {
              if (loadingElement && loadingElement.parentNode) {
                loadingElement.remove();
              }
              
              const fullResponseStr = typeof fullResponse === 'string' ? fullResponse : String(fullResponse);
              messageContent.innerHTML = formatMessage(fullResponseStr, true);
              
              // 应用代码高亮
              if (typeof hljs !== 'undefined') {
                messageContent.querySelectorAll('pre code').forEach(block => {
                  if (!block.classList.contains('hljs')) {
                    try {
                      hljs.highlightElement(block);
                    } catch (e) {
                      // 忽略高亮错误
                    }
                  }
                });
              }
              
              scrollToBottom();
            }
          }
        } catch (e) {
          console.warn('处理剩余数据出错:', e);
        }
      }
    }
    
    // 完成时添加到对话历史
    conversationHistory.push({ role: 'assistant', content: fullResponse });
    
    // 估算输出Token
    const outputTokens = estimateTokens(fullResponse);
    
    return {
      content: fullResponse,
      tokenUsage: {
        model: selectedModel,
        inputTokens: inputTokens,
        outputTokens: outputTokens
      }
    };
    
  } catch (error) {
    console.error('API请求错误:', error);
    // 确保出错时也移除加载提示
    if (loadingElement && loadingElement.parentNode) {
      loadingElement.remove();
    }
    messageContent.innerHTML = '抱歉，获取AI回复时出错: ' + 
      (error.message || '未知错误');
    throw error;
  } finally {
    // 确保加载状态被重置
    isProcessing = false;
    toggleLoadingState(false);
  }
}

// 估算Token数量（简化版）
function estimateTokens(text) {
  if (!text) return 0;
  // 简化估算：中文每个字符约1.3个Token，英文每个单词约1个Token
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return Math.ceil(chineseChars * 1.3 + englishWords);
}

// 记录Token消耗
async function logTokenUsage(tokenUsage) {
  if (!isLoggedIn) return;
  
  try {
    await fetch(`${API_BASE}/api/log-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify(tokenUsage)
    });
  } catch (error) {
    console.error('记录Token消耗失败:', error);
  }
}

// 显示用户消息
function displayUserMessage(message) {
  const messageElement = createMessageElement('user', message);
  elements.messagesContainer.appendChild(messageElement);
  scrollToBottom();
}

// 显示AI回复
function displayBotMessage(message) {
  const formattedMessage = formatMessage(message);
  const messageElement = createMessageElement('bot', formattedMessage, true);
  elements.messagesContainer.appendChild(messageElement);
  scrollToBottom();
  
  // 暂时注释掉复制按钮功能
  // setupCodeBlockCopyButtons();
}

// 创建消息元素
function createMessageElement(type, content, isHTML = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  
  // 创建头像
  const avatar = document.createElement('img');
  avatar.src = type === 'user' ? 'src/user-avatar.png' : 'src/bot-avatar.png';
  avatar.alt = type === 'user' ? 'User' : 'Bot';
  
  // 创建消息内容
  const messageContent = document.createElement('div');
  messageContent.className = 'message-content';
  
  if (isHTML) {
    messageContent.innerHTML = content;
  } else {
    messageContent.textContent = content;
  }
  
  // 组装消息
  messageDiv.appendChild(avatar);
  messageDiv.appendChild(messageContent);
  return messageDiv;
}

// 复制代码块
function copyCode(button) {
  const container = button.closest('.code-block-container');
  if (!container) return;
  
  const codeElement = container.querySelector('code');
  if (!codeElement) return;
  
  const code = codeElement.textContent;
  
  // 使用Clipboard API
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code).then(() => {
      const originalText = button.textContent;
      button.textContent = '已复制!';
      button.style.color = '#28a745';
      
      setTimeout(() => {
        button.textContent = originalText;
        button.style.color = '';
      }, 1500);
    }).catch(err => {
      console.error('复制失败:', err);
      // 降级方案
      fallbackCopyCode(code, button);
    });
  } else {
    // 降级方案
    fallbackCopyCode(code, button);
  }
}

// 降级复制方案
function fallbackCopyCode(code, button) {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = code;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    
    const originalText = button.textContent;
    button.textContent = '已复制!';
    button.style.color = '#28a745';
    
    setTimeout(() => {
      button.textContent = originalText;
      button.style.color = '';
    }, 1500);
  } catch (err) {
    console.error('复制失败:', err);
  }
}

// 格式化消息（使用marked库）
function formatMessage(message, isStreaming = false) {
  if (!message) return '';
  
  // 确保message是字符串
  const messageStr = typeof message === 'string' ? message : String(message);
  
  let html = '';
  
  // 使用marked库解析Markdown
  if (typeof marked !== 'undefined') {
    try {
      const parsed = marked.parse(messageStr);
      // 确保返回的是字符串
      if (typeof parsed === 'string') {
        html = parsed;
      } else if (parsed && typeof parsed.toString === 'function') {
        html = parsed.toString();
      } else {
        console.warn('marked.parse返回了非字符串类型:', typeof parsed);
        html = `<p>${escapeHTML(messageStr)}</p>`;
      }
    } catch (error) {
      console.error('Markdown解析失败:', error);
      // 降级处理：直接显示纯文本
      html = `<p>${escapeHTML(messageStr)}</p>`;
    }
  } else {
    // 如果marked未加载，使用简单解析
    html = simpleMarkdownParse(messageStr);
  }
  
  return html;
}

// 简单的Markdown解析（降级方案）
function simpleMarkdownParse(text) {
  if (!text) return '';
  
  // 转义HTML
  let html = escapeHTML(text);
  
  // 处理标题
  html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.*)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.*)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  
  // 处理加粗
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  
  // 处理斜体
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  
  // 处理行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // 处理链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  
  // 处理换行
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

// 转义HTML特殊字符
function escapeHTML(text) {
  if (!text) return '';
  const textStr = typeof text === 'string' ? text : String(text);
  const escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return textStr.replace(/[&<>"']/g, (m) => escapeMap[m]);
}

/*
// 设置代码块复制按钮（暂时注释掉）
function setupCodeBlockCopyButtons() {
  document.querySelectorAll('.code-title').forEach(title => {
    const button = title.querySelector('button');
    if (!button) return;
    
    // 克隆按钮以清除所有事件监听器
    const newButton = button.cloneNode(true);
    button.replaceWith(newButton);
    
    newButton.addEventListener('click', async () => {
      try {
        const codeBlock = title.nextElementSibling;
        const code = codeBlock?.textContent;
        if (!code) return;
        
        await navigator.clipboard.writeText(code);
        
        // 更新按钮状态
        newButton.textContent = '已复制!';
        newButton.style.color = '#4CAF50';
        
        // 1秒后恢复
        setTimeout(() => {
          newButton.textContent = '复制';
          newButton.style.color = '';
        }, 1000);
      } catch (err) {
        console.error('复制失败:', err);
        newButton.textContent = '复制失败';
        newButton.style.color = '#f44336';
        
        setTimeout(() => {
          newButton.textContent = '复制';
          newButton.style.color = '';
        }, 1000);
      }
    });
  });
}
*/

// 调整文本区域高度
function adjustTextareaHeight() {
  const textarea = elements.chatInput;
  
  // 重置高度
  textarea.style.height = 'auto';
  
  // 设置新高度
  const newHeight = Math.min(Math.max(textarea.scrollHeight, 50), 200);
  textarea.style.height = `${newHeight}px`;
}

// 切换加载状态
function toggleLoadingState(isLoading) {
  elements.loadingIndicator.style.display = isLoading ? 'flex' : 'none';
  elements.sendButton.disabled = isLoading || !isLoggedIn;
}

// ==================== 管理员统计页面函数 ====================

// 打开统计页面
async function openStatsModal() {
  // 检查是否是管理员
  if (!isLoggedIn || !currentUser || currentUser.role !== 'admin') {
    console.warn('无权限访问统计页面');
    return;
  }
  
  // 显示模态框
  elements.statsModal.style.display = 'flex';
  
  // 加载统计数据
  await loadStatsData();
}

// 关闭统计页面
function closeStatsModal() {
  elements.statsModal.style.display = 'none';
}

// 加载统计数据
async function loadStatsData() {
  // 显示加载状态
  elements.statsTableBody.innerHTML = `
    <tr>
      <td colspan="7" class="loading-row">加载中...</td>
    </tr>
  `;
  
  try {
    const response = await fetch(`${API_BASE}/api/admin/stats`, {
      method: 'GET',
      credentials: 'include'
    });
    
    const data = await response.json();
    
    if (data.success && data.data) {
      renderStatsTable(data.data);
    } else {
      throw new Error(data.message || '获取统计数据失败');
    }
  } catch (error) {
    console.error('加载统计数据失败:', error);
    elements.statsTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="loading-row" style="color: #f44336;">加载失败: ${error.message}</td>
      </tr>
    `;
  }
}

// 辅助函数：确保值是数字
function toNumber(val) {
  if (val == null) return 0;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
}

// 渲染统计表格
function renderStatsTable(stats) {
  // 计算汇总数据
  const totalUsers = stats.length;
  const totalTokens = stats.reduce((sum, item) => sum + toNumber(item.total_tokens), 0);
  const totalUsage = stats.reduce((sum, item) => sum + toNumber(item.usage_count), 0);
  
  // 更新汇总卡片
  elements.totalUsers.textContent = formatNumber(totalUsers);
  elements.totalTokens.textContent = formatNumber(totalTokens);
  elements.totalUsage.textContent = formatNumber(totalUsage);
  
  // 渲染表格
  if (stats.length === 0) {
    elements.statsTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="loading-row">暂无数据</td>
      </tr>
    `;
    return;
  }
  
  elements.statsTableBody.innerHTML = stats.map((item, index) => {
    const roleClass = item.role === 'admin' ? 'admin' : 'user';
    const roleText = item.role === 'admin' ? '管理员' : '普通用户';
    
    return `
      <tr>
        <td>${item.user_id}</td>
        <td>${escapeHTML(item.username)}</td>
        <td><span class="role-tag ${roleClass}">${roleText}</span></td>
        <td>${formatNumber(toNumber(item.total_input_tokens))}</td>
        <td>${formatNumber(toNumber(item.total_output_tokens))}</td>
        <td><strong>${formatNumber(toNumber(item.total_tokens))}</strong></td>
        <td>${formatNumber(toNumber(item.usage_count))}</td>
      </tr>
    `;
  }).join('');
}

// 格式化数字（添加千位分隔符）
function formatNumber(num) {
  // 处理字符串类型的数字（MySQL返回的可能是字符串）
  const parsed = typeof num === 'string' ? parseFloat(num) : num;
  if (typeof parsed !== 'number' || isNaN(parsed)) return '0';
  return parsed.toLocaleString('zh-CN');
}

// 滚动到底部
function scrollToBottom() {
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}
