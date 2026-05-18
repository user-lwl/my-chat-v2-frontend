-- 创建数据库
CREATE DATABASE IF NOT EXISTS lwl_chat DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 使用数据库
USE lwl_chat;

-- 创建用户表
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
    password VARCHAR(255) NOT NULL COMMENT '密码（加密存储）',
    role ENUM('admin', 'user') NOT NULL DEFAULT 'user' COMMENT '用户角色：admin-管理员，user-普通用户',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_username (username),
    INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- 创建Token消耗记录表
CREATE TABLE IF NOT EXISTS token_usage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL COMMENT '用户ID',
    model VARCHAR(50) NOT NULL COMMENT '使用的模型',
    input_tokens INT DEFAULT 0 COMMENT '输入Token数',
    output_tokens INT DEFAULT 0 COMMENT '输出Token数',
    total_tokens INT DEFAULT 0 COMMENT '总Token数',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Token消耗记录表';
