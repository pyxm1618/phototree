const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

app.use(cors());
app.use(bodyParser.json());

// Serve Static Frontend (Clean Structure: Backend serves sibling Frontend)
app.use(express.static(path.join(__dirname, '../frontend')));

// --- Configuration ---
const crypto = require('crypto');
const axios = require('axios');

// Load Env Vars
const {
    WECHAT_APP_ID,
    WECHAT_MCH_ID,
    WECHAT_API_V3_KEY,
    WECHAT_CERT_SERIAL_NO,
    WECHAT_PRIVATE_KEY
} = process.env;

// Helper: Generate WeChat Pay V3 Signature
function generateSignature(method, url, timestamp, nonce, body, privateKey) {
    const message = `${method}\n${url}\n${timestamp}\n${nonce}\n${body}\n`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(message);
    return sign.sign(privateKey, 'base64');
}

// Helper: Build Authorization Header
function buildAuthHeader(method, url, body) {
    if (!WECHAT_PRIVATE_KEY || !WECHAT_MCH_ID || !WECHAT_CERT_SERIAL_NO) {
        throw new Error("Missing WeChat Pay credentials");
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(16).toString('hex');

    // Decode Base64 private key
    let privateKey;
    try {
        privateKey = Buffer.from(WECHAT_PRIVATE_KEY, 'base64').toString('utf-8');
    } catch (e) {
        // If not Base64, use as-is
        privateKey = WECHAT_PRIVATE_KEY;
    }

    const signature = generateSignature(method, url, timestamp, nonce, body, privateKey);

    return `WECHATPAY2-SHA256-RSA2048 mchid="${WECHAT_MCH_ID}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${WECHAT_CERT_SERIAL_NO}"`;
}

// --- API Routes ---

/**
 * @route POST /api/login
 * @desc Handle WeChat Login
 */
app.post('/api/login', (req, res) => {
    const { code } = req.body;
    const mockOpenId = code ? `user_${code}` : `user_${Date.now()}`;
    console.log(`[Login] Attempting login for openid: ${mockOpenId}`);

    db.get("SELECT * FROM users WHERE openid = ?", [mockOpenId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            res.json({ success: true, user: row });
        } else {
            db.run("INSERT INTO users (openid) VALUES (?)", [mockOpenId], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, user: { id: this.lastID, openid: mockOpenId, is_vip: 0 } });
            });
        }
    });
});

/**
 * @route POST /api/pay/create-order
 * @desc Create a Native Pay Transaction (QR Code)
 */
app.post('/api/pay/create-order', async (req, res) => {
    const { openid } = req.body;
    if (!openid) return res.status(400).json({ error: "Missing openid" });

    // Check credentials
    if (!WECHAT_APP_ID || !WECHAT_MCH_ID || !WECHAT_API_V3_KEY || !WECHAT_CERT_SERIAL_NO || !WECHAT_PRIVATE_KEY) {
        return res.status(500).json({
            success: false,
            error: "WeChat Pay not configured. Please contact administrator."
        });
    }

    // Real Payment Mode - 使用 PT 前缀便于 Mirauni 网关识别
    const outTradeNo = `PT_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const description = "Premium Product - Lifetime Access";

    try {
        console.log(`[Pay] Creating Native Order: ${outTradeNo} for ${openid}`);

        const requestBody = {
            appid: WECHAT_APP_ID,
            mchid: WECHAT_MCH_ID,
            description: description,
            out_trade_no: outTradeNo,
            notify_url: `https://mirauni.com/api/payment/wechat/notify?app=phototree`,
            amount: {
                total: 1, // 0.01 CNY
                currency: 'CNY'
            },
            attach: JSON.stringify({ openid: openid, app: 'phototree' })
        };

        const url = '/v3/pay/transactions/native';
        const method = 'POST';
        const bodyStr = JSON.stringify(requestBody);

        const authHeader = buildAuthHeader(method, url, bodyStr);

        const response = await axios.post(`https://api.mch.weixin.qq.com${url}`, requestBody, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader,
                'Accept': 'application/json'
            }
        });

        if (response.data && response.data.code_url) {
            res.json({
                success: true,
                codeUrl: response.data.code_url,
                orderId: outTradeNo
            });
        } else {
            console.error("WxPay Error:", response.data);
            res.status(500).json({ error: "Failed to create WeChat order", details: response.data });
        }

    } catch (error) {
        console.error("Payment Creation Failed:", error.response?.data || error.message);
        res.status(500).json({
            error: error.message,
            details: error.response?.data
        });
    }
});

/**
 * Helper: Decrypt WeChat Pay V3 callback data
 * Uses AES-256-GCM algorithm
 */
