const { pool } = require("./dbconfig");
const bcrypt = require("bcrypt");

const ADMIN_EMAIL = "admin@gmail.com";
const ADMIN_PASSWORD = "admin123";

async function seedAdmin() {
  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const result = await pool.query(
    "SELECT id FROM users WHERE email = $1",
    [ADMIN_EMAIL.toLowerCase()]
  );

  if (result.rows.length === 0) {
    await pool.query(
      `INSERT INTO users (name, email, password, role, is_active)
       VALUES ($1, $2, $3, 'admin', true)`,
      ["Main Admin", ADMIN_EMAIL.toLowerCase(), hashedPassword]
    );
    console.log("✅ Admin created");
  } else {
    console.log("ℹ️ Admin already exists – skipping");
  }

  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
