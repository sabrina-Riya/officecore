require("dotenv").config();
const { Client } = require("pg");

const getConnection = () => {
  if (process.env.DATABASE_URL) {
    // For Render
    return new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  } else {
    // For local
    return new Client({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 5432,
    });
  }
};

module.exports = { getConnection };
