require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // make sure this is your external URL
  ssl: {
    rejectUnauthorized: false, // required for Render-hosted Postgres
  },
});

module.exports = { pool };
