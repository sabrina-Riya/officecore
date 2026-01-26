// demoSeeder.js
const { pool } = require("./dbconfig");
const bcrypt = require("bcrypt");

async function seedDemoUsers() {
  const client = await pool.connect();
  try {
    const adminPassword = await bcrypt.hash("Admin@123", 10);
    const employeePassword = await bcrypt.hash("Employee@123", 10);

    // Insert Admin (ignore if exists)
    await client.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ('Demo Admin', 'admin@officecore.demo', $1, 'ADMIN')
       ON CONFLICT (email) DO NOTHING`,
      [adminPassword]
    );

    // Insert Employee
    await client.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ('Demo Employee', 'employee@officecore.demo', $1, 'EMPLOYEE')
       ON CONFLICT (email) DO NOTHING`,
      [employeePassword]
    );

    console.log("Demo users seeded successfully ✅");
  } catch (err) {
    console.error("Error seeding demo users:", err);
  } finally {
    client.release();
  }
}

// Run seeder
seedDemoUsers();
