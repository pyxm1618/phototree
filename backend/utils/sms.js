/**
 * 短信服务模块
 * 支持 SUBMAIL / 阿里云 / 腾讯云
 */

const axios = require('axios');
const crypto = require('crypto');

// 从环境变量读取配置
const SMS_PROVIDER = process.env.SMS_PROVIDER || 'mock'; // mock / submail / aliyun / tencent
const SUBMAIL_APP_ID = process.env.SUBMAIL_APP_ID;
const SUBMAIL_APP_KEY = process.env.SUBMAIL_APP_KEY;
const SUBMAIL_TEMPLATE_ID = process.env.SUBMAIL_TEMPLATE_ID;

/**
 * 发送验证码短信
 * @param {string} phone - 手机号
 * @param {string} code - 验证码
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function sendVerificationCode(phone, code) {
    try {
        switch (SMS_PROVIDER) {
            case 'submail':
                return await sendSUBMAIL(phone, code);
            case 'aliyun':
                return await sendAliyun(phone, code);
            case 'tencent':
                return await sendTencent(phone, code);
            case 'mock':
            default:
                return sendMock(phone, code);
        }
    } catch (error) {
        console.error('[SMS] Send failed:', error);
        return { success: false, message: error.message };
    }
}

/**
 * Mock 模式（开发测试用）
 */
function sendMock(phone, code) {
    console.log(`[SMS Mock] 📱 ${phone} 收到验证码: ${code}`);
    console.log(`\n========== 模拟短信 ==========`);
    console.log(`【PhotoTree】您的验证码是 ${code}，5分钟内有效。`);
    console.log(`==============================\n`);
    return { success: true, message: 'Mock模式，验证码已打印到控制台' };
}

/**
 * SUBMAIL 短信发送
 * 官方文档：https://www.mysubmail.com/lab/vm6rm1
 */
async function sendSUBMAIL(phone, code) {
    if (!SUBMAIL_APP_ID || !SUBMAIL_APP_KEY) {
        throw new Error('SUBMAIL credentials not configured');
    }

    const url = 'https://api-v4.mysubmail.com/message/send.json';

    // 短信内容必须包含签名
    const content = `【PhotoTree】您的验证码是${code}，5分钟内有效。`;

    const params = new URLSearchParams({
        appid: SUBMAIL_APP_ID,
        to: phone,
        content: content,
        signature: SUBMAIL_APP_KEY  // 直接使用 App Key（sign_type=normal）
    });

    const response = await axios.post(url, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (response.data.status === 'success') {
        console.log(`[SMS] SUBMAIL sent successfully, send_id: ${response.data.send_id}`);
        return { success: true, message: 'SMS sent via SUBMAIL' };
    } else {
        throw new Error(response.data.msg || 'SUBMAIL send failed');
    }
}

/**
 * 阿里云短信发送（待实现）
 */
async function sendAliyun(phone, code) {
    // TODO: 接入阿里云短信 SDK
    throw new Error('Aliyun SMS not implemented yet');
}

/**
 * 腾讯云短信发送（待实现）
 */
async function sendTencent(phone, code) {
    // TODO: 接入腾讯云短信 SDK
    throw new Error('Tencent SMS not implemented yet');
}

/**
 * 生成6位随机验证码
 */
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 验证手机号格式
 */
function validatePhone(phone) {
    return /^1[3-9]\d{9}$/.test(phone);
}

module.exports = {
    sendVerificationCode,
    generateCode,
    validatePhone
};
