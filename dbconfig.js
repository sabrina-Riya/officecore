require("dotenv").config();
const { Pool, Client } = require("pg");

const isProd = process.env.NODE_ENV === "production";

const pool = new Pool({
  host: isProd ? process.env.DB_HOST : "localhost",
  user: isProd ? process.env.DB_USER : "postgres",
  password: isProd ? process.env.DB_PASSWORD : "123",
  database: isProd ? process.env.DB_NAME : "officecore",
  port: isProd ? process.env.DB_PORT : 5432,
  ssl: isProd ? { rejectUnauthorized: false } : false
});

function getConnection() {
  return new Client({
    host: isProd ? process.env.DB_HOST : "localhost",
    user: isProd ? process.env.DB_USER : "postgres",
    password: isProd ? process.env.DB_PASSWORD : "123",
    database: isProd ? process.env.DB_NAME : "officecore",
    port: isProd ? process.env.DB_PORT : 5432,
    ssl: isProd ? { rejectUnauthorized: false } : false
  });
}

module.exports = { pool, getConnection };
