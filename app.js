/**
 * DeepSeek Chat 应用
 * 一个简洁的AI聊天界面，支持多种模型和代码高亮
 */

// 全局变量
var isProcessing = false;
var conversationHistory = [];

// DOM 元素
var elements = {
  chatInput: document.getElementById('chat-input'),
  sendButton: document.getElementById('send-button'),
  messagesContainer: document.getElementById('messages'),
  modelSelect: document.getElementById('model-select'),
  loadingIndicator: document.getElementById('loading')
};

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
  // 加载KaTeX库
  loadKaTeX();
  
  // 设置事件监听器
  setupEventListeners();
  
  // 自动聚焦到输入框
  elements.chatInput.focus();
  
  // 确保只显示一次欢迎消息
  if (!window.__welcomeDisplayed) {
    displayBotMessage("👋 你好！我是 DeepSeek AI 助手，有什么我可以帮助你的吗？");
    window.__welcomeDisplayed = true;
  }
});

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
}

// 处理发送消息
async function handleSendMessage() {
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
    await fetchAIResponse(userMessage);
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
  // 根据选择映射到正确的API模型名称
  const modelMap = {
    'deepseek-chat': 'deepseek-v4-flash',    // DeepSeek-V4 Flash
    'deepseek-reasoner': 'deepseek-v4-pro' // DeepSeek-V4 Pro
  };
  selectedModel = modelMap[selectedModel] || selectedModel;
  
  const apiKey = 'xxxxx';
  const apiUrl = 'https://api.deepseek.com/chat/completions';
  
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
  
  // 构建请求参数
  const requestBody = {
    model: selectedModel,
    messages: conversationHistory,
    stream: true
  };
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        
        if (line.includes('[DONE]')) break;
        
        try {
          const jsonStr = line.substring(5).trim();
          if (!jsonStr) continue;
          
          const data = JSON.parse(jsonStr);
          if (data.choices?.[0]?.delta?.content) {
            const content = data.choices[0].delta.content;
            fullResponse += content;
            
            // 移除加载提示（只在第一次收到内容时）
            if (loadingElement && loadingElement.parentNode && fullResponse.trim().length > 0) {
              loadingElement.remove();
            }
            
            messageContent.innerHTML = formatMessage(fullResponse);
            scrollToBottom();
          }
        } catch (e) {
          console.error('解析流数据出错:', e, '行内容:', line);
        }
      }
    }
    
    // 完成时添加到对话历史
    conversationHistory.push({ role: 'assistant', content: fullResponse });
    return fullResponse;
    
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

// 格式化消息（使用marked库处理Markdown，保留流式输出）
function formatMessage(message) {
  if (!message) return '';
  
  // 先提取代码块，避免处理其中的Markdown
  const codeBlocks = [];
  message = message.replace(/```([\w]*)(?:\n|\r\n)([\s\S]*?)```/g, (match, language, code) => {
    const languageDisplay = language.trim() ? language.trim() : 'code';
    const blockId = `code-block-${codeBlocks.length}`;
    codeBlocks.push({
      id: blockId,
      content: code.trim()
    });
    return `<div class="code-title"><span>${languageDisplay}</span><!-- <button class="copy-button">复制</button> --></div><pre class="code-block" id="${blockId}"><code></code></pre>`;
  });
  
  // 处理数学公式块 - 匹配 \[ ... \] 格式的公式块
  const mathBlocks = [];
  message = message.replace(/\\\[([\s\S]*?)\\\]/g, (match, formula) => {
    const blockId = `math-block-${mathBlocks.length}`;
    mathBlocks.push({
      id: blockId,
      content: formula.trim()
    });
    return `<div class="math-title"><span>公式</span></div><div class="math-block" id="${blockId}"></div>`;
  });
  
  // 处理行内数学公式 - 匹配 \( ... \) 格式的行内公式
  const inlineMathBlocks = [];
  message = message.replace(/\\\(([\s\S]*?)\\\)/g, (match, formula) => {
    const blockId = `inline-math-${inlineMathBlocks.length}`;
    inlineMathBlocks.push({
      id: blockId,
      content: formula.trim()
    });
    return `<span class="inline-math" id="${blockId}"></span>`;
  });
  
  // 使用marked库处理Markdown
  if (typeof marked !== 'undefined') {
    message = marked.parse(message);
  } else {
    // 降级处理：如果marked库未加载，使用简单的Markdown处理
    // 处理Markdown标题（1-5级）
    message = message.replace(/^#\s+(.*)$/gm, '<h1 class="markdown-heading">$1</h1>');
    message = message.replace(/^##\s+(.*)$/gm, '<h2 class="markdown-heading">$1</h2>');
    message = message.replace(/^###\s+(.*)$/gm, '<h3 class="markdown-heading">$1</h3>');
    message = message.replace(/^####\s+(.*)$/gm, '<h4 class="markdown-heading">$1</h4>');
    message = message.replace(/^#####\s+(.*)$/gm, '<h5 class="markdown-heading">$1</h5>');
    
    // 处理水平线
    message = message.replace(/^---+$/gm, '<hr class="markdown-hr">');
    
    // 处理内联代码
    message = message.replace(/`([^`]+)`/g, '<code style="background-color:#f0f0f0;padding:2px 4px;border-radius:3px;font-family:monospace;">$1</code>');
    
    // 处理加粗
    message = message.replace(/\*\*(.*?)\*\*/g, '<span class="bold-text">$1</span>');
    
    // 处理换行
    message = message.replace(/\n/g, '<br>');
  }
  
  // 将代码块和公式块内容重新插入（不经过Markdown处理）
  setTimeout(() => {
    // 处理代码块
    codeBlocks.forEach(block => {
      const element = document.getElementById(block.id);
      if (element) {
        element.querySelector('code').textContent = block.content;
      }
    });
    
    // 处理数学公式块
    mathBlocks.forEach(block => {
      const element = document.getElementById(block.id);
      if (element && typeof katex !== 'undefined') {
        try {
          katex.render(block.content, element, {
            displayMode: true,
            throwOnError: false
          });
        } catch (e) {
          element.textContent = block.content;
          console.error('渲染数学公式出错:', e);
        }
      }
    });
    
    // 处理行内数学公式
    inlineMathBlocks.forEach(block => {
      const element = document.getElementById(block.id);
      if (element && typeof katex !== 'undefined') {
        try {
          katex.render(block.content, element, {
            displayMode: false,
            throwOnError: false
          });
        } catch (e) {
          element.textContent = block.content;
          console.error('渲染行内数学公式出错:', e);
        }
      }
    });
    
    // 在所有内容渲染完成后再次滚动到底部
    // 只要有代码块或公式块，就需要再次滚动
    if (codeBlocks.length > 0 || mathBlocks.length > 0 || inlineMathBlocks.length > 0) {
      scrollToBottom();
    }
  }, 0);
  
  return message;
}

// 转义HTML特殊字符
function escapeHTML(text) {
  const escapeMap = {
    '&': '&',
    '<': '<',
    '>': '>',
    '"': '"',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => escapeMap[m]);
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
  elements.sendButton.disabled = isLoading;
}

// 滚动到底部
function scrollToBottom() {
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}