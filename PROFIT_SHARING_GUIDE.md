# 微信支付自动分账使用手册

## 🎯 功能概述
用户通过 KOL 邀请链接注册并付费后，系统会自动将佣金通过微信分账 API 转给 KOL 的零钱，无需人工操作。

## ⚠️ 重要提示

**版本**: 已根据官方文档修复，符合微信支付V3规范

**关键配置**:
- ✅ 已添加必填字段 `unfreeze_unsplit`（设为 false）
- ✅ 已添加分账比例上限校验（30%）
- ✅ 支持同一订单多次分账
- ⚠️ name 字段暂未实现加密（官方为选填，建议后续优化）

## 📋 前置条件

### 1. 在微信商户平台开通分账功能
1. 登录 [微信商户平台](https://pay.weixin.qq.com)
2. 进入 **产品中心 → 分账**
3. 点击 **开通分账功能**
4. 完成资质审核

### 2. 添加分账接收方（KOL）
每个 KOL 需要在商户平台添加为分账接收方：
- 接收方类型：`个人`
- 关系类型：`合作伙伴 (PARTNER)`
- 需要提供 KOL 的 OpenID

## 🚀 快速开始

### Step 1: 数据库迁移
在生产环境 PostgreSQL 中执行：
```bash
# Vercel Postgres 控制台执行
psql $DATABASE_URL < backend/profit-sharing-migration.sql
```

### Step 2: 绑定 KOL 的 OpenID
为每个邀请码绑定对应 KOL 的 OpenID（用于接收分账）：

**API 调用**：
```bash
curl -X POST https://aiguess.cn/api/admin/profit-sharing/add-receiver \
  -H "Content-Type: application/json" \
  -d '{
    "referralCode": "KOL_XIAOMING",
    "openid": "oXXXXXXXXXXXXXXXXX",
    "sharingPercentage": 10.00
  }'
```

**参数说明**：
- `referralCode`: 邀请码（必须已存在）
- `openid`: KOL 的微信 OpenID
- `sharingPercentage`: 分账比例（默认 10%）

### Step 3: 用户支付流程
1. 用户通过邀请链接访问：`https://aiguess.cn/?ref=KOL_XIAOMING`
2. 注册/登录（系统自动绑定邀请码）
3. 用户购买 VIP
4. 支付成功后，系统自动：
   - 更新用户为 VIP
   - **自动执行分账**，将佣金转给 KOL

## 📊 监控与查询

### 查看分账记录
```bash
curl https://aiguess.cn/api/admin/profit-sharing/records
```

返回示例：
```json
{
  "success": true,
  "records": [
    {
      "id": 1,
      "out_order_no": "PS_1703345678_123",
      "transaction_id": "4200001234567890",
      "referrer_code": "KOL_XIAOMING",
      "receiver_openid": "oXXXX...",
      "receiver_name": "小明",
      "amount": 180,
      "status": "success",
      "wechat_order_id": "30000012345678",
      "created_at": "2025-12-23T10:00:00Z"
    }
  ]
}
```

## ⚙️ 技术细节

### 分账流程
```
用户支付 (18元)
  ↓
支付回调成功
  ↓
更新用户 VIP 状态
  ↓
检测到邀请码: KOL_XIAOMING
  ↓
查询分账接收方信息
  ↓
计算分账金额: 18元 × 10% = 1.8元
  ↓
调用微信分账 API
  ↓
1.8元 → KOL 零钱
16.2元 → 商户账户
```

### 数据库表说明

**`profit_sharing_records`** - 分账记录表
- `out_order_no`: 分账订单号
- `transaction_id`: 微信支付交易单号
- `referrer_code`: 邀请码
- `receiver_openid`: 接收方 OpenID
- `amount`: 分账金额（分）
- `status`: 状态 (pending/success/failed)

**`referral_codes`** - 邀请码表（新增字段）
- `receiver_openid`: 接收方 OpenID
- `sharing_percentage`: 分账比例

## ⚠️ 注意事项

### 1. 分账时效
- 支付成功后 **立即** 执行分账
- 微信处理时间：1-3 分钟
- KOL 可在微信零钱中查看

### 2. 分账限制
- 单笔订单总分账金额不能超过订单金额
- 建议分账比例 5%-30%
- 分账金额最小 0.01 元

### 3. 退款处理
- 如果订单部分退款，需手动调整分账
- 建议设置分账延迟（如 24 小时后）以应对退款

### 4. 错误处理
- 如果分账失败，系统会记录错误信息到 `profit_sharing_records.error_message`
- 可通过后台查询失败记录并手动重试

## 🧪 测试建议

### 沙箱环境测试
如果微信提供沙箱环境，建议先在沙箱测试分账流程。

### 生产小额测试
1. 创建测试邀请码 `TEST_SHARING`
2. 绑定自己的 OpenID
3. 模拟支付 0.01 元
4. 验证分账是否到账

## 🛠️ 常见问题

### Q: 如何获取 KOL 的 OpenID？
**A**: KOL 需要先关注公众号或使用小程序，通过微信登录后可获取。

### Q: 分账失败怎么办？
**A**: 查看 `profit_sharing_records` 表的 `error_message` 字段，常见原因：
- 接收方未添加到商户平台
- 分账功能未开通
- 商户余额不足

### Q: 能否修改分账比例？
**A**: 可以，调用 `/api/admin/profit-sharing/add-receiver` 更新即可。

### Q: 支持多级分销吗？
**A**: 当前仅支持一级分销。如需多级，需要扩展代码逻辑。

---

**部署状态**: 代码已推送到 GitHub/Vercel，等待部署生效。
