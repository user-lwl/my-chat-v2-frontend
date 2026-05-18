# My Chat 登录注册功能实施计划

## 一、项目现状分析

### 1.1 技术栈
- **前端**：HTML5 + CSS3 + JavaScript (ES6+)
- **后端**：Node.js (原生HTTP服务器)
- **AI服务**：DeepSeek API (流式输出)
- **数据存储**：目前无，计划使用 MySQL

### 1.2 当前功能
- 单页面AI聊天应用
- 支持两种模型选择（DeepSeek-V4 Flash/Pro）
- 支持代码块、数学公式渲染
- 流式输出显示

### 1.3 存在问题
- 无用户认证机制
- 无用户识别和统计
- 无法排查恶意用户

## 二、需求分析

### 2.1 核心功能需求
1. **用户注册**：新用户创建账号（用户名、密码）
2. **用户登录**：已有用户登录系统
3. **权限控制**：未登录用户无法发送消息
4. **用户状态显示**：右上角显示登录状态
5. **Token消耗记录**：实时记录每个用户的Token使用情况

### 2.2 技术约束
- 浏览器无法直接连接MySQL，需要通过后端API
- 需要保持现有页面结构和功能
- 保留流式输出特性

## 三、数据库设计

### 3.1 数据库配置
- **主机**：localhost:3306
- **用户名**：root
- **密码**：123456
- **数据库名**：lwl_chat

### 3.2 表结构设计

#### 表1：users（用户表）
| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| id | INT | PRIMARY KEY, AUTO_INCREMENT | 用户ID |
| username | VARCHAR(50) | UNIQUE, NOT NULL | 用户名 |
| password | VARCHAR(255) | NOT NULL | 密码（加密存储） |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | 创建时间 |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | 更新时间 |

#### 表2：token_usage（Token消耗表）
| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| id | INT | PRIMARY KEY, AUTO_INCREMENT | 记录ID |
| user_id | INT | FOREIGN KEY, NOT NULL | 用户ID |
| model | VARCHAR(50) | NOT NULL | 使用的模型 |
| input_tokens | INT | DEFAULT 0 | 输入Token数 |
| output_tokens | INT | DEFAULT 0 | 输出Token数 |
| total_tokens | INT | DEFAULT 0 | 总Token数 |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | 记录时间 |

## 四、实施步骤

### 步骤1：创建数据库建表SQL
- **文件**：`sql/create_table.sql`
- **内容**：创建数据库和两张表的SQL语句

### 步骤2：修改后端服务器（server.js）
- **功能**：
  1. 添加MySQL数据库连接
  2. 添加注册API接口（POST /api/register）
  3. 添加登录API接口（POST /api/login）
  4. 添加用户状态检查接口（GET /api/check-auth）
  5. 添加登出API接口（POST /api/logout）
  6. 添加Token消耗记录接口（POST /api/log-token）
  7. 保留静态文件服务功能

- **技术选型**：
  - 使用 `mysql2` 库连接数据库
  - 使用 `bcrypt` 进行密码加密
  - 使用简单的会话管理（基于内存或cookie）

### 步骤3：修改前端页面（index.html）
- **功能**：
  1. 在右上角添加登录按钮/用户信息显示区域
  2. 添加登录弹窗或页面
  3. 添加注册弹窗或页面（可与登录页面切换）
  4. 添加未登录提示

### 步骤4：添加样式（styles.css）
- **功能**：
  1. 登录/注册弹窗样式
  2. 右上角用户区域样式
  3. 未登录状态下的禁用样式

### 步骤5：修改前端逻辑（app.js）
- **功能**：
  1. 添加用户登录/注册的前端逻辑
  2. 添加用户状态管理（登录/未登录）
  3. 添加权限控制：未登录时禁用发送按钮和输入框
  4. 登录成功后显示用户信息
  5. 退出登录功能

### 步骤6：添加Token消耗记录
- **功能**：
  1. 在AI对话结束后，记录Token使用情况
  2. 调用后端API保存Token消耗记录
  3. （可选）在前端显示用户的Token使用统计

### 步骤7：测试验证
- **功能**：
  1. 测试注册功能
  2. 测试登录功能
  3. 测试权限控制（未登录无法发送消息）
  4. 测试Token消耗记录
  5. 测试登出功能

## 五、依赖说明

### 5.1 需要安装的npm包
```bash
npm install mysql2 bcrypt
```

### 5.2 前端依赖
- 无需额外安装，使用现有CDN资源

## 六、风险与注意事项

### 6.1 安全性考虑
- **密码加密**：使用bcrypt对密码进行哈希存储
- **SQL注入**：使用参数化查询防止SQL注入
- **会话管理**：使用简单的会话机制，注意会话过期
- **XSS防护**：对用户输入进行适当的转义

### 6.2 技术风险
- **MySQL服务未运行**：需要确保本地MySQL服务已启动
- **数据库连接失败**：需要正确的数据库配置
- **密码加密库安装失败**：bcrypt可能需要编译环境

### 6.3 降级方案
- 如果MySQL无法连接，可暂时使用内存存储进行测试
- 保留原有的静态文件服务功能

## 七、文件修改清单

| 文件路径 | 修改类型 | 说明 |
|----------|----------|------|
| `sql/create_table.sql` | 新建 | 数据库建表SQL |
| `server.js` | 修改 | 添加数据库连接和API接口 |
| `index.html` | 修改 | 添加登录注册UI |
| `styles.css` | 修改 | 添加登录注册样式 |
| `app.js` | 修改 | 添加登录注册逻辑和权限控制 |
| `package.json` | 新建/修改 | 添加npm依赖（如果不存在） |

## 八、实施顺序

1. **创建SQL文件** → 2. **安装依赖** → 3. **修改后端** → 4. **修改前端HTML** → 5. **添加样式** → 6. **修改前端逻辑** → 7. **测试验证**
