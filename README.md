# My Chat V2

这是My Chat的升级版本，一个简洁美观的AI聊天界面，支持用户登录注册、多种AI模型、代码高亮显示和数学公式渲染。

## 功能特点

### 核心功能
- 🎨 现代化UI设计，响应式布局
- 👤 用户登录注册系统
- 👑 管理员角色支持
- 💬 支持DeepSeek-V4 Flash和DeepSeek-V4 Pro两种AI模型
- 📝 代码块语法高亮和一键复制功能
- ➗ 数学公式渲染支持（使用KaTeX）
- 📊 支持Markdown格式（标题、水平线、加粗等）
- ⌨️ 支持Ctrl+Enter快捷发送消息
- 📱 完全适配移动设备
- 🔄 输入框高度自适应
- 🔒 API Key后端存储，不暴露给前端
- 🗂️ 对话记录栏：登录后显示历史对话，支持新建、切换、删除对话
- 🧠 对话记忆：多轮对话自动维护上下文（参考DeepSeek多轮对话API）
- 💾 摘要压缩：对话过长时自动压缩早期内容为摘要以节约Token成本，且不影响历史记录按原样保存展示

### 管理员功能
- 📊 用户Token消耗统计页面
- 🔍 查看所有用户的Token使用情况
- 📈 汇总统计：总用户数、总消耗Token、总对话次数

## 项目结构

```
my-chat-v2-frontend/
├── index.html           # 主HTML文件
├── styles.css           # 样式表
├── app.js               # 前端应用逻辑
├── server.js            # 后端服务器
├── config.json          # 配置文件（敏感信息，不提交到Git）
├── .gitignore           # Git忽略文件
├── sql/
│   ├── create_table.sql   # 数据库建表脚本（V1）
│   └── create_table_v2.sql # 对话历史表脚本（V2，新增）
├── src/                 # 静态资源
│   ├── beijing.jpg      # 背景图片
│   ├── bot-avatar.png   # 机器人头像
│   ├── user-avatar.png  # 用户头像
│   ├── favicon.ico      # 网站图标
│   └── logo.png         # Logo图片
└── README.md            # 项目说明
```

## 技术栈

### 前端
- HTML5
- CSS3 (使用现代CSS特性)
- JavaScript (ES6+)
- Marked.js (Markdown解析)
- Highlight.js (代码高亮)
- KaTeX (数学公式渲染)

### 后端
- Node.js
- MySQL (用户数据和Token消耗记录)
- Bcrypt (密码加密)

## 快速开始

### 前提条件

