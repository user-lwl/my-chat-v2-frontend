-- =============================================================
-- 版本 V2：对话历史与对话记忆功能
-- 说明：
--   1. conversations 表：保存用户的每一次对话会话（会话级信息 + 压缩摘要）
--   2. chat_messages 表：保存会话中的每一条消息，按原样保存（用于历史记录展示）
--   3. 摘要压缩字段（summary）用于对话记忆，不影响原始消息记录
-- 关联表：users 表（来自 create_table.sql）
-- =============================================================

USE lwl_chat;

-- ---------------------------------------------------------------
-- 对话会话表
-- 每个用户可拥有多个对话会话，每次对话会话拥有一个标题和一份压缩摘要
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL COMMENT '所属用户ID',
    title VARCHAR(200) NOT NULL DEFAULT '新对话' COMMENT '对话标题（用于左侧列表展示）',
    model VARCHAR(50) NOT NULL DEFAULT 'deepseek-v4-flash' COMMENT '会话使用的模型',
    summary TEXT COMMENT '压缩摘要（用于对话记忆，控制成本，不影响原始消息）',
    summary_message_count INT DEFAULT 0 COMMENT '已压缩进摘要的消息条数',
    message_count INT DEFAULT 0 COMMENT '消息总条数（冗余字段，便于列表展示）',
    is_active TINYINT(1) DEFAULT 1 COMMENT '是否有效：1-有效，0-已删除',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后活跃时间',
    INDEX idx_user_id (user_id),
    INDEX idx_updated_at (updated_at),
    CONSTRAINT fk_conv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话会话表';

-- ---------------------------------------------------------------
-- 对话消息表
-- 保存会话中的每一条消息，按原样保存，用于历史记录展示
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_id INT NOT NULL COMMENT '所属会话ID',
    role VARCHAR(20) NOT NULL COMMENT '消息角色：user-用户，assistant-助手，system-系统',
    content LONGTEXT NOT NULL COMMENT '消息内容（按原样保存）',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '消息时间',
    INDEX idx_conversation_id (conversation_id),
    CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话消息表';
