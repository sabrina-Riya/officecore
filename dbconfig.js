require("dotenv").config();
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

// Enable SSL for Render (remote DB) only
const useSSL = connectionString && !connectionString.includes("localhost");

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

pool.on("connect", () => console.log("Postgres connected"));
pool.on("error", (err) => console.error("Postgres pool error:", err));

module.exports = { pool };
