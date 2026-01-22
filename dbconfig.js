require("dotenv").config();
const { Pool } = require("pg");

const isProd = process.env.NODE_ENV === "production";

let pool;

if (isProd) {
  // Use DATABASE_URL directly in production (Render)
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // required for Render Postgres
  });
} else {
  // Local development
  pool = new Pool({
    host: "localhost",
    user: "postgres",
    password: "123",
    database: "officecore",
    port: 5432,
    ssl: false
  });
}

module.exports = { pool };
