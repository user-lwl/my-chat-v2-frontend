# My Chat V2

这是My Chat的升级版本，一个简洁美观的AI聊天界面，支持多种模型、代码高亮显示和数学公式渲染。

## 功能特点

- 🎨 现代化UI设计，响应式布局
- 💬 支持DeepSeek-V3和DeepSeek-R1两种AI模型
- 📝 代码块语法高亮和一键复制功能
- ➗ 数学公式渲染支持（使用KaTeX）
- 📊 支持Markdown格式（标题、水平线、加粗等）
- ⌨️ 支持Ctrl+Enter快捷发送消息
- 📱 完全适配移动设备
- 🔄 输入框高度自适应

## 项目结构

```
deepseek-chat-v2/
├── index.html      # 主HTML文件
├── styles.css      # 样式表
├── app.js          # 应用逻辑
├── server.js       # 本地开发服务器
├── src/            # 静态资源
│   ├── beijing.jpg     # 背景图片
│   ├── bot-avatar.png  # 机器人头像
│   ├── user-avatar.png # 用户头像
│   ├── favicon.ico     # 网站图标
│   └── logo.png        # Logo图片
└── README.md       # 项目说明
```

## 特殊语法支持

### 代码块

使用三个反引号包裹代码，可以指定语言：

````
```javascript
function hello() {
  console.log("Hello, world!");
}
```
````

### 数学公式

使用LaTeX语法编写数学公式：

1. 行内公式：`\(E=mc^2\)`
2. 公式块：
```
\[
\begin{cases}
x = 3 \\
y = 2
\end{cases}
\]
```

### Markdown语法

- **加粗文本**：`**加粗文本**`
- 标题：使用`#`、`##`等
- 水平线：使用三个或更多连字符`---`

## 运行项目

### 前提条件

- 安装 [Node.js](https://nodejs.org/) (推荐v14.0.0或更高版本)

### 本地运行

1. 克隆项目到本地
   ```
   git clone https://github.com/user-lwl/my-chat-v2-frontend.git
   cd my-chat-v2-frontend
   ```

2. 启动本地服务器
   ```
   node server.js
   ```

3. 在浏览器中访问
   ```
   http://localhost:3000
   ```

## 技术栈

- HTML5
- CSS3 (使用现代CSS特性)
- JavaScript (ES6+)
- KaTeX (用于数学公式渲染)
- Node.js (用于本地开发服务器)

## 已实现功能

- [x] 代码高亮显示
- [x] 数学公式渲染
- [x] Markdown基本语法支持
- [x] 响应式设计
