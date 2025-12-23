-- PhotoTree 分销系统数据库初始化脚本

-- 1. 修改 users 表，添加邀请相关字段
ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS own_referral_code TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_type TEXT;

-- 添加索引以提升查询性能
CREATE INDEX IF NOT EXISTS idx_users_referrer_code ON users(referrer_code);
CREATE INDEX IF NOT EXISTS idx_users_own_referral_code ON users(own_referral_code);

-- 2. 创建 page_views 表（记录 UV/PV）
CREATE TABLE IF NOT EXISTS page_views (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    referrer_code TEXT,
    device_type TEXT CHECK (device_type IN ('pc', 'mobile', 'unknown')),
    user_agent TEXT,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_pv_session_id ON page_views(session_id);
CREATE INDEX IF NOT EXISTS idx_pv_referrer_code ON page_views(referrer_code);
CREATE INDEX IF NOT EXISTS idx_pv_created_at ON page_views(created_at);

-- 3. 创建 referral_codes 表（管理 KOL 邀请码）
CREATE TABLE IF NOT EXISTS referral_codes (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    owner_name TEXT NOT NULL,
    owner_contact TEXT,
    commission_rate DECIMAL(5,2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_rc_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_rc_is_active ON referral_codes(is_active);

-- 插入示例邀请码（测试用）
INSERT INTO referral_codes (code, owner_name, owner_contact, commission_rate, notes) 
VALUES ('TEST_KOL', '测试KOL', 'test@example.com', 10.00, '测试用邀请码')
ON CONFLICT (code) DO NOTHING;

-- 显示表结构确认
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('users', 'page_views', 'referral_codes')
ORDER BY table_name, ordinal_position;