function decryptWeChatPayData(ciphertext, associatedData, nonce, apiV3Key) {
    try {
        // Convert base64 to buffer
        const ciphertextBuffer = Buffer.from(ciphertext, 'base64');
        const nonceBuffer = Buffer.from(nonce, 'utf8');
        const associatedDataBuffer = Buffer.from(associatedData, 'utf8');

        // API V3 Key is 32 bytes
        const keyBuffer = Buffer.from(apiV3Key, 'utf8');

        // Extract auth tag (last 16 bytes)
        const authTag = ciphertextBuffer.slice(-16);
        const encryptedData = ciphertextBuffer.slice(0, -16);

        // Create decipher
        const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, nonceBuffer);
        decipher.setAuthTag(authTag);
        decipher.setAAD(associatedDataBuffer);

        // Decrypt
        let decrypted = decipher.update(encryptedData, null, 'utf8');
        decrypted += decipher.final('utf8');

        return JSON.parse(decrypted);
    } catch (error) {
        console.error("[Pay] Decryption failed:", error.message);
        throw error;
    }
}

/**
 * @route POST /api/pay/notify
 * @desc Handle WeChat Pay Callback (forwarded from Mirauni gateway)
 */
app.post('/api/pay/notify', async (req, res) => {
    console.log("[Pay] Notification Received - Full Body:", JSON.stringify(req.body, null, 2));

    // 验证来源（可选，简单防护）
    const forwardedFrom = req.headers['x-forwarded-from'];
    if (forwardedFrom) {
        console.log(`[Pay] Request forwarded from: ${forwardedFrom}`);
    }

    try {
        const { resource, event_type } = req.body;

        if (!resource) {
            console.warn("[Pay] No resource field in callback");
            return res.status(200).json({ code: "SUCCESS", message: "OK" });
        }

        let paymentData;

        // Decrypt if encrypted
        if (resource.ciphertext && resource.nonce && resource.associated_data) {
            console.log("[Pay] Decrypting callback data...");

            if (!WECHAT_API_V3_KEY) {
                console.error("[Pay] Missing API V3 Key for decryption");
                return res.status(200).json({ code: "SUCCESS", message: "OK" });
            }

            paymentData = decryptWeChatPayData(
                resource.ciphertext,
                resource.associated_data,
                resource.nonce,
                WECHAT_API_V3_KEY
            );

            console.log("[Pay] Decrypted Payment Data:", paymentData);
        } else {
            // Direct data (from Mirauni forwarding)
            paymentData = resource;
            console.log("[Pay] Direct Payment Data:", paymentData);
        }

        // Extract openid from attach field (支持 JSON 格式)
        let openid;
        try {
            const attachData = JSON.parse(paymentData.attach);
            openid = attachData.openid;
            console.log(`[Pay] Parsed attach: app=${attachData.app}, openid=${openid}`);
        } catch (e) {
            // 兼容旧格式
            openid = paymentData.attach || paymentData.payer?.openid;
        }

        const tradeState = paymentData.trade_state;
        const outTradeNo = paymentData.out_trade_no;

        console.log(`[Pay] Order: ${outTradeNo}, Trade State: ${tradeState}, OpenID: ${openid}`);

        if (tradeState === 'SUCCESS' && openid) {
            const expireTime = 4102444800000; // Year 2100
            db.run("UPDATE users SET is_vip = 1, vip_expire_time = ? WHERE openid = ?", [expireTime, openid], (err) => {
                if (err) {
                    console.error("[Pay] Failed to update VIP:", err);
                } else {
                    console.log(`[Pay] ✅ User ${openid} upgraded to Premium via callback`);
                }
            });
        } else {
            console.warn(`[Pay] Payment not successful or missing openid. State: ${tradeState}, OpenID: ${openid}`);
        }

        // Always return success to WeChat to prevent retries
        res.status(200).json({ code: "SUCCESS", message: "OK" });
    } catch (error) {
        console.error("[Pay] Notify Error:", error);
        // Still return success to prevent WeChat from retrying
        res.status(200).json({ code: "SUCCESS", message: "OK" });
    }
});

/**
 * @route POST /api/dev/force-vip
 * @desc [EMERGENCY] Manually set VIP (Use after confirmed payment)
 */
app.post('/api/dev/force-vip', (req, res) => {
    const { openid } = req.body;
    // Lifetime VIP (High year)
    const expireTime = 4102444800000; // Year 2100

    console.log(`[Emergency] Manually upgrading ${openid} to VIP`);

    db.run("UPDATE users SET is_vip = 1, vip_expire_time = ? WHERE openid = ?", [expireTime, openid], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        console.log(`[Emergency] ✅ User ${openid} upgraded to Premium`);
        res.json({ success: true, message: "User is now Premium" });
    });
});

/**
 * @route GET /api/user/:openid
 * @desc Get latest user status
 */
app.get('/api/user/:openid', (req, res) => {
    const { openid } = req.params;
    db.get("SELECT * FROM users WHERE openid = ?", [openid], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "User not found" });
        res.json({ success: true, user: row });
    });
});

// Conditionally listen (Local Dev)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n>>> Backend running at http://localhost:${PORT}`);
    });
}

// Export for Vercel
module.exports = app;
