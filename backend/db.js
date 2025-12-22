const { createPool } = require('@vercel/postgres');

const pool = createPool({
  connectionString: process.env.POSTGRES_URL,
});

// Test connection on start (optional, but good for logs)
pool.connect()
  .then(client => {
    console.log('[DB] Connected to Postgres Pool');
    client.release();
  })
  .catch(err => console.error('[DB] Pool Connection Error:', err));

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};