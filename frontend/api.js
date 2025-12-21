// api.js - Handles backend communication

// In production (same domain), use relative path.
// In dev (different ports), you might need full URL, but since we are merging frontend into backend, relative works for both if served by Express.
const API_BASE = '';

const API = {
    /**
     * Check if backend is reachable
     */
    async checkHealth() {
        try {
            await fetch(`${API_BASE}/`);
            return true;
        } catch (e) {
            console.warn("Backend not reachable");
            return false;
        }
    },

    /**
     * Mock Login flow
     * In real/WeChat env, you would get the code from URL params
     */
    async login(code = null) {
        // Generate a random code if none provided (Dev Mode)
        const mockCode = code || 'dev_code_' + Math.random().toString(36).substr(2, 9);

        try {
            const res = await fetch(`${API_BASE}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: mockCode })
            });
            return await res.json();
        } catch (e) {
            console.error("Login failed", e);
            throw e;
        }
    },

    /**
     * Create Payment Order
     */
    async createOrder(openid) {
        try {
            const res = await fetch(`${API_BASE}/api/pay/create-order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ openid })
            });
            return await res.json();
        } catch (e) {
            console.error("Create order failed", e);
            throw e;
        }
    },

    /**
     * [DEV] Force VIP Status
     */
    async devForceVip(openid) {
        try {
            const res = await fetch(`${API_BASE}/api/dev/force-vip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ openid })
            });
            return await res.json();
        } catch (e) {
            console.error("Force VIP failed", e);
            throw e;
        }
    },

    /**
     * Get User Status
     */
    async getUser(openid) {
        try {
            const res = await fetch(`${API_BASE}/api/user/${openid}`);
            return await res.json();
        } catch (e) {
            console.error("Get user failed", e);
            throw e;
        }
    }
};

export { API };
export default API;
