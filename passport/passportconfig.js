// passport/passportconfig.js
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");
const { pool } = require("../dbconfig");

function initPass(passport) {
  // Local strategy
  passport.use(
    new LocalStrategy({ usernameField: "email" }, async (email, password, done) => {
      try {
        const result = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
        if (!result.rows.length) return done(null, false, { message: "User not found" });

        const user = result.rows[0];

        // Check if user is active
        if (!user.is_active) return done(null, false, { message: "User is inactive" });

        // Compare password
        const match = await bcrypt.compare(password, user.password);
        if (!match) return done(null, false, { message: "Incorrect password" });

        // Normalize role to lowercase to prevent ADMIN/employee mismatch
        user.role = user.role.toLowerCase();

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  // Serialize user into session
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // Deserialize user from session
  passport.deserializeUser(async (id, done) => {
    try {
      const result = await pool.query("SELECT * FROM users WHERE id=$1", [id]);
      if (!result.rows.length) return done(null, false);
      const user = result.rows[0];
      user.role = user.role.toLowerCase(); // normalize role
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  });
}

module.exports = initPass;
