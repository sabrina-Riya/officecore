require("dotenv").config();
const { Pool } = require("pg");

// Use DATABASE_URL if available (Render provides it), otherwise fallback to local .env values
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false, // SSL required on Render
});

module.exports = { pool };
