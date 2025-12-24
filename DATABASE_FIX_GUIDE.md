# 数据库字段缺失问题 - 手动修复方案

## 🎯 问题诊断

### 错误信息
```
column u.referrer_code does not exist
```

### 根本原因
`/api/admin/stats` 的查询（第594行）使用了：
```sql
LEFT JOIN users u ON u.referrer_code = rc.code
```

但 Vercel Postgres 的 `users` 表**没有 `referrer_code` 字段**。

### 为什么自动修复失败
1. 我添加的 `fix-db` 端点代码已推送到 Git
2. 但 Vercel 还没部署新代码
3. 访问 `https://www.aiguess.cn/api/dev/fix-db` 返回 `Cannot GET`

---

## ✅ 手动修复方案（立即可用）

### 方案 A：Vercel Postgres 控制台执行 SQL

1. 访问 Vercel Dashboard → 您的项目 → Storage → Postgres
2. 点击 "Query" 或 "Data" 标签3. 执行以下 SQL：

```sql
-- 添加分销系统字段
ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS own_referral_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_type TEXT;

-- 添加手机号登录字段
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_bound BOOLEAN DEFAULT false;

-- 验证字段已添加
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'users'
ORDER BY ordinal_position;
```

4. 执行后，应该看到所有字段都已添加
5. 刷新管理后台，问题解决

---

### 方案 B：等待 Vercel 自动部署

如果 Vercel 自动部署卡住了，手动触发：

1. 访问：https://vercel.com/您的项目名/deployments
2. 找到最新的 commit: `a3e9de9 feat: 添加数据库修复端点`
3. 点击右侧的 "···" → "Redeploy"
4. 等待部署完成（1-2分钟）
5. 访问：https://www.aiguess.cn/api/dev/fix-db
6. 看到成功日志
7. 刷新管理后台

---

## 推荐

**方案 A 更快**，直接执行 SQL，30秒搞定。
