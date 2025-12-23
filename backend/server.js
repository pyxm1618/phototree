require('dotenv').config();
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
        const paidResult = await db.query('SELECT COUNT(*) as count FROM users WHERE is_vip = 1');

        // Device distribution
        const deviceResult = await db.query(`
            SELECT device_type, COUNT(*) as count 
            FROM page_views 
            GROUP BY device_type
        `);

        // Daily stats (last 7 days)
        const dailyStats = await db.query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as pv,
                COUNT(DISTINCT session_id) as uv
            FROM page_views
            WHERE created_at >= NOW() - INTERVAL '7 days'
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `);

        // Top referral codes
        const topReferrals = await db.query(`
            SELECT 
                rc.code,
                rc.owner_name,
                COUNT(DISTINCT u.openid) as registered_users,
                COUNT(DISTINCT CASE WHEN u.is_vip = 1 THEN u.openid END) as paid_users
            FROM referral_codes rc
            LEFT JOIN users u ON u.referrer_code = rc.code
            WHERE rc.is_active = true
            GROUP BY rc.code, rc.owner_name
            ORDER BY paid_users DESC, registered_users DESC
            LIMIT 10
        `);

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
                acc[row.device_type || 'unknown'] = parseInt(row.count);
                return acc;
            }, {}),
            dailyStats: dailyStats.rows,
            topReferrals: topReferrals.rows
        });
    } catch (err) {
        console.error('[Admin] Stats Error:', err);
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
            }]
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
 * @desc 添加分账接收方（绑定 KOL OpenID）
 */
app.post('/api/admin/profit-sharing/add-receiver', async (req, res) => {
    const { referralCode, openid, sharingPercentage } = req.body;

    if (!referralCode || !openid) {
        return res.status(400).json({ error: 'Missing referralCode or openid' });
    }

    try {
        // 更新 referral_codes 表
        await db.query(
            'UPDATE referral_codes SET receiver_openid = $1, sharing_percentage = $2 WHERE code = $3',
            [openid, sharingPercentage || 10.00, referralCode]
        );

        console.log(`[ProfitSharing] Receiver added: ${referralCode} -> ${openid}`);
        res.json({ success: true, message: 'Receiver added successfully' });
    } catch (err) {
        console.error('[ProfitSharing] Add receiver error:', err);
        res.status(500).json({ error: err.message });
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