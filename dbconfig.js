const { Pool } = require("pg");

const pool = new Pool({
    host: process.env.PGHOST,                     // Railway host or localhost
    port: process.env.PGPORT,                     // Railway port or local port
    user: process.env.PGUSER || process.env.POSTGRES_USER,       // Railway user
    password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD, // Railway password
    database: process.env.POSTGRES_DB,            // Railway database
    ssl: process.env.PGHOST === "localhost" ? false : { rejectUnauthorized: false } // Railway needs SSL
});

module.exports = { pool };
