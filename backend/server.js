require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;


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
    const { code, state, ref, device } = req.query; // 添加 ref 和 device 参数
    console.log(`[Callback] Received code: ${code}, ref: ${ref}, device: ${device}`);

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

        // Ensure user exists and update profile with referrer code and device type
        await ensureUserExists(openid, nickname, avatarUrl, ref || null, device || 'unknown');

        // Redirect back to home with openid (In production, use a secure session/token)
        // For MVP: Passing openid in query is risky but functional for this "toy" project.
        res.redirect(`/?openid=${openid}&login_success=true`);

    } catch (error) {
        console.error('[Callback] System Error:', error);
        res.redirect('/?error=system_error');
    }
});


async function ensureUserExists(openid, nickname = '微信用户', avatarUrl = '', referrerCode = null, deviceType = 'unknown') {
    try {
        const result = await db.query("SELECT * FROM users WHERE openid = $1", [openid]);
        if (!result.rows[0]) {
            console.log(`[DB] Creating new user: ${openid} (ref: ${referrerCode}, device: ${deviceType})`);
            await db.query(
                "INSERT INTO users (openid, nickname, avatar_url, referrer_code, device_type) VALUES ($1, $2, $3, $4, $5)",
                [openid, nickname, avatarUrl, referrerCode, deviceType]
            );
        } else {
            // Update profile on every login, but don't overwrite referrer_code if already set
            const updateQuery = result.rows[0].referrer_code
                ? "UPDATE users SET nickname = $1, avatar_url = $2, device_type = $3 WHERE openid = $4"
                : "UPDATE users SET nickname = $1, avatar_url = $2, referrer_code = $3, device_type = $4 WHERE openid = $5";

            const updateParams = result.rows[0].referrer_code
                ? [nickname, avatarUrl, deviceType, openid]
                : [nickname, avatarUrl, referrerCode, deviceType, openid];

            await db.query(updateQuery, updateParams);
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
// [Modified] Create Order - Returns 200 even on failure to ensure frontend alert sees the message
app.post('/api/pay/create-order', async (req, res) => {
    const { openid } = req.body;
    if (!openid) return res.json({ success: false, error: "Missing openid" });

    // Check credentials (using process.env directly)
    if (!process.env.WECHAT_APP_ID || !process.env.WECHAT_MCH_ID || !process.env.WECHAT_API_V3_KEY || !process.env.WECHAT_CERT_SERIAL_NO || !process.env.WECHAT_PRIVATE_KEY) {
        return res.json({
            success: false,
            error: "WeChat Pay not configured. Env Vars missing."
        });
    }

    // Real Payment Mode - 使用 PT 前缀便于 Mirauni 网关识别
    const outTradeNo = `PT_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const description = "Premium Product - Lifetime Access";

    try {
        console.log(`[Pay] Creating Native Order: ${outTradeNo} for ${openid}`);

        // STRATEGY: Two-AppID Mode
        // Login: Website AppID (wxb243...) - Used for user auth
        // Payment: Mini Program AppID (wx746...) - Used for payment generation (Must be bound to Merchant)
        // Native Pay does not check OpenID against AppID during order creation, so this is safe.
        const PAY_APP_ID = 'wx746a39363f67ae95'; // 小树荫助手 (Verified from user screenshot)

        // 查询用户的邀请码
        let referrerCode = null;
        try {
            const userResult = await db.query('SELECT referrer_code FROM users WHERE openid = $1', [openid]);
            if (userResult.rows[0]?.referrer_code) {
                referrerCode = userResult.rows[0].referrer_code;
                console.log(`[Pay] User has referrer: ${referrerCode}`);
            }
        } catch (err) {
            console.error('[Pay] Failed to query referrer_code:', err);
        }

        const requestBody = {
            appid: PAY_APP_ID,
            mchid: process.env.WECHAT_MCH_ID,
            description: description,
            out_trade_no: outTradeNo,
            // FIX: WeChat API does not allow query params in notify_url
            // We use 'attach' field to pass custom data
            notify_url: `https://aiguess.cn/api/pay/notify`,
            amount: {
                total: 1800, // 18 CNY (圣诞特惠价)
                currency: 'CNY'
            },
            attach: JSON.stringify({
                openid: openid,
                app: 'phototree',
                referrer_code: referrerCode  // 添加邀请码信息
            })
        };

        // 如果有邀请码，标记为分账订单
        if (referrerCode) {
            requestBody.settle_info = {
                profit_sharing: true
            };
            console.log('[Pay] Order marked for profit sharing');
        }

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
            console.error("WxPay Error Response:", response.data);
            res.json({ success: false, error: "微信返回错误", details: response.data });
        }

    } catch (error) {
        // Capture WeChat API Error Details
        const wxError = error.response?.data;
        console.error("Payment Creation Exception:", JSON.stringify(wxError || error.message));

        // Return 200 so frontend alert stringifies the details
        res.json({
            success: false,
            error: `Payment Failed (${error.response?.status || 500}): ${error.message}`,
            details: wxError || error.response?.statusText || "No details"
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

        // Extract openid and referrer_code from attach field (支持 JSON 格式)
        let openid, referrerCode;
        try {
            const attachData = JSON.parse(paymentData.attach);
            openid = attachData.openid;
            referrerCode = attachData.referrer_code;
            console.log(`[Pay] Parsed attach: app=${attachData.app}, openid=${openid}, referrer=${referrerCode}`);
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

                // 执行分账（如果有邀请码）
                if (referrerCode) {
                    console.log(`[Pay] Attempting profit sharing for referrer: ${referrerCode}`);
                    const sharingResult = await executeProfitSharing(
                        paymentData.transaction_id,
                        outTradeNo,
                        referrerCode,
                        paymentData.amount?.total || 1800
                    );

                    if (sharingResult.success) {
                        console.log(`[Pay] 🎉 Profit sharing completed: ${sharingResult.orderNo}`);
                    } else {
                        console.warn(`[Pay] Profit sharing failed: ${sharingResult.reason || sharingResult.error}`);
                    }
                }
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
 * @route POST /api/track/pv
 * @desc Record page view for UV/PV tracking
 */
app.post('/api/track/pv', async (req, res) => {
    const { sessionId, referrerCode, deviceType, userAgent } = req.body;
    const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    try {
        await db.query(
            `INSERT INTO page_views (session_id, referrer_code, device_type, user_agent, ip_address) 
             VALUES ($1, $2, $3, $4, $5)`,
            [sessionId, referrerCode || null, deviceType || 'unknown', userAgent || '', ipAddress]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('[Track] PV Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route POST /api/referral/create
 * @desc Create a new referral code (Admin only)
 */
app.post('/api/referral/create', async (req, res) => {
    const { code, ownerName, ownerContact, commissionRate, notes } = req.body;

    if (!code || !ownerName) {
        return res.status(400).json({ error: 'Code and owner name are required' });
    }

    try {
        const result = await db.query(
            `INSERT INTO referral_codes (code, owner_name, owner_contact, commission_rate, notes) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [code, ownerName, ownerContact || null, commissionRate || 0, notes || null]
        );
        console.log(`[Referral] Created code: ${code} for ${ownerName}`);
        res.json({ success: true, referralCode: result.rows[0] });
    } catch (err) {
        console.error('[Referral] Create Error:', err);
        if (err.code === '23505') { // Unique violation
            res.status(400).json({ error: 'Referral code already exists' });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

/**
 * @route POST /api/referral/generate
 * @desc 用户自助生成专属邀请码（自动绑定 OpenID 和微信分账）
 */
app.post('/api/referral/generate', async (req, res) => {
    const { openid } = req.body;

    if (!openid) {
        return res.status(400).json({ error: '请先登录' });
    }

    try {
        // 1. 检查用户是否已有邀请码
        const existing = await db.query(
            'SELECT * FROM referral_codes WHERE receiver_openid = $1 AND is_active = true',
            [openid]
        );

        if (existing.rows.length > 0) {
            // 已有邀请码，直接返回
            const code = existing.rows[0].code;
            return res.json({
                success: true,
                isNew: false,
                code: code,
                url: `https://www.aiguess.cn/?ref=${code}`,
                message: '您已有专属邀请码'
            });
        }

        // 2. 获取用户信息
        const userResult = await db.query(
            'SELECT nickname, avatar_url FROM users WHERE openid = $1',
            [openid]
        );
        const nickname = userResult.rows[0]?.nickname || '推广用户';

        // 3. 生成唯一邀请码（6位，排除易混淆字符）
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code;
        let isUnique = false;
        let attempts = 0;

        while (!isUnique && attempts < 10) {
            code = '';
            for (let i = 0; i < 6; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            // 检查是否重复
            const checkResult = await db.query('SELECT code FROM referral_codes WHERE code = $1', [code]);
            if (checkResult.rows.length === 0) {
                isUnique = true;
            }
            attempts++;
        }

        if (!isUnique) {
            return res.status(500).json({ error: '生成邀请码失败，请重试' });
        }

        // 4. 调用微信 API 添加分账接收方
        const PAY_APP_ID = 'wx746a39363f67ae95';
        const wechatUrl = '/v3/profitsharing/receivers/add';

        const requestBody = {
            appid: PAY_APP_ID,
            type: 'PERSONAL_OPENID',
            account: openid,
            relation_type: 'PARTNER'
        };

        const bodyStr = JSON.stringify(requestBody);
        const authHeader = buildAuthHeader('POST', wechatUrl, bodyStr);

        console.log(`[Referral] Adding receiver to WeChat: ${openid}`);

        try {
            await axios.post(`https://api.mch.weixin.qq.com${wechatUrl}`, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': authHeader,
                    'Accept': 'application/json'
                }
            });
            console.log(`[Referral] ✅ Receiver added to WeChat: ${openid}`);
        } catch (wechatErr) {
            // 如果是"已存在"错误，忽略
            if (!wechatErr.response?.data?.message?.includes('已存在')) {
                console.error('[Referral] WeChat API error:', wechatErr.response?.data || wechatErr.message);
                // 不阻断流程，继续保存
            }
        }

        // 5. 保存到数据库
        await db.query(
            `INSERT INTO referral_codes (code, owner_name, receiver_openid, commission_rate, sharing_percentage, is_active) 
             VALUES ($1, $2, $3, $4, $5, true)`,
            [code, nickname, openid, 0.30, 30.00]
        );

        console.log(`[Referral] ✅ Generated code: ${code} for ${nickname} (${openid})`);

        res.json({
            success: true,
            isNew: true,
            code: code,
            url: `https://www.aiguess.cn/?ref=${code}`,
            message: '专属邀请码生成成功！'
        });

    } catch (err) {
        console.error('[Referral] Generate Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route GET /api/referral/my-stats
 * @desc 获取当前用户的推广统计数据
 */
app.get('/api/referral/my-stats', async (req, res) => {
    const openid = req.query.openid;

    if (!openid) {
        return res.status(400).json({ error: '请先登录' });
    }

    try {
        // 获取用户的邀请码
        const codeResult = await db.query(
            'SELECT * FROM referral_codes WHERE receiver_openid = $1 AND is_active = true',
            [openid]
        );

        if (codeResult.rows.length === 0) {
            return res.json({
                success: true,
                hasCode: false,
                message: '您还没有生成邀请码'
            });
        }

        const code = codeResult.rows[0].code;

        // 获取统计数据
        const registeredUsers = await db.query(
            'SELECT COUNT(*) as count FROM users WHERE referrer_code = $1',
            [code]
        );

        const paidUsers = await db.query(
            'SELECT COUNT(*) as count FROM users WHERE referrer_code = $1 AND is_vip = 1',
            [code]
        );

        // 获取分账记录
        const sharingRecords = await db.query(
            'SELECT SUM(amount) as total_amount FROM profit_sharing_records WHERE referrer_code = $1 AND status = $2',
            [code, 'success']
        );

        const totalEarnings = parseInt(sharingRecords.rows[0]?.total_amount || 0) / 100; // 分转元

        res.json({
            success: true,
            hasCode: true,
            code: code,
            url: `https://www.aiguess.cn/?ref=${code}`,
            stats: {
                registeredUsers: parseInt(registeredUsers.rows[0].count),
                paidUsers: parseInt(paidUsers.rows[0].count),
                totalEarnings: totalEarnings.toFixed(2)
            }
        });

    } catch (err) {
        console.error('[Referral] My Stats Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route GET /api/referral/stats/:code
 * @desc Get statistics for a specific referral code
 */
app.get('/api/referral/stats/:code', async (req, res) => {
    const { code } = req.params;

    try {
        // Get referral code info
        const codeInfo = await db.query(
            'SELECT * FROM referral_codes WHERE code = $1',
            [code]
        );

        if (codeInfo.rows.length === 0) {
            return res.status(404).json({ error: 'Referral code not found' });
        }

        // Get registered users count
        const registeredUsers = await db.query(
            'SELECT COUNT(*) as count FROM users WHERE referrer_code = $1',
            [code]
        );

        // Get paid users count
        const paidUsers = await db.query(
            'SELECT COUNT(*) as count FROM users WHERE referrer_code = $1 AND is_vip = 1',
            [code]
        );

        // Get PV count from this referral code
        const pvCount = await db.query(
            'SELECT COUNT(*) as count FROM page_views WHERE referrer_code = $1',
            [code]
        );

        res.json({
            success: true,
            referralCode: codeInfo.rows[0],
            stats: {
                totalPV: parseInt(pvCount.rows[0].count),
                registeredUsers: parseInt(registeredUsers.rows[0].count),
                paidUsers: parseInt(paidUsers.rows[0].count),
                conversionRate: registeredUsers.rows[0].count > 0
                    ? ((paidUsers.rows[0].count / registeredUsers.rows[0].count) * 100).toFixed(2) + '%'
                    : '0%'
            }
        });
    } catch (err) {
        console.error('[Referral] Stats Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route GET /api/admin/stats
 * @desc Get overall platform statistics for admin dashboard
 */
app.get('/api/admin/stats', async (req, res) => {
    try {
        // Total UV (unique session_id)
        const uvResult = await db.query('SELECT COUNT(DISTINCT session_id) as count FROM page_views');

        // Total PV
        const pvResult = await db.query('SELECT COUNT(*) as count FROM page_views');

        // Total registered users
        const usersResult = await db.query('SELECT COUNT(*) as count FROM users');

        // Total paid users
        // Total paid users (WeChat only, excluding redemption codes)
        const paidResult = await db.query(`
            SELECT COUNT(*) as count 
            FROM users u 
            WHERE is_vip = 1 
            AND NOT EXISTS (SELECT 1 FROM redemption_codes r WHERE r.used_by = u.openid)
        `);

        // Device distribution
        const deviceResult = await db.query(`
            SELECT device_type, COUNT(*) as count 
            FROM page_views 
            GROUP BY device_type
        `);

        // Hourly stats (last 24 hours)
        const hourlyStats = await db.query(`
            SELECT 
                DATE_TRUNC('hour', created_at) as hour,
                COUNT(*) as pv,
                COUNT(DISTINCT session_id) as uv
            FROM page_views
            WHERE created_at >= NOW() - INTERVAL '24 hours'
            GROUP BY DATE_TRUNC('hour', created_at)
            ORDER BY hour DESC
        `);

        // Total all-time stats
        const totalStats = await db.query(`
            SELECT 
                COUNT(*) as total_pv,
                COUNT(DISTINCT session_id) as total_uv,
                MIN(created_at) as first_visit
            FROM page_views
        `);

        // Top referral codes (容错：如果 referrer_code 字段不存在则返回空)
        let topReferrals = { rows: [] };
        try {
            topReferrals = await db.query(`
                SELECT 
                    rc.code,
                    rc.owner_name,
                    rc.owner_contact,
                    COUNT(DISTINCT u.openid) as registered_users,
                    COUNT(DISTINCT CASE WHEN u.is_vip = 1 THEN u.openid END) as paid_users
                FROM referral_codes rc
                LEFT JOIN users u ON u.referrer_code = rc.code
                WHERE rc.is_active = true
                GROUP BY rc.code, rc.owner_name, rc.owner_contact
                ORDER BY paid_users DESC, registered_users DESC
                LIMIT 10
            `);
        } catch (e) {
            console.log('[Admin] topReferrals query failed (referrer_code may not exist):', e.message);
        }

        res.json({
            success: true,
            overview: {
                totalUV: parseInt(uvResult.rows[0].count),
                totalPV: parseInt(pvResult.rows[0].count),
                totalUsers: parseInt(usersResult.rows[0].count),
                paidUsers: parseInt(paidResult.rows[0].count),
                conversionRate: usersResult.rows[0].count > 0
                    ? ((paidResult.rows[0].count / usersResult.rows[0].count) * 100).toFixed(2) + '%'
                    : '0%'
            },
            deviceDistribution: deviceResult.rows.reduce((acc, row) => {
                // 更友好的设备名称
                const deviceName = row.device_type === 'pc' ? '电脑'
                    : row.device_type === 'mobile' ? '手机'
                        : row.device_type || '未知';
                acc[deviceName] = parseInt(row.count);
                return acc;
            }, {}),
            totalStats: totalStats.rows[0] || { total_pv: 0, total_uv: 0, first_visit: null },
            hourlyStats: hourlyStats.rows,
            topReferrals: topReferrals.rows
        });
    } catch (err) {
        console.error('[Admin] Stats Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route GET /api/admin/kol-stats
 * @desc 获取所有 KOL 统计（自助生成邀请码的用户）
 */
app.get('/api/admin/kol-stats', async (req, res) => {
    try {
        // 获取所有自助生成的邀请码（receiver_openid 不为空）
        const kolResult = await db.query(`
            SELECT 
                rc.code,
                rc.owner_name,
                rc.receiver_openid,
                rc.created_at,
                u.nickname,
                u.avatar_url,
                COUNT(DISTINCT invited.openid) as registered_count,
                COUNT(DISTINCT CASE 
                    WHEN invited.is_vip = 1 AND r_check.code IS NULL 
                    THEN invited.openid 
                END) as paid_count
            FROM referral_codes rc
            LEFT JOIN users u ON rc.receiver_openid = u.openid
            LEFT JOIN users invited ON invited.referrer_code = rc.code
            LEFT JOIN redemption_codes r_check ON r_check.used_by = invited.openid
            WHERE rc.receiver_openid IS NOT NULL AND rc.is_active = true
            GROUP BY rc.code, rc.owner_name, rc.receiver_openid, rc.created_at, u.nickname, u.avatar_url
            ORDER BY paid_count DESC, registered_count DESC, rc.created_at DESC
        `);

        // 获取每个 KOL 的分账收益
        const kolsWithEarnings = await Promise.all(kolResult.rows.map(async (kol) => {
            const earningsResult = await db.query(
                'SELECT COALESCE(SUM(amount), 0) as total FROM profit_sharing_records WHERE referrer_code = $1 AND status = $2',
                [kol.code, 'success']
            );
            return {
                ...kol,
                totalEarnings: parseInt(earningsResult.rows[0].total) / 100 // 分转元
            };
        }));

        // 汇总统计
        const totalKols = kolResult.rows.length;
        const totalRegistered = kolResult.rows.reduce((sum, k) => sum + parseInt(k.registered_count), 0);
        const totalPaid = kolResult.rows.reduce((sum, k) => sum + parseInt(k.paid_count), 0);
        const totalEarnings = kolsWithEarnings.reduce((sum, k) => sum + k.totalEarnings, 0);

        res.json({
            success: true,
            summary: {
                totalKols,
                totalRegistered,
                totalPaid,
                totalEarnings: totalEarnings.toFixed(2)
            },
            kols: kolsWithEarnings.map(k => ({
                code: k.code,
                nickname: k.nickname || k.owner_name,
                avatar: k.avatar_url,
                openid: k.receiver_openid,
                registeredCount: parseInt(k.registered_count),
                paidCount: parseInt(k.paid_count),
                totalEarnings: k.totalEarnings.toFixed(2),
                createdAt: k.created_at
            }))
        });

    } catch (err) {
        console.error('[Admin] KOL Stats Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route POST /api/admin/redemption/generate
 * @desc 批量生成兑换码（管理员）
 */
app.post('/api/admin/redemption/generate', async (req, res) => {
    const { count = 10 } = req.body;
    const maxCount = Math.min(count, 50); // 限制单次最多50个

    try {
        const codes = [];
        for (let i = 0; i < maxCount; i++) {
            // 生成 8 位大写字母+数字的兑换码
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易混淆的字符
            let code = '';
            for (let j = 0; j < 8; j++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }

            // 插入数据库
            try {
                await db.query(
                    'INSERT INTO redemption_codes (code, status) VALUES ($1, $2)',
                    [code, 'unused']
                );
                codes.push(code);
            } catch (err) {
                // 如果是唯一键冲突（重复），跳过；其他错误抛出
                if (err.code === '23505') {
                    console.log(`[Redemption] Code ${code} duplicate, skip`);
                } else {
                    throw err;
                }
            }
        }

        console.log(`[Redemption] Generated ${codes.length} codes`);
        res.json({ success: true, codes });

    } catch (err) {
        console.error('[Redemption] Generate Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Admin: Get Redemption Code List
app.get('/api/admin/redemption/list', async (req, res) => {
    try {
        const { limit = 100 } = req.query;
        const result = await db.query(
            'SELECT * FROM redemption_codes ORDER BY created_at DESC LIMIT $1',
            [limit]
        );
        res.json({ success: true, codes: result.rows });
    } catch (err) {
        console.error('[Redemption] List Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route POST /api/redemption/redeem
 * @desc 兑换码核销（用户）
 */
app.post('/api/redemption/redeem', async (req, res) => {
    const { code, openid } = req.body;

    if (!code || !openid) {
        return res.status(400).json({ error: '参数缺失' });
    }

    try {
        // 1. 查询兑换码
        const result = await db.query(
            'SELECT * FROM redemption_codes WHERE code = $1',
            [code.toUpperCase()]
        );

        if (result.rows.length === 0) {
            return res.json({ success: false, error: '兑换码不存在' });
        }

        const redemptionCode = result.rows[0];

        if (redemptionCode.status === 'used') {
            return res.json({ success: false, error: '兑换码已被使用' });
        }

        // 2. 更新用户 VIP 状态
        const vipExpireAt = new Date();
        vipExpireAt.setFullYear(vipExpireAt.getFullYear() + 1); // 一年有效期

        await db.query(
            `UPDATE users SET is_vip = 1, vip_expire_time = $1 WHERE openid = $2`,
            [vipExpireAt.getTime(), openid]
        );

        // 3. 标记兑换码已使用
        await db.query(
            `UPDATE redemption_codes SET status = 'used', used_at = NOW(), used_by = $1 WHERE code = $2`,
            [openid, code.toUpperCase()]
        );

        console.log(`[Redemption] Code ${code} redeemed by ${openid}`);

        res.json({
            success: true,
            message: '兑换成功！您已成为年度 Premium 会员',
            vipExpireAt: vipExpireAt.toISOString()
        });

    } catch (err) {
        console.error('[Redemption] Redeem Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Helper: 执行微信支付分账
 */
async function executeProfitSharing(transactionId, outTradeNo, referrerCode, totalAmount) {
    try {
        // 1. 查询分账接收方信息
        const receiverResult = await db.query(
            'SELECT receiver_openid, sharing_percentage, owner_name FROM referral_codes WHERE code = $1 AND receiver_openid IS NOT NULL',
            [referrerCode]
        );

        if (receiverResult.rows.length === 0) {
            console.log(`[ProfitSharing] No receiver configured for code: ${referrerCode}`);
            return { success: false, reason: 'no_receiver' };
        }

        const receiver = receiverResult.rows[0];

        // 2. 计算分账金额
        const sharingAmount = Math.floor(totalAmount * receiver.sharing_percentage / 100);

        if (sharingAmount < 1) {
            console.log(`[ProfitSharing] Sharing amount too small: ${sharingAmount}`);
            return { success: false, reason: 'amount_too_small' };
        }

        // 3. 校验分账比例上限（微信默认 30%）
        const MAX_SHARING_RATIO = 0.3;
        const maxAllowedAmount = Math.floor(totalAmount * MAX_SHARING_RATIO);

        if (sharingAmount > maxAllowedAmount) {
            console.error(`[ProfitSharing] Amount ${sharingAmount} exceeds max ${maxAllowedAmount} (${MAX_SHARING_RATIO * 100}% of ${totalAmount})`);
            return { success: false, reason: 'amount_exceeds_limit' };
        }

        console.log(`[ProfitSharing] Sharing ${sharingAmount}分 to ${receiver.receiver_openid} for order ${outTradeNo}`);

        // 3. 调用微信分账 API
        const PAY_APP_ID = 'wx746a39363f67ae95';
        const profitSharingOrderNo = `PS_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const url = '/v3/profitsharing/orders';

        const requestBody = {
            appid: PAY_APP_ID,
            transaction_id: transactionId,
            out_order_no: profitSharingOrderNo,
            receivers: [{
                type: 'PERSONAL_OPENID',
                account: receiver.receiver_openid,
                amount: sharingAmount,
                description: '邀请返佣'
            }],
            unfreeze_unsplit: false  // 不解冻剩余资金，允许后续继续分账
        };

        const bodyStr = JSON.stringify(requestBody);
        const authHeader = buildAuthHeader('POST', url, bodyStr);

        const response = await axios.post(`https://api.mch.weixin.qq.com${url}`, requestBody, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader,
                'Accept': 'application/json'
            }
        });

        // 4. 记录分账结果
        await db.query(
            `INSERT INTO profit_sharing_records 
             (out_order_no, transaction_id, referrer_code, receiver_openid, receiver_name, amount, status, wechat_order_id, description)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [profitSharingOrderNo, transactionId, referrerCode, receiver.receiver_openid,
                receiver.owner_name, sharingAmount, 'success', response.data.order_id, '邀请返佣']
        );

        console.log(`[ProfitSharing] ✅ Success: ${profitSharingOrderNo}`);
        return { success: true, orderNo: profitSharingOrderNo };

    } catch (error) {
        console.error('[ProfitSharing] Error:', error.response?.data || error.message);

        // 记录失败
        try {
            await db.query(
                `INSERT INTO profit_sharing_records 
                 (out_order_no, transaction_id, referrer_code, amount, status, error_message)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [`PS_FAILED_${Date.now()}`, transactionId, referrerCode, 0, 'failed',
                error.response?.data?.message || error.message]
            );
        } catch (dbErr) {
            console.error('[ProfitSharing] Failed to record error:', dbErr);
        }

        return { success: false, error: error.message };
    }
}

/**
 * @route POST /api/admin/profit-sharing/add-receiver
 * @desc 添加分账接收方（先调用微信API，再保存到数据库）
 */
app.post('/api/admin/profit-sharing/add-receiver', async (req, res) => {
    const { referralCode, openid, sharingPercentage } = req.body;

    if (!referralCode || !openid) {
        return res.status(400).json({ error: 'Missing referralCode or openid' });
    }

    try {
        // 1. 先调用微信 API 添加分账接收方
        const PAY_APP_ID = 'wx746a39363f67ae95';
        const url = '/v3/profitsharing/receivers/add';

        const requestBody = {
            appid: PAY_APP_ID,
            type: 'PERSONAL_OPENID',
            account: openid,
            relation_type: 'PARTNER'  // 合作伙伴
        };

        const bodyStr = JSON.stringify(requestBody);
        const authHeader = buildAuthHeader('POST', url, bodyStr);

        console.log(`[ProfitSharing] Adding receiver to WeChat: ${openid}`);

        const wechatResponse = await axios.post(`https://api.mch.weixin.qq.com${url}`, requestBody, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader,
                'Accept': 'application/json'
            }
        });

        console.log(`[ProfitSharing] WeChat API response:`, wechatResponse.data);

        // 2. 微信 API 成功后，保存到数据库
        await db.query(
            'UPDATE referral_codes SET receiver_openid = $1, sharing_percentage = $2 WHERE code = $3',
            [openid, sharingPercentage || 10.00, referralCode]
        );

        console.log(`[ProfitSharing] ✅ Receiver added: ${referralCode} -> ${openid}`);
        res.json({
            success: true,
            message: 'Receiver added to WeChat and saved',
            wechatResponse: wechatResponse.data
        });
    } catch (err) {
        console.error('[ProfitSharing] Add receiver error:', err.response?.data || err.message);

        // 如果微信 API 返回 "账户已存在"，也算成功
        if (err.response?.data?.code === 'PARAM_ERROR' && err.response?.data?.message?.includes('已存在')) {
            // 接收方已添加过，直接保存到数据库
            await db.query(
                'UPDATE referral_codes SET receiver_openid = $1, sharing_percentage = $2 WHERE code = $3',
                [openid, sharingPercentage || 10.00, referralCode]
            );

            return res.json({
                success: true,
                message: '接收方已存在于微信分账列表，已保存到数据库'
            });
        }

        res.status(500).json({
            error: err.response?.data?.message || err.message,
            details: err.response?.data
        });
    }
});

/**
 * @route GET /api/admin/profit-sharing/records
 * @desc 查询分账记录
 */
app.get('/api/admin/profit-sharing/records', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT * FROM profit_sharing_records 
            ORDER BY created_at DESC 
            LIMIT 100
        `);
        res.json({ success: true, records: result.rows });
    } catch (err) {
        console.error('[ProfitSharing] Query records error:', err);
        res.status(500).json({ error: err.message });
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
        // 1. 创建 users 表
        await db.query(`
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            openid TEXT UNIQUE NOT NULL,
            nickname TEXT,
            avatar_url TEXT,
            is_vip INTEGER DEFAULT 0,
            vip_expire_time BIGINT DEFAULT 0,
            referrer_code TEXT,
            own_referral_code TEXT,
            device_type TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `);

        // 2. 创建 page_views 表
        await db.query(`
          CREATE TABLE IF NOT EXISTS page_views (
            id SERIAL PRIMARY KEY,
            session_id TEXT NOT NULL,
            referrer_code TEXT,
            device_type TEXT,
            user_agent TEXT,
            ip_address TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `);

        // 3. 创建 referral_codes 表
        await db.query(`
          CREATE TABLE IF NOT EXISTS referral_codes (
            id SERIAL PRIMARY KEY,
            code TEXT UNIQUE NOT NULL,
            owner_name TEXT NOT NULL,
            owner_contact TEXT,
            commission_rate DECIMAL(5,2) DEFAULT 10.00,
            receiver_openid TEXT,
            sharing_percentage DECIMAL(5,2) DEFAULT 10.00,
            is_active BOOLEAN DEFAULT true,
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `);

        // 4. 创建 profit_sharing_records 表
        await db.query(`
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
        `);

        // 5. 创建索引
        await db.query(`CREATE INDEX IF NOT EXISTS idx_pv_session ON page_views(session_id);`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_pv_referrer ON page_views(referrer_code);`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_pv_created ON page_views(created_at);`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_rc_code ON referral_codes(code);`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_rc_receiver ON referral_codes(receiver_openid);`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_ps_out_order ON profit_sharing_records(out_order_no);`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_ps_referrer ON profit_sharing_records(referrer_code);`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_ps_status ON profit_sharing_records(status);`);

        // 6. 查询 users 表现有的列
        const existingCols = await db.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'users'
        `);
        const colNames = existingCols.rows.map(r => r.column_name);
        console.log('[DB] Existing users columns:', colNames.join(', '));

        // 7. 添加缺失的列（逐个添加，记录结果）
        const columnsToAdd = [
            { name: 'referrer_code', type: 'TEXT' },
            { name: 'own_referral_code', type: 'TEXT' },
            { name: 'device_type', type: 'TEXT' },
            { name: 'phone', type: 'TEXT' },
            { name: 'phone_verified', type: 'BOOLEAN DEFAULT false' },
            { name: 'wechat_bound', type: 'BOOLEAN DEFAULT false' }
        ];

        const addResults = [];
        for (const col of columnsToAdd) {
            if (colNames.includes(col.name)) {
                addResults.push(`${col.name}: already exists`);
            } else {
                try {
                    await db.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
                    addResults.push(`${col.name}: ADDED`);
                } catch (e) {
                    addResults.push(`${col.name}: ERROR - ${e.message}`);
                }
            }
        }
        console.log('[DB] Column add results:', addResults.join(', '));

        // 8. 创建索引
        try {
            await db.query(`CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)`);
        } catch (e) { /* ignore */ }

        // 8. 创建短信验证码表
        await db.query(`
          CREATE TABLE IF NOT EXISTS sms_codes (
            id SERIAL PRIMARY KEY,
            phone TEXT NOT NULL,
            code TEXT NOT NULL,
            used BOOLEAN DEFAULT false,
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_sms_phone ON sms_codes(phone);`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_sms_expires ON sms_codes(expires_at);`);

        // 9. 创建兑换码表
        await db.query(`
          CREATE TABLE IF NOT EXISTS redemption_codes (
            id SERIAL PRIMARY KEY,
            code VARCHAR(16) UNIQUE NOT NULL,
            status VARCHAR(20) DEFAULT 'unused',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            used_at TIMESTAMP WITH TIME ZONE,
            used_by VARCHAR(64)
          );
        `);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_redemption_code ON redemption_codes(code);`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_redemption_status ON redemption_codes(status);`);

        console.log('[DB] All tables created/updated successfully');
        res.send("Database initialized/updated successfully! All tables created.");
    } catch (err) {
        console.error("[DB] Init Error:", err);
        res.status(500).send("Init failed: " + err.message);
    }
});

/**
 * @route GET /api/dev/query-users
 * @desc 查询所有用户数据（调试用）
 */
app.get('/api/dev/query-users', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM users ORDER BY id');
        res.json({
            total: result.rows.length,
            users: result.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route DELETE /api/dev/clear-test-data
 * @desc 清除测试数据（危险操作）
 */
app.delete('/api/dev/clear-test-data', async (req, res) => {
    try {
        await db.query('DELETE FROM users');
        await db.query('DELETE FROM page_views');
        await db.query('DELETE FROM referral_codes');
        await db.query('DELETE FROM profit_sharing_records');
        res.json({ success: true, message: '所有测试数据已清除' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route DELETE /api/admin/users/:id
 * @desc 删除指定ID的用户
 */
app.delete('/api/admin/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '用户不存在' });
        }
        res.json({ success: true, deleted: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route GET /api/admin/users
 * @desc 获取所有用户列表（用于后台显示）
 */
app.get('/api/admin/users', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT u.id, u.openid, u.nickname, u.avatar_url, u.is_vip, u.vip_expire_time, 
                   u.phone, u.phone_verified, u.wechat_bound, u.device_type, u.created_at,
                   (SELECT code FROM redemption_codes WHERE used_by = u.openid LIMIT 1) as redemption_code
            FROM users u
            ORDER BY u.created_at DESC
        `);
        res.json({
            total: result.rows.length,
            users: result.rows.map(u => ({
                id: u.id,
                openid: u.openid || null,
                nickname: u.nickname || '未设置昵称',
                avatar: u.avatar_url,
                isVip: u.is_vip === 1,
                vipSource: u.redemption_code ? 'redemption' : (u.is_vip === 1 ? 'wechat' : 'none'),
                redemptionCode: u.redemption_code,
                vipExpire: u.vip_expire_time,
                phone: u.phone,
                hasWechat: !!u.openid,
                deviceType: u.device_type === 'mobile' ? '手机' : (u.device_type === 'pc' ? '电脑' : '未知'),
                createdAt: u.created_at
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route GET /api/dev/fix-db
 * @desc 修复数据库字段（强制添加缺失的列）
 */
app.get('/api/dev/fix-db', async (req, res) => {
    const results = [];

    try {
        // 1. 检查 users 表结构
        const usersCols = await db.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'users'
        `);
        results.push(`Current users columns: ${usersCols.rows.map(r => r.column_name).join(', ')}`);

        // 2. 尝试添加分销系统字段（不使用 IF NOT EXISTS，显式处理错误）
        const fieldsToAdd = [
            { name: 'referrer_code', type: 'TEXT' },
            { name: 'own_referral_code', type: 'TEXT' },
            { name: 'device_type', type: 'TEXT' },
            { name: 'phone', type: 'TEXT' },
            { name: 'phone_verified', type: 'BOOLEAN DEFAULT false' },
            { name: 'wechat_bound', type: 'BOOLEAN DEFAULT false' }
        ];

        for (const field of fieldsToAdd) {
            try {
                await db.query(`ALTER TABLE users ADD COLUMN ${field.name} ${field.type}`);
                results.push(`✅ Added ${field.name}`);
            } catch (err) {
                if (err.message.includes('already exists')) {
                    results.push(`⚠️  ${field.name} already exists`);
                } else {
                    results.push(`❌ Failed to add ${field.name}: ${err.message}`);
                }
            }
        }

        // 3. 再次检查表结构
        const updatedCols = await db.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'users'
            ORDER BY ordinal_position
        `);
        results.push(`\nFinal users columns: ${updatedCols.rows.map(r => r.column_name).join(', ')}`);

        res.send(results.join('\n'));
    } catch (err) {
        console.error("[DB] Fix Error:", err);
        res.status(500).send("Fix failed: " + err.message + "\n\nResults so far:\n" + results.join('\n'));
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

// ==================== 手机号登录 API ====================

// 引入短信服务（需要放在文件顶部，但为了减少改动，这里临时处理）
const smsModule = require('./utils/sms');


/**
 * @route GET /api/dev/audit-traffic
 * @desc [DEBUG] Analyze traffic sources to verify authenticity
 */
app.get('/api/dev/audit-traffic', async (req, res) => {
    try {
        const total = await db.query('SELECT COUNT(*) FROM page_views');

        // Group by IP
        const ipStats = await db.query(`
            SELECT ip_address, COUNT(*) as count 
            FROM page_views 
            GROUP BY ip_address 
            ORDER BY count DESC 
            LIMIT 20
        `);

        // Group by User Agent
        const uaStats = await db.query(`
            SELECT user_agent, COUNT(*) as count 
            FROM page_views 
            GROUP BY user_agent 
            ORDER BY count DESC 
            LIMIT 20
        `);

        // Group by Day
        const dailyStats = await db.query(`
             SELECT DATE(created_at) as date, COUNT(*) as count
             FROM page_views
             GROUP BY DATE(created_at)
             ORDER BY date DESC
             LIMIT 10
        `);

        res.json({
            total: total.rows[0].count,
            topIPs: ipStats.rows,
            topUAs: uaStats.rows,
            daily: dailyStats.rows
        });
    } catch (err) {
        console.error('[Audit] Error:', err);
        res.status(500).json({ error: err.toString(), message: err.message || 'Unknown Error', stack: err.stack });
    }
});

/**
 * @route POST /api/auth/send-code
 * @desc 发送验证码
 */
app.post('/api/auth/send-code', async (req, res) => {
    try {
        const { phone } = req.body;

        // 验证手机号格式
        if (!smsModule.validatePhone(phone)) {
            return res.status(400).json({ success: false, error: '手机号格式不正确' });
        }

        // 检查频率限制（60秒内不可重复）
        const recentCode = await db.query(
            'SELECT * FROM sms_codes WHERE phone = $1 AND created_at > NOW() - INTERVAL \'60 seconds\' ORDER BY created_at DESC LIMIT 1',
            [phone]
        );

        if (recentCode.rows.length > 0) {
            return res.status(429).json({ success: false, error: '请60秒后再试' });
        }

        // 生成验证码
        const code = smsModule.generateCode();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5分钟后过期

        // 发送短信
        const smsResult = await smsModule.sendVerificationCode(phone, code);

        if (!smsResult.success) {
            return res.status(500).json({ success: false, error: '短信发送失败: ' + smsResult.message });
        }

        // 保存验证码
        await db.query(
            'INSERT INTO sms_codes (phone, code, expires_at) VALUES ($1, $2, $3)',
            [phone, code, expiresAt]
        );

        console.log(`[Auth] Code sent to ${phone}`);
        res.json({ success: true, message: '验证码已发送', expiresIn: 300 });
    } catch (err) {
        console.error('[Auth] Send code error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route POST /api/auth/login-phone
 * @desc 手机号登录
 */
app.post('/api/auth/login-phone', async (req, res) => {
    try {
        const { phone, code, referrerCode } = req.body;

        if (!phone || !code) {
            return res.status(400).json({ success: false, error: '手机号和验证码不能为空' });
        }

        // 验证验证码
        const codeResult = await db.query(
            'SELECT * FROM sms_codes WHERE phone = $1 AND code = $2 AND used = false AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
            [phone, code]
        );

        if (codeResult.rows.length === 0) {
            return res.status(400).json({ success: false, error: '验证码错误或已过期' });
        }

        // 标记验证码为已使用
        await db.query('UPDATE sms_codes SET used = true WHERE id = $1', [codeResult.rows[0].id]);

        // 查询或创建用户
        let user = await db.query('SELECT * FROM users WHERE phone = $1', [phone]);

        if (user.rows.length === 0) {
            // 创建新用户
            const insertResult = await db.query(
                `INSERT INTO users (phone, phone_verified, referrer_code, device_type, created_at) 
                 VALUES ($1, true, $2, $3, NOW()) 
                 RETURNING *`,
                [phone, referrerCode || null, req.body.deviceType || null]
            );
            user = insertResult;
            console.log(`[Auth] New user created: ${phone}`);
        } else {
            // 更新现有用户
            await db.query('UPDATE users SET phone_verified = true WHERE phone = $1', [phone]);

            // 如果有邀请码且用户还没绑定，则绑定
            if (referrerCode && !user.rows[0].referrer_code) {
                await db.query('UPDATE users SET referrer_code = $1 WHERE phone = $2', [referrerCode, phone]);
            }

            user = await db.query('SELECT * FROM users WHERE phone = $1', [phone]);
        }

        const userData = user.rows[0];

        // 生成简单的 token（实际应用中应该使用 JWT）
        const token = Buffer.from(`${phone}:${Date.now()}`).toString('base64');

        console.log(`[Auth] User logged in: ${phone}`);
        res.json({
            success: true,
            token,
            user: {
                phone: userData.phone,
                isVip: userData.is_vip === 1,
                vipExpireTime: userData.vip_expire_time,
                wechatBound: userData.wechat_bound || false,
                nickname: userData.nickname,
                avatarUrl: userData.avatar_url
            }
        });
    } catch (err) {
        console.error('[Auth] Login error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route POST /api/auth/bind-wechat
 * @desc 绑定微信（用于分账）
 */
app.post('/api/auth/bind-wechat', async (req, res) => {
    try {
        const { phone, wechatCode } = req.body;

        if (!phone || !wechatCode) {
            return res.status(400).json({ success: false, error: '参数不完整' });
        }

        // 用 wechatCode 换取 OpenID（调用微信 API）
        const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${process.env.WECHAT_APP_ID}&secret=${process.env.WECHAT_APP_SECRET}&code=${wechatCode}&grant_type=authorization_code`;
        const tokenResp = await axios.get(tokenUrl);

        if (tokenResp.data.errcode) {
            return res.status(400).json({ success: false, error: '微信授权失败: ' + tokenResp.data.errmsg });
        }

        const { openid, access_token } = tokenResp.data;

        // 获取用户信息
        const userInfoUrl = `https://api.weixin.qq.com/sns/userinfo?access_token=${access_token}&openid=${openid}&lang=zh_CN`;
        const userInfoResp = await axios.get(userInfoUrl);

        const { nickname, headimgurl } = userInfoResp.data;

        // 更新用户表，绑定 OpenID
        await db.query(
            'UPDATE users SET openid = $1, nickname = $2, avatar_url = $3, wechat_bound = true WHERE phone = $4',
            [openid, nickname, headimgurl, phone]
        );

        console.log(`[Auth] WeChat bound for ${phone}: ${openid}`);
        res.json({
            success: true,
            openid,
            nickname,
            avatarUrl: headimgurl
        });
    } catch (err) {
        console.error('[Auth] Bind WeChat error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route GET /api/auth/user-info
 * @desc 获取用户信息
 */
app.get('/api/auth/user-info', async (req, res) => {
    try {
        const { phone } = req.query;

        if (!phone) {
            return res.status(400).json({ success: false, error: '缺少phone参数' });
        }

        const user = await db.query('SELECT * FROM users WHERE phone = $1', [phone]);

        if (user.rows.length === 0) {
            return res.status(404).json({ success: false, error: '用户不存在' });
        }

        const userData = user.rows[0];
        res.json({
            success: true,
            user: {
                phone: userData.phone,
                nickname: userData.nickname,
                avatarUrl: userData.avatar_url,
                isVip: userData.is_vip === 1,
                vipExpireTime: userData.vip_expire_time,
                wechatBound: userData.wechat_bound || false,
                referrerCode: userData.referrer_code
            }
        });
    } catch (err) {
        console.error('[Auth] Get user info error:', err);
        res.status(500).json({ success: false, error: err.message });
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