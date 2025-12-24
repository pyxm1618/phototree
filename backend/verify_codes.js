require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkCodes() {
    try {
        const client = await pool.connect();
        const res = await client.query('SELECT * FROM redemption_codes ORDER BY created_at DESC LIMIT 5');
        console.log('--- Last 5 Redemption Codes ---');
        console.table(res.rows);
        client.release();
    } catch (err) {
        console.error('Error querying database:', err);
    } finally {
        pool.end();
    }
}

checkCodes();
