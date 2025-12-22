const { createClient } = require('@vercel/postgres');

module.exports = {
  query: async (text, params) => {
    // Use NON_POOLING URL for direct connections
    const client = createClient({
      connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL,
    });
    await client.connect();
    try {
      return await client.query(text, params);
    } finally {
      await client.end();
    }
  }
};