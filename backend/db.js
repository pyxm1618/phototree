const sqlite3 = require('sqlite3').verbose();
const { createClient } = require('@libsql/client');
const path = require('path');
require('dotenv').config();

let db;

// Strategy Pattern for DB Operations
let runQuery, getQuery;

if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    // --- CLOUD MODE (Turso) ---
    console.log(">>> [DB] Connecting to Turso Cloud Database...");

    const client = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
    });

    // Adapter for Turso (LibSQL)
    runQuery = async (sql, params = []) => {
        try {
            return await client.execute({ sql, args: params });
        } catch (e) {
            throw e;
        }
    };

    getQuery = async (sql, params = []) => {
        try {
            const rs = await client.execute({ sql, args: params });
            // Adapt format to match sqlite3: return first row object
            if (rs.rows.length > 0) return rs.rows[0];
            return null;
        } catch (e) {
            throw e;
        }
    };

    // Auto Init
    initDbCloud(client);

    // Export standard interface
    db = {
        run: (sql, params, callback) => {
            runQuery(sql, params)
                .then(res => callback && callback.call({ lastID: res.lastInsertRowid }, null))
                .catch(err => callback && callback(err));
        },
        get: (sql, params, callback) => {
            getQuery(sql, params)
                .then(row => callback && callback(null, row))
                .catch(err => callback && callback(err));
        }
    };

} else {
    // --- LOCAL MODE (In-Memory SQLite for Vercel) ---
    console.log(">>> [DB] Using In-Memory SQLite (Vercel Compatible).");

    const localDb = new sqlite3.Database(':memory:'); // Use in-memory DB for serverless

    localDb.serialize(() => {
        initDbLocal(localDb);
    });

    db = localDb;
}

// --- Init Scripts ---

function initDbLocal(targetDb) {
    targetDb.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        openid TEXT UNIQUE,
        is_vip INTEGER DEFAULT 0,
        vip_expire_time INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
}

async function initDbCloud(client) {
    try {
        await client.execute(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            openid TEXT UNIQUE,
            is_vip INTEGER DEFAULT 0,
            vip_expire_time INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    } catch (e) {
        console.error("Failed to init Cloud DB:", e);
    }
}

module.exports = db;
