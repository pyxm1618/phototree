# 完整部署和测试清单

## ✅ 您已完成
- [x] 微信商户平台开通分账功能

## 📋 待完成步骤

### 第一步：添加分账接收方（微信商户平台）

详细操作请查看：[`ADD_RECEIVER_GUIDE.md`](./ADD_RECEIVER_GUIDE.md)

**简要步骤**：
1. 登录 https://pay.weixin.qq.com
2. 产品中心 → 分账 → 分账接收方管理
3. 点击「新增分账接收方」
4. 填写信息：
   - 类型：个人
   - 账号：KOL 的 OpenID（见下方获取方法）
   - 关系：合作伙伴
5. 提交并等待审核通过

**如何获取 KOL 的 OpenID**：
```bash
# 方法1：让 KOL 访问 https://aiguess.cn 登录后
# 在 Vercel Postgres 控制台执行：
SELECT openid, nickname FROM users WHERE nickname LIKE '%KOL名字%' ORDER BY created_at DESC LIMIT 5;
```

---

### 第二步：执行数据库迁移

**在 Vercel Postgres 控制台**执行以下 SQL：

#### 1. 分销系统基础表（如果还没执行）
```sql
-- 复制 backend/init-db.sql 的内容并执行
```

#### 2. 分账功能表
```sql
-- 复制 backend/profit-sharing-migration.sql 的内容并执行
```

或者等 Vercel 部署完成后，访问：
```
https://aiguess.cn/api/dev/init-db
```

---

### 第三步：绑定 OpenID 到邀请码

当分账接收方审核通过后，执行：

```bash
curl -X POST https://aiguess.cn/api/admin/profit-sharing/add-receiver \
  -H "Content-Type: application/json" \
  -d '{
    "referralCode": "KOL_XIAOMING",
    "openid": "oXXXXXXXXXXXXXXXXXXXX",
    "sharingPercentage": 10.00
  }'
```

**替换以下内容**：
- `KOL_XIAOMING` → 您在管理后台创建的邀请码
- `oXXXXXXXX` → 从数据库查到的 KOL OpenID
- `10.00` → 分账比例（10 表示 10%）

---

### 第四步：创建测试邀请码

1. 打开管理后台：`backend/admin/index.html`
2. 滚动到底部「创建新邀请码」
3. 填写：
   - 邀请码：`TEST_SHARING`
   - KOL名称：`测试用户`
   - 佣金比例：`10`
4. 点击「创建」
5. 点击右侧的「📷 二维码」按钮保存

---

### 第五步：测试完整流程

#### 5.1 测试邀请追踪
```bash
# 访问邀请链接
https://aiguess.cn/?ref=TEST_SHARING

# 检查后台数据是否更新（PV +1）
```

#### 5.2 测试分账（小额订单）

**准备工作**：
1. 先将 `TEST_SHARING` 绑定到您自己的 OpenID（测试用）
   ```bash
   curl -X POST https://aiguess.cn/api/admin/profit-sharing/add-receiver \
     -H "Content-Type: application/json" \
     -d '{
       "referralCode": "TEST_SHARING",
       "openid": "您自己的OpenID",
       "sharingPercentage": 10.00
     }'
   ```

2. 在商户平台添加您自己为分账接收方

**测试步骤**：
1. 通过邀请链接 `?ref=TEST_SHARING` 访问
2. 登录并购买 VIP（18元）
3. 支付成功后，检查：
   - ✅ 您的零钱是否收到 1.8元
   - ✅ 管理后台的「注册用户」和「付费用户」是否+1
   - ✅ 查询分账记录：
     ```bash
     curl https://aiguess.cn/api/admin/profit-sharing/records
     ```

---

## 🧪 验证检查清单

运行以下命令检查各项功能：

### 1. 检查后台数据
```bash
curl -s https://aiguess.cn/api/admin/stats | jq
```

### 2. 检查分账记录
```bash
curl -s https://aiguess.cn/api/admin/profit-sharing/records | jq
```

### 3. 检查邀请码统计
```bash
curl -s https://aiguess.cn/api/referral/stats/TEST_SHARING | jq
```

---

## ⚠️ 常见问题排查

### 问题1：API 返回 404
**原因**：Vercel 部署未完成
**解决**：等待几分钟，或检查 Vercel Dashboard 的部署状态

### 问题2：分账失败
**可能原因**：
- 接收方未在商户平台添加
- 接收方审核未通过
- OpenID 不正确（不是当前 AppID 下的）

**检查方法**：
```bash
# 查看分账记录的错误信息
curl https://aiguess.cn/api/admin/profit-sharing/records | jq '.records[] | select(.status=="failed")'
```

### 问题3：管理后台数据为空
**原因**：数据库未初始化
**解决**：访问 `https://aiguess.cn/api/dev/init-db`

---

## 📞 需要帮助？

如果遇到问题，请提供：
1. 具体在哪一步卡住了
2. 错误信息或截图
3. 相关 API 的返回结果

---

**预计完成时间**：30-60分钟（包括审核等待时间）
