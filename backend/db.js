const { sql } = require('@vercel/postgres');

// Initialize database table
(async () => {
  try {
    console.log('[DB] Connecting to Vercel Postgres...');
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        openid TEXT UNIQUE NOT NULL,
        is_vip INTEGER DEFAULT 0,
        vip_expire_time BIGINT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log('[DB] Users table is ready.');
  } catch (err) {
    console.error('[DB] Initialization Failed:', err);
  }
})();

module.exports = {
  // Query helper
  query: async (text, params) => {
    return await sql.query(text, params);
  },
  sql
};