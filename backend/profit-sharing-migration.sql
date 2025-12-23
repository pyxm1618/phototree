-- 微信支付分账功能数据库迁移脚本

-- 1. 创建分账记录表
CREATE TABLE IF NOT EXISTS profit_sharing_records (
    id SERIAL PRIMARY KEY,
    out_order_no TEXT NOT NULL,
    transaction_id TEXT,
    referrer_code TEXT NOT NULL,
    receiver_openid TEXT NOT NULL,
    receiver_name TEXT,
    amount INTEGER NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    wechat_order_id TEXT,
    finish_time BIGINT,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_ps_out_order_no ON profit_sharing_records(out_order_no);
CREATE INDEX IF NOT EXISTS idx_ps_referrer_code ON profit_sharing_records(referrer_code);
CREATE INDEX IF NOT EXISTS idx_ps_status ON profit_sharing_records(status);
CREATE INDEX IF NOT EXISTS idx_ps_created_at ON profit_sharing_records(created_at);

-- 2. 修改 referral_codes 表，添加分账相关字段
ALTER TABLE referral_codes ADD COLUMN IF NOT EXISTS receiver_openid TEXT;
ALTER TABLE referral_codes ADD COLUMN IF NOT EXISTS sharing_percentage DECIMAL(5,2) DEFAULT 10.00;

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_rc_receiver_openid ON referral_codes(receiver_openid);

-- 显示表结构确认
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('profit_sharing_records', 'referral_codes')
ORDER BY table_name, ordinal_position;
