const LocalStrategy = require("passport-local").Strategy;
const { Pool } = require("pg");
const bcrypt = require("bcrypt");

// Create a pool if not already exported elsewhere
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function initialize(passport) {

  // 🔐 LOCAL STRATEGY
  const authenticateUser = async (email, password, done) => {
    try {
      const normalizedEmail = email.trim().toLowerCase();

      const result = await pool.query(
        `SELECT id, name, email, password, role, is_active 
         FROM users 
         WHERE email = $1`,
        [normalizedEmail]
      );

      if (result.rows.length === 0) {
        return done(null, false, { message: "No user found with that email" });
      }

      const user = result.rows[0];

      if (!user.is_active) {
        return done(null, false, { message: "Your account is deactivated" });
      }

      // ✅ Compare password with hashed version
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return done(null, false, { message: "Incorrect password" });
      }

      // ✅ Successful login
      return done(null, user);

    } catch (err) {
      return done(err);
    }
  };

  passport.use(
    new LocalStrategy(
      {
        usernameField: "email",
        passwordField: "password",
      },
      authenticateUser
    )
  );

  // 📦 Store user ID in session
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // 🔄 Attach user object to req.user
  passport.deserializeUser(async (id, done) => {
    try {
      const result = await pool.query(
        "SELECT id, name, email, role, is_active FROM users WHERE id=$1",
        [id]
      );
      if (!result.rows[0]) return done(new Error("User not found"));
      done(null, result.rows[0]);
    } catch (err) {
      done(err);
    }
  });
}

module.exports = initialize;
