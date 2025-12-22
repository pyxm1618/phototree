const { createClient } = require('@vercel/postgres');

module.exports = {
  query: async (text, params) => {
    // Error suggested using createClient() for direct connections
    const client = createClient({
      connectionString: process.env.POSTGRES_URL,
    });
    await client.connect();
    try {
      return await client.query(text, params);
    } catch (err) {
      console.error('[DB] Query Error:', err);
      throw err;
    } finally {
      await client.end();
    }
  }
};