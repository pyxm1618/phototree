const { sql } = require('@vercel/postgres');

module.exports = {
  query: (text, params) => sql.query(text, params),
  sql
};