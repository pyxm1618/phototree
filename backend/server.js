const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = 3000;

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
    WECHAT_APP_SECRET, // Add Secret
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
// Helper: Build Authorization Header
function buildAuthHeader(method, url, body) {
    if (!process.env.WECHAT_PRIVATE_KEY || !process.env.WECHAT_MCH_ID || !process.env.WECHAT_CERT_SERIAL_NO) {
        throw new Error("Missing WeChat Pay credentials");
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(16).toString('hex');

    let privateKey = process.env.WECHAT_PRIVATE_KEY;

    // FIX: Handle Vercel Env Var Newlines
    // If key contains literal "\n" characters (common in Vercel), replace them with real newlines
    if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
    }

    // Check if key is base64 encoded (legacy logic, but good to keep optional)
    // Only attempt decode if it DOES NOT look like a PEM key
    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        try {
            const decoded = Buffer.from(privateKey, 'base64').toString('utf-8');
            if (decoded.includes('-----BEGIN PRIVATE KEY-----')) {
                privateKey = decoded;
            }
        } catch (e) {/* ignore */ }
    }

    const signature = generateSignature(method, url, timestamp, nonce, body, privateKey);

    return `WECHATPAY2-SHA256-RSA2048 mchid="${process.env.WECHAT_MCH_ID}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${process.env.WECHAT_CERT_SERIAL_NO}"`;
}

// --- API Routes ---

/**
 * @route POST /api/login
 * @desc Handle WeChat Login
 */
// [DEPRECATED] Mini Program Login - Kept for reference or future Mini Program support
app.post('/api/login', async (req, res) => {
    // ... existing mock/logic kept as is or simplifed ...
    // For now I'll just leave it but maybe add a comment.
    // Actually, I should probably leave it for local mock dev.
    const { code } = req.body;

    // Local Dev Mock
    if (!code || code.startsWith('dev_')) {
        const mockOpenId = code ? `user_${code}` : `dev_user_${Date.now()}`;
        return handleUserLogin(mockOpenId, res);
    }

    res.status(400).json({ error: "Use Website QR Login instead" });
});

/**
 * @route GET /api/callback/wechat
 * @desc Handle WeChat OAuth2 Callback (Website Application)
 */
app.get('/api/callback/wechat', async (req, res) => {
    const { code, state } = req.query;
    console.log(`[Callback] Received code: ${code}`);

    if (!code) {
        return res.redirect('/?error=no_code');
    }

    try {
        const APP_ID = process.env.WECHAT_APP_ID;
        const APP_SECRET = process.env.WECHAT_APP_SECRET;

        // Website App uses 'oauth2/access_token'
        const url = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${APP_ID}&secret=${APP_SECRET}&code=${code}&grant_type=authorization_code`;

        const response = await axios.get(url);
        const data = response.data;

        if (data.errcode) {
            console.error('[Callback] WeChat API Error:', data);
            return res.redirect(`/?error=wechat_api_error&msg=${data.errmsg}`);
        }

        const openid = data.openid;
        const accessToken = data.access_token;

        console.log(`[Callback] Authenticated OpenID: ${openid}`);

        // Get User Info (Nickname, Avatar)
        let nickname = '微信用户';
        let avatarUrl = '';
        try {
            const userInfoUrl = `https://api.weixin.qq.com/sns/userinfo?access_token=${accessToken}&openid=${openid}&lang=zh_CN`;
            const userRes = await axios.get(userInfoUrl);
            if (userRes.data && !userRes.data.errcode) {
                nickname = userRes.data.nickname;
                avatarUrl = userRes.data.headimgurl;
                console.log(`[Callback] Fetched User Info: ${nickname}`);
            }
        } catch (err) {
            console.error('[Callback] Failed to fetch user info:', err.message);
        }

        // Ensure user exists and update profile
        await ensureUserExists(openid, nickname, avatarUrl);

        // Redirect back to home with openid (In production, use a secure session/token)
        // For MVP: Passing openid in query is risky but functional for this "toy" project.
        res.redirect(`/?openid=${openid}&login_success=true`);

    } catch (error) {
        console.error('[Callback] System Error:', error);
        res.redirect('/?error=system_error');
    }
});

async function ensureUserExists(openid, nickname = '微信用户', avatarUrl = '') {
    try {
        const result = await db.query("SELECT * FROM users WHERE openid = $1", [openid]);
        if (!result.rows[0]) {
            console.log(`[DB] Creating new user: ${openid}`);
            await db.query("INSERT INTO users (openid, nickname, avatar_url) VALUES ($1, $2, $3)", [openid, nickname, avatarUrl]);
        } else {
            // Update profile on every login
            await db.query("UPDATE users SET nickname = $1, avatar_url = $2 WHERE openid = $3", [nickname, avatarUrl, openid]);
        }
    } catch (err) {
        console.error('[DB] User Ensure Error:', err);
    }
}