- 安装 [Node.js](https://nodejs.org/) (推荐v16.0.0或更高版本)
- 安装 [MySQL](https://www.mysql.com/) (用于存储用户数据)

### 1. 克隆项目

```bash
git clone https://github.com/user-lwl/my-chat-v2-frontend.git
cd my-chat-v2-frontend
```

### 2. 安装依赖

```bash
npm install
```

### 3. 创建配置文件

复制配置模板并填写您的信息：

```bash
cp config.example.json config.json
vi config.json
```

配置项说明：

```json
{
  "deepseek": {
    "apiKey": "your-deepseek-api-key",
    "baseUrl": "https://api.deepseek.com"
  },
  "database": {
    "host": "localhost",
    "port": 3306,
    "user": "lwl_chat",
    "password": "your-db-password",
    "database": "lwl_chat"
  },
  "server": {
    "port": 3001,
    "sessionTimeout": 86400000
  },
  "security": {
    "dailyTokenQuota": 50000
  }
}
```

> **安全提示**
> - `config.json` 已在 `.gitignore` 中，**不要提交到仓库**。
> - 更推荐用环境变量注入密钥，避免明文落盘：`DEEPSEEK_API_KEY`、`DB_PASSWORD`、`PORT`，环境变量优先级高于配置文件。
> - 服务端只会对外提供 html/css/js/图片/字体这几类静态资源，`.json`、`.md`、`.sql` 及隐藏文件一律返回 404，因此 `config.json` 不会被公网下载。
> - 如需调整单用户每日 token 上限，改 `security.dailyTokenQuota`（单位：token/天/用户）。

### 4. 创建数据库

登录MySQL并执行建表脚本（需按顺序执行 V1 和 V2 两个脚本）：

```bash
mysql -u root -p
```

然后在MySQL中执行：

```sql
source /path/to/project/sql/create_table.sql;
source /path/to/project/sql/create_table_v2.sql;
```

> **注意**：`create_table_v2.sql` 用于对话历史和对话记忆功能（V2版本新增），如项目已运行过 V1，只需执行 V2 脚本即可。

### 5. 设置管理员账号

注册一个用户后，在MySQL中执行：

```sql
UPDATE users SET role = 'admin' WHERE username = '你的用户名';
```

### 6. 启动服务器

```bash
node server.js
```

### 7. 访问应用

在浏览器中访问：

```
http://localhost:3001
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

## API接口

### 用户认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/register` | 用户注册 |
| POST | `/api/login` | 用户登录 |
| GET | `/api/check-auth` | 检查登录状态 |
| POST | `/api/logout` | 用户登出 |

### 聊天功能

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | AI对话（SSE流式输出，支持对话记忆与摘要压缩） |

### 对话历史功能

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/conversations` | 创建新对话会话 |
| GET | `/api/conversations` | 获取当前用户的对话列表 |
| GET | `/api/conversations/:id` | 获取单个对话详情（含消息） |
| DELETE | `/api/conversations/:id` | 删除对话（软删除） |

### 管理员功能

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/stats` | 获取用户Token统计（需要管理员权限） |

## 数据库结构

### users表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键，自增 |
| username | VARCHAR(50) | 用户名，唯一 |
| password | VARCHAR(255) | 加密后的密码 |
| role | ENUM('admin', 'user') | 用户角色，默认user |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

### token_usage表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键，自增 |
| user_id | INT | 用户ID，外键 |
| input_tokens | INT | 输入Token数 |
| output_tokens | INT | 输出Token数 |
| total_tokens | INT | 总Token数 |
| model | VARCHAR(50) | 使用的模型 |
| created_at | DATETIME | 创建时间 |

### conversations表（V2新增：对话会话表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键，自增 |
| user_id | INT | 所属用户ID，外键 |
| title | VARCHAR(200) | 对话标题（用于左侧列表展示） |
| model | VARCHAR(50) | 会话使用的模型 |
| summary | TEXT | 压缩摘要（用于对话记忆，节约成本，不影响原始记录） |
| summary_message_count | INT | 已压缩进摘要的消息条数 |
| message_count | INT | 消息总条数 |
| is_active | TINYINT(1) | 是否有效：1-有效，0-已删除 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 最后活跃时间 |

### chat_messages表（V2新增：对话消息表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键，自增 |
| conversation_id | INT | 所属会话ID，外键 |
| role | VARCHAR(20) | 消息角色：user/assistant/system |
| content | LONGTEXT | 消息内容（按原样保存，用于历史展示） |
| created_at | DATETIME | 消息时间 |

## 部署到服务器

### 方案一：直接部署（推荐）

1. 安装Node.js和MySQL
2. 上传项目到服务器
3. 创建`config.json`配置文件
4. 执行建表脚本
5. 使用PM2管理进程：

```bash
npm install -g pm2
pm2 start server.js --name my-chat
pm2 startup
pm2 save
```

6. 配置Nginx反向代理

### 方案二：Docker部署

创建`Dockerfile`：

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3001
CMD ["node", "server.js"]
```

创建`docker-compose.yml`：

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3001:3001"
    volumes:
      - ./config.json:/app/config.json
    depends_on:
      - db
    restart: always

  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: your-password
      MYSQL_DATABASE: lwl_chat
    volumes:
      - mysql_data:/var/lib/mysql
      - ./sql/create_table.sql:/docker-entrypoint-initdb.d/01-init.sql
      - ./sql/create_table_v2.sql:/docker-entrypoint-initdb.d/02-init_v2.sql
    ports:
      - "3306:3306"
    restart: always

volumes:
  mysql_data:
```

## 安全注意事项

- ⚠️ `config.json` 包含敏感信息，已添加到 `.gitignore`，不会提交到Git
- 🔑 密码使用bcrypt加密存储
- 🔒 API Key存储在后端，不会暴露给前端
- 🛡️ 会话使用Cookie管理，有过期时间

## 已实现功能

- [x] 代码高亮显示
- [x] 数学公式渲染
- [x] Markdown基本语法支持
- [x] 响应式设计
- [x] 用户登录注册
- [x] 管理员角色
- [x] Token消耗统计
- [x] API Key后端存储
- [x] 流式输出
- [x] 对话历史记录（左侧栏展示、新建、切换、删除）
- [x] 对话记忆（多轮对话上下文维护）
- [x] 摘要压缩（节约Token成本，不影响原样记录）
