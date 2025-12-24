// pages/auth/auth.js
const app = getApp();

Page({
    data: {
        status: 'loading', // loading, success, error
        message: '正在授权...',
        websiteOpenid: '', // 从场景值或参数获取的网站openid
        errorDetail: ''
    },

    onLoad(options) {
        console.log('[Auth] Page loaded with options:', options);

        // 从小程序码参数获取网站用户的openid
        // 场景值 scene 是 base64 编码的
        if (options.scene) {
            try {
                const scene = decodeURIComponent(options.scene);
                console.log('[Auth] Decoded scene:', scene);
                this.setData({ websiteOpenid: scene });
            } catch (e) {
                console.error('[Auth] Failed to decode scene:', e);
            }
        } else if (options.openid) {
            this.setData({ websiteOpenid: options.openid });
        }

        // 立即开始获取openid
        this.getOpenId();
    },

    // 获取小程序的openid
    async getOpenId() {
        try {
            // 1. 获取登录code
            const loginRes = await new Promise((resolve, reject) => {
                wx.login({
                    success: resolve,
                    fail: reject
                });
            });

            console.log('[Auth] Got login code:', loginRes.code);

            // 2. 调用后端接口换取openid
            const result = await new Promise((resolve, reject) => {
                wx.request({
                    url: 'https://aiguess.cn/api/miniprogram/auth',
                    method: 'POST',
                    data: {
                        code: loginRes.code,
                        websiteOpenid: this.data.websiteOpenid
                    },
                    success: (res) => {
                        if (res.statusCode === 200) {
                            resolve(res.data);
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}`));
                        }
                    },
                    fail: reject
                });
            });

            console.log('[Auth] Backend response:', result);

            if (result.success) {
                this.setData({
                    status: 'success',
                    message: '授权成功！'
                });

                // 3秒后提示用户返回
                setTimeout(() => {
                    this.setData({
                        message: '授权成功！请返回网站继续操作'
                    });
                }, 1500);

            } else {
                throw new Error(result.error || '授权失败');
            }

        } catch (error) {
            console.error('[Auth] Error:', error);
            this.setData({
                status: 'error',
                message: '授权失败',
                errorDetail: error.message || '未知错误'
            });
        }
    },

    // 重试
    onRetry() {
        this.setData({
            status: 'loading',
            message: '正在授权...',
            errorDetail: ''
        });
        this.getOpenId();
    }
});
