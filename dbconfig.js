// dbconfig.js
require("dotenv").config(); // load .env

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

pool.connect()
  .then(client => {
    console.log("✅ Postgres connected");
    client.release();
  })
  .catch(err => {
    console.error("❌ Postgres connection error:", err.stack || err);
  });

module.exports = { pool };
