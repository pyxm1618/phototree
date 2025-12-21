// storage.js - Handles local image storage via localforage
// User-isolated storage: each user has their own storage key

const STORE_KEY_PREFIX_IMAGES = 'user_images_';
const STORE_KEY_PREFIX_MUSIC = 'user_music_';
const STORE_KEY_PREFIX_TUTORIAL = 'tutorial_seen_';

const Storage = {
    async init() {
        if (!window.localforage) {
            console.error("LocalForage not found!");
            return;
        }
        localforage.config({
            name: 'ParticleSaaS',
            storeName: 'images_db'
        });
    },

    // Images
    async saveImages(openid, fileDataArray) {
        if (!openid) return;
        const key = `${STORE_KEY_PREFIX_IMAGES}${openid}`;
        try {
            await localforage.setItem(key, fileDataArray);
            console.log(`Saved ${fileDataArray.length} images for user ${openid}`);
        } catch (e) {
            console.error("Failed to save images", e);
        }
    },

    async loadImages(openid) {
        if (!openid) return [];
        const key = `${STORE_KEY_PREFIX_IMAGES}${openid}`;
        try {
            const images = await localforage.getItem(key);
            return images || [];
        } catch (e) {
            console.error("Failed to load images", e);
            return [];
        }
    },

    async clearImages(openid) {
        if (!openid) return;
        const key = `${STORE_KEY_PREFIX_IMAGES}${openid}`;
        await localforage.removeItem(key);
    },

    // Music
    async saveMusic(openid, musicData) {
        if (!openid) return;
        const key = `${STORE_KEY_PREFIX_MUSIC}${openid}`;
        try {
            await localforage.setItem(key, musicData);
            console.log(`Saved music for user ${openid}`);
        } catch (e) {
            console.error("Failed to save music", e);
        }
    },

    async loadMusic(openid) {
        if (!openid) return null;
        const key = `${STORE_KEY_PREFIX_MUSIC}${openid}`;
        try {
            return await localforage.getItem(key);
        } catch (e) {
            console.error("Failed to load music", e);
            return null;
        }
    },

    // Tutorial
    async setTutorialSeen(openid) {
        if (!openid) return;
        const key = `${STORE_KEY_PREFIX_TUTORIAL}${openid}`;
        await localforage.setItem(key, true);
    },

    async hasTutorialSeen(openid) {
        if (!openid) return false;
        const key = `${STORE_KEY_PREFIX_TUTORIAL}${openid}`;
        return await localforage.getItem(key) || false;
    }
};

export { Storage };
export default Storage;
