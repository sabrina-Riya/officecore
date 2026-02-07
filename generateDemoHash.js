
const { pool } = require("./dbconfig"); // Make sure this path matches your project
const bcrypt = require("bcrypt");

async function createDemoAccounts() {
  const demoUsers = [
    {
      name: "Demo Admin",
      email: "demo_admin@example.com",
      password: "DemoAdmin123!",
      role: "admin",
    },
    {
      name: "Demo Employee",
      email: "demo_employee@example.com",
      password: "DemoEmployee123!",
      role: "employee",
    },
  ];

  for (const user of demoUsers) {
    try {
      // Hash the password
      const hashedPassword = await bcrypt.hash(user.password, 10);

      // Insert user into DB if email doesn't exist
      const result = await pool.query(
        `INSERT INTO users (name, email, password, role, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (email) DO NOTHING
         RETURNING *`,
        [user.name, user.email, hashedPassword, user.role]
      );

      if (result.rows.length > 0) {
        console.log(`✅ Created demo account: ${user.email}`);
      } else {
        console.log(`ℹ️ Demo account already exists: ${user.email}`);
      }
    } catch (err) {
      console.error(`❌ Error creating ${user.email}:`, err.message);
    }
  }

  // Close DB connection
  await pool.end();
  console.log("All done!");
}

// Run the script
createDemoAccounts();
