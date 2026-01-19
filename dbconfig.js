// dbconfig.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // dynamic for Render
  ssl: { rejectUnauthorized: false } // required for Render Postgres
});

module.exports = { pool };
