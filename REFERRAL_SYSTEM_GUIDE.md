# PhotoTree 分销系统使用手册

## 📚 快速开始

### 1. 初始化数据库

首先需要在数据库中执行 SQL 初始化脚本：

```bash
# 方式一：通过 psql 命令行
psql $DATABASE_URL < backend/init-db.sql

# 方式二：通过 API（需要先启动后端）
curl http://localhost:3000/api/dev/init-db
```

### 2. 启动本地开发环境

```bash
cd /Users/milushangdi/Documents/phototree

# 赋予启动脚本执行权限
chmod +x start-dev.sh

# 启动服务
./start-dev.sh
```

或者手动启动：

```bash
cd backend
npm install  # 首次运行需要
npm start
```

### 3. 访问管理后台

启动后会自动打开管理后台，或手动访问：

```
file:///Users/milushangdi/Documents/phototree/backend/admin/index.html
```

---

## 🎯 核心功能说明

### 邀请码机制

1. **创建邀请码**
   - 在管理后台底部的"创建新邀请码"表单中填写信息
   - 点击"创建"按钮
   - 系统会生成邀请链接：`https://aiguess.cn/?ref=YOUR_CODE`

2. **分享给 KOL**
   - 将生成的邀请链接发给对应的 KOL
   - KOL 在社交媒体/视频/文章中分享该链接

3. **用户追踪流程**
   ```
   用户点击邀请链接 → 访问 aiguess.cn/?ref=XXX
   → 邀请码存入 localStorage
   → 记录 PV
   → 用户注册/登录
   → 绑定 referrer_code
   → 用户付费
   → 统计到 KOL 名下
   ```

### 统计数据查看

管理后台提供以下数据：

| 指标 | 说明 |
|------|------|
| **UV** | 独立访客数（基于 session_id） |
| **PV** | 总页面浏览量 |
| **注册用户** | 总注册用户数 |
| **付费用户** | 总付费用户数 |
| **付费转化率** | 付费用户 / 注册用户 |
| **设备分布** | PC vs Mobile 访问占比 |
| **近7日数据** | 每日 UV/PV 趋势 |
| **邀请码排行榜** | 各邀请码的注册/付费效果 |

---

## 🔌 API 文档

### 1. PV 追踪

**端点**: `POST /api/track/pv`

**请求体**:
```json
{
  "sessionId": "session_xxx",
  "referrerCode": "KOL_XIAOMING",
  "deviceType": "mobile",
  "userAgent": "Mozilla/5.0..."
}
```

**响应**:
```json
{
  "success": true
}
```

### 2. 创建邀请码

**端点**: `POST /api/referral/create`

**请求体**:
```json
{
  "code": "KOL_XIAOMING",
  "ownerName": "小明",
  "ownerContact": "xiaoming@example.com",
  "commissionRate": 10.5
}
```

**响应**:
```json
{
  "success": true,
  "referralCode": { ... }
}
```

### 3. 查询邀请码统计

**端点**: `GET /api/referral/stats/:code`

**示例**: `GET /api/referral/stats/KOL_XIAOMING`

**响应**:
```json
{
  "success": true,
  "referralCode": {
    "code": "KOL_XIAOMING",
    "owner_name": "小明",
    ...
  },
  "stats": {
    "totalPV": 1250,
    "registeredUsers": 45,
    "paidUsers": 12,
    "conversionRate": "26.67%"
  }
}
```

### 4. 管理后台统计数据

**端点**: `GET /api/admin/stats`

**响应**:
```json
{
  "success": true,
  "overview": {
    "totalUV": 5478,
    "totalPV": 12350,
    "totalUsers": 234,
    "paidUsers": 45,
    "conversionRate": "19.23%"
  },
  "deviceDistribution": {
    "pc": 3245,
    "mobile": 9105
  },
  "dailyStats": [...],
  "topReferrals": [...]
}
```

---

## 🌐 前端集成

### tracking.js 使用

前端已自动引入 `tracking.js`，提供以下功能：

```javascript
// 自动功能（页面加载时）
- 捕获 URL 中的 ?ref=XXX 参数
- 存储到 localStorage
- 上报 PV 到后端

// 手动调用（如需要）
trackPageView();  // 手动上报 PV
getStoredReferrerCode();  // 获取存储的邀请码
getDeviceType();  // 获取设备类型
```

### 登录时绑定邀请码

微信登录回调 URL 需携带参数：

```
https://aiguess.cn/api/callback/wechat?code=...&ref=KOL_CODE&device=mobile
```

前端需修改微信登录跳转逻辑，示例：

```javascript
const referrerCode = getStoredReferrerCode();
const deviceType = getDeviceType();

// 构建登录 URL（需在实际微信登录代码中实现）
const wechatLoginUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?...&state=${referrerCode}_${deviceType}`;
```

---

## 📝 数据库表结构

### users 表（修改后）
```sql
id, openid, nickname, avatar_url, 
is_vip, vip_expire_time, 
referrer_code,      -- 新增：该用户的邀请人
own_referral_code,  -- 新增：该用户自己的邀请码（预留）
device_type,        -- 新增：用户设备类型
created_at
```

### page_views 表（新增）
```sql
id, session_id, referrer_code, device_type, 
user_agent, ip_address, created_at
```

### referral_codes 表（新增）
```sql
id, code, owner_name, owner_contact, 
commission_rate, is_active, notes, created_at
```

---

## ⚠️ 注意事项

1. **环境变量**
   - 确保设置了 `DATABASE_URL` 环境变量
   - 可在 `backend/.env` 文件中配置

2. **数据库初始化**
   - 必须先执行 `init-db.sql` 才能使用新功能
   - 建议在生产环境部署前在 Vercel 控制台手动执行 SQL

3. **登录逻辑集成**
   - 当前前端登录代码未完全集成 referrer_code 传递
   - 需要手动修改微信登录跳转，将 `ref` 和 `device` 参数传递给回调 URL

4. **本地测试**
   - 管理后台需要后端服务运行在 `localhost:3000`
   - 可以先通过浏览器直接打开 `admin/index.html` 测试 UI

---

## 🚀 部署到 Vercel

1. **执行数据库迁移**
   - 在 Vercel Postgres 控制台执行 `backend/init-db.sql`

2. **推送代码到 GitHub**
   ```bash
   git add .
   git commit -m "feat: 添加分销系统和管理后台"
   git push origin main
   ```

3. **Vercel 自动部署**
   - Vercel 检测到新提交后会自动部署

4. **验证功能**
   - 访问 `https://aiguess.cn/?ref=TEST_KOL` 测试追踪
   - 使用 Vercel Logs 查看后端日志

---

## 📊 生产环境管理后台

由于管理后台是纯静态 HTML，无法通过 Vercel 直接访问，有两种方案：

### 方案 A：本地运行（推荐）
```bash
# 本地启动后端代理
ssh -L 3000:localhost:3000 vercel_user@vercel_host

# 打开管理后台
open backend/admin/index.html
```

### 方案 B：修改 API_BASE
修改 `admin/index.html` 中的：
```javascript
const API_BASE = 'https://aiguess.cn';  // 改为生产域名
```

然后将 `admin/index.html` 上传到任意静态托管（如 GitHub Pages）。

---

**祝使用愉快！有问题请参考代码注释或查看控制台日志。**
