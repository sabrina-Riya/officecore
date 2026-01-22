const { pool } = require("./dbconfig");
const bcrypt = require("bcrypt");

async function seedAdmin() {
  const email = "admin@gmail.com";
  const password = "admin123"; // admin password
  const hashedPassword = await bcrypt.hash(password, 10);

  await pool.query(
    `INSERT INTO users (name,email,password,role,is_active)
     VALUES ($1,$2,$3,'admin',true)
     ON CONFLICT (email) DO NOTHING`,
    ["Admin User", email, hashedPassword]
  );

  console.log("Admin seeded");
  process.exit();
}

seedAdmin().catch(err => {
  console.error(err);
  process.exit(1);
});
