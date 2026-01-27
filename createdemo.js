require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function createDemoUsers() {
  try {
    // Demo users
    const users = [
      { name: "Admin Demo", email: "admin@officecore.demo", password: "Admin@123", role: "admin" },
      { name: "Employee Demo", email: "employee@officecore.demo", password: "Employee@123", role: "employee" },
    ];

    for (let user of users) {
      // Hash password
      const hashedPassword = await bcrypt.hash(user.password, 10);

      // Check if user already exists
      const existing = await pool.query("SELECT * FROM users WHERE email=$1", [user.email]);
      if (existing.rows.length > 0) {
        console.log(`User ${user.email} already exists, skipping...`);
        continue;
      }

      // Insert user
      await pool.query(
        "INSERT INTO users (name, email, password, role, is_active) VALUES ($1,$2,$3,$4,$5)",
        [user.name, user.email, hashedPassword, user.role, true]
      );

      console.log(`Created user: ${user.email}`);
    }

    console.log("Demo users setup complete!");
    process.exit(0);

  } catch (err) {
    console.error("Error creating demo users:", err);
    process.exit(1);
  }
}

createDemoUsers();
