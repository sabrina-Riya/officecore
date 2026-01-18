const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // use DATABASE_URL directly
  ssl: {
    rejectUnauthorized: false, // needed on Render for Postgres
  },
});

pool.on("connect", () => {
  console.log("PostgreSQL connected");
});

module.exports = { pool };
