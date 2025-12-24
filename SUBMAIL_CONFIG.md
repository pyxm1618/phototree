# SUBMAIL 短信配置指南（修正版）

## ✅ 检查完成

已根据 SUBMAIL 官方文档（https://www.mysubmail.com/lab/vm6rm1）修正实现。

## 修正内容

### ❌ 之前的错误实现
- 使用了 `sms/xsend` 模板 API
- 使用了复杂的 MD5 签名
- 需要创建模板（多一步操作）

### ✅ 现在的正确实现
- 使用 `message/send.json` 普通短信 API
- 直接用 App Key 作为 signature（`sign_type=normal`）
- 不需要模板，直接发送内容

## 配置步骤（简化版）

### 1. 注册并实名认证
访问：https://www.mysubmail.com/signup

### 2. 获取凭证
登录后进入：**开发者中心 → API 凭证**

记录：
- **APP ID**：例如 `12345`
- **APP KEY**：例如 `abc123def456...`

### 3. 充值
**财务中心 → 在线充值**

建议：50元（约1000条）

### 4. 配置环境变量

**您需要提供给我**：
```
SMS_PROVIDER=submail
SUBMAIL_APP_ID=您的APPID
SUBMAIL_APP_KEY=您的APPKEY
```

**注意**：不再需要 `SUBMAIL_TEMPLATE_ID`，因为我们用的是普通短信 API！

## 短信格式

系统会自动发送：
```
【PhotoTree】您的验证码是123456，5分钟内有效。
```

**签名 `【PhotoTree】` 是必须的**，如果SUBMAIL拒绝，可能需要在后台申请签名。

## 测试

配置好环境变量后，访问：
```
https://www.aiguess.cn/login-phone.html
```

输入手机号 → 点击"获取验证码" → 应该会收到短信！

---

**现在只需要 2 个凭证**：APP ID + APP KEY，比之前简单多了！
