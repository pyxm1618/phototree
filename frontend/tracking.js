// tracking.js - Frontend tracking utilities for PhotoTree

/**
 * Generate or retrieve session ID for UV tracking
 */
function getSessionId() {
    let sessionId = localStorage.getItem('pt_session_id');
    if (!sessionId) {
        sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('pt_session_id', sessionId);
    }
    return sessionId;
}

/**
 * Detect device type (pc or mobile)
 */
function getDeviceType() {
    const ua = navigator.userAgent.toLowerCase();
    const isMobile = /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
    return isMobile ? 'mobile' : 'pc';
}

/**
 * Get referrer code from URL (?ref=XXX) and store in localStorage
 */
function captureReferrerCode() {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');

    if (refCode) {
        // Store referrer code in localStorage
        localStorage.setItem('pt_referrer_code', refCode);
        console.log('[Tracking] Referrer code captured:', refCode);
    }

    return localStorage.getItem('pt_referrer_code') || null;
}

/**
 * Send page view to backend
 */
async function trackPageView() {
    const sessionId = getSessionId();
    const deviceType = getDeviceType();
    const referrerCode = captureReferrerCode();

    try {
        const response = await fetch('/api/track/pv', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                referrerCode,
                deviceType,
                userAgent: navigator.userAgent
            })
        });

        if (response.ok) {
            console.log('[Tracking] PV recorded');
        }
    } catch (error) {
        console.error('[Tracking] Failed to record PV:', error);
    }
}

/**
 * Get stored referrer code for login binding
 */
function getStoredReferrerCode() {
    return localStorage.getItem('pt_referrer_code');
}

/**
 * Clear referrer code (optional, after successful binding)
 */
function clearReferrerCode() {
    localStorage.removeItem('pt_referrer_code');
}

// Auto-track page view on load
if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
        trackPageView();
    });
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getSessionId,
        getDeviceType,
        captureReferrerCode,
        trackPageView,
        getStoredReferrerCode,
        clearReferrerCode
    };
}
