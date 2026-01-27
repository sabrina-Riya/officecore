const { pool } = require("./dbconfig");
const bcrypt = require("bcrypt");

async function seedUsers() {
  // Users to seed
  const users = [
    // ---- NORMAL USERS ----
    {
      name: "Admin User",
      email: "admin@gmail.com",
      password: "admin123",
      role: "admin"
    },
    {
      name: "Employee User",
      email: "employee@gmail.com",
      password: "employee123",
      role: "employee"
    },
    {
      name: "Test Admin",
      email: "testadmin@gmail.com",
      password: "testadmin123",
      role: "admin"
    },
    {
      name: "Test Employee",
      email: "testemployee@gmail.com",
      password: "testemployee123",
      role: "employee"
    }
  ];

  // Loop through each user and insert
  for (const user of users) {
    const hashedPassword = await bcrypt.hash(user.password, 10);

    await pool.query(
      `INSERT INTO users (name, email, password, role, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (email) DO NOTHING`,
      [user.name, user.email, hashedPassword, user.role]
    );

    console.log(`Seeded user: ${user.email} (${user.role})`);
  }

  console.log("✅ All users seeded successfully!");
  process.exit();
}

// Run seeding
seedUsers().catch(err => {
  console.error("❌ Error seeding users:", err);
  process.exit(1);
});