async function handleUserLogin(openid, res) {
    try {
        const result = await db.query("SELECT * FROM users WHERE openid = $1", [openid]);
        const row = result.rows[0];

        if (row) {
            console.log(`[Login] User found: ${openid}`);
            res.json({ success: true, user: row });
        } else {
            console.log(`[Login] Creating new user: ${openid}`);
            const insertResult = await db.query("INSERT INTO users (openid) VALUES ($1) RETURNING *", [openid]);
            const newUser = insertResult.rows[0];
            res.json({ success: true, user: newUser });
        }
    } catch (err) {
        console.error('[DB] Login Error:', err);
        res.status(500).json({ error: err.message });
    }
}

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
            try {
                await db.query("UPDATE users SET is_vip = 1, vip_expire_time = $1 WHERE openid = $2", [expireTime, openid]);
                console.log(`[Pay] ✅ User ${openid} upgraded to Premium via callback`);
            } catch (err) {
                console.error("[Pay] Failed to update VIP:", err);
            }
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
app.post('/api/dev/force-vip', async (req, res) => {
    const { openid } = req.body;
    // Lifetime VIP (High year)
    const expireTime = 4102444800000; // Year 2100

    console.log(`[Emergency] Manually upgrading ${openid} to VIP`);

    try {
        await db.query("UPDATE users SET is_vip = 1, vip_expire_time = $1 WHERE openid = $2", [expireTime, openid]);
        console.log(`[Emergency] ✅ User ${openid} upgraded to Premium`);
        res.json({ success: true, message: "User is now Premium" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route GET /api/user/:openid
 * @desc Get latest user status
 */
app.get('/api/user/:openid', async (req, res) => {
    const { openid } = req.params;
    try {
        const result = await db.query("SELECT * FROM users WHERE openid = $1", [openid]);
        const row = result.rows[0];
        if (!row) return res.status(404).json({ error: "User not found" });
        res.json({ success: true, user: row });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [DEBUG] Check Environment Variables
app.get('/api/dev/check-env', (req, res) => {
    const envStatus = {
        POSTGRES_URL: process.env.POSTGRES_URL ? 'EXISTS' : 'MISSING',
        POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING ? 'EXISTS' : 'MISSING',
        WECHAT_APP_ID: process.env.WECHAT_APP_ID ? 'EXISTS' : 'MISSING',
        WECHAT_APP_SECRET: process.env.WECHAT_APP_SECRET ? 'EXISTS' : 'MISSING',
    };
    res.json(envStatus);
});

// [DEBUG] Manual DB Init Route
app.get('/api/dev/init-db', async (req, res) => {
    try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            openid TEXT UNIQUE NOT NULL,
            nickname TEXT,
            avatar_url TEXT,
            is_vip INTEGER DEFAULT 0,
            vip_expire_time BIGINT DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `);
        // Add columns if not exist (for existing tables)
        try {
            await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT;");
            await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;");
        } catch (e) {
            console.log("Columns likely exist or error ignored:", e.message);
        }
        res.send("Database initialized/updated successfully!");
    } catch (err) {
        console.error("Init DB Error:", err);
        res.status(500).send("Init failed: " + err.message);
    }
});

/**
 * @route GET /api/dev/check-pay-config
 * @desc Validate WeChat Pay Credentials & Crypto
 */
app.get('/api/dev/check-pay-config', (req, res) => {
    try {
        const results = {
            env: {
                WECHAT_APP_ID: process.env.WECHAT_APP_ID ? 'Set' : 'Missing',
                WECHAT_MCH_ID: process.env.WECHAT_MCH_ID ? 'Set' : 'Missing',
                WECHAT_API_V3_KEY: process.env.WECHAT_API_V3_KEY ? 'Set' : 'Missing',
                WECHAT_CERT_SERIAL_NO: process.env.WECHAT_CERT_SERIAL_NO ? 'Set' : 'Missing',
                WECHAT_PRIVATE_KEY: process.env.WECHAT_PRIVATE_KEY ? 'Set (len=' + process.env.WECHAT_PRIVATE_KEY.length + ')' : 'Missing'
            },
            cryptoTest: 'Pending'
        };

        // 1. Process Key
        let privateKey = process.env.WECHAT_PRIVATE_KEY;
        if (privateKey) {
            if (privateKey.includes('\\n')) privateKey = privateKey.replace(/\\n/g, '\n');
            // Try base64
            if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
                try {
                    const decoded = Buffer.from(privateKey, 'base64').toString('utf-8');
                    if (decoded.includes('-----BEGIN PRIVATE KEY-----')) privateKey = decoded;
                } catch (e) { }
            }
        }

        // 2. Test Sign
        try {
            const sign = crypto.createSign('RSA-SHA256');
            sign.update('test_message');
            const signature = sign.sign(privateKey, 'base64');
            results.cryptoTest = `Success (Sig len: ${signature.length})`;
        } catch (e) {
            results.cryptoTest = `FAILED: ${e.message}`;
            console.error("Crypto Test Failed:", e);
        }

        res.json(results);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Conditionally listen (Local Dev)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n>>> Backend running at http://localhost:${PORT}`);
    });
}

// Export for Vercel
module.exports = app;