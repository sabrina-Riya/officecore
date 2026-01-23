const { Pool } = require("pg");
require("dotenv").config();

const isProd = process.env.NODE_ENV === "production";

const pool = isProd
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false } // Required for Render Postgres
    })
  : new Pool({
      host: "localhost",
      user: "postgres",
      password: "123",
      database: "officecore",
      port: 5432,
      ssl: false
    });

module.exports = { pool };
