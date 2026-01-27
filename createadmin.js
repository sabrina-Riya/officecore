require("dotenv").config();
const { pool } = require("./dbconfig");
const bcrypt = require("bcrypt");

async function createAdmin() {
  const email = "admin@gmail.com";
  const password = "admin123";
  const name = "Admin";

  try {
    // Hash the password
    const hash = await bcrypt.hash(password, 10);

    // Check if admin already exists
    const check = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    if (check.rows.length > 0) {
      console.log("Admin already exists!");
      process.exit(0);
    }

    // Insert admin
    await pool.query(
      "INSERT INTO users (name, email, password, role, is_active) VALUES ($1, $2, $3, $4, $5)",
      [name, email, hash, "admin", true]
    );

    console.log("Admin created successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Error creating admin:", err.stack || err);
    process.exit(1);
  }
}

createAdmin();
