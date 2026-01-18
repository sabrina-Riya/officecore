// dbconfig.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Render automatically provides this
  ssl: {
    rejectUnauthorized: false, // required for Render Postgres
  },
});

pool.on("connect", () => {
  console.log("PostgreSQL connected");
});

module.exports = { pool };
