const { Pool } = require('pg');

// Use DATABASE_URL which is set by Prisma Postgres
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};