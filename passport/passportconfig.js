const LocalStrategy = require("passport-local").Strategy;
const { pool } = require("../dbconfig");

const bcrypt = require("bcrypt");

function initialize(passport) {
  const authu = async (email, password, done) => {
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const res = await pool.query(
        "SELECT * FROM users WHERE email=$1",
        [normalizedEmail]
      );

      if (res.rows.length === 0) {
        return done(null, false, { message: "No user found" });
      }

      const user = res.rows[0];

      if (!user.is_active) {
        return done(null, false, { message: "Your account is deactivated" });
      }

      const isMatch = await bcrypt.compare(password, user.password);

      if (isMatch) return done(null, user);
      else return done(null, false, { message: "Incorrect password" });

    } catch (err) {
      return done(err);
    }
  };

  passport.use(
    new LocalStrategy(
      { usernameField: "email", passwordField: "password" },
      authu
    )
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const res = await pool.query("SELECT * FROM users WHERE id=$1", [id]);
      done(null, res.rows[0]);
    } catch (err) {
      done(err);
    }
  });
}

module.exports = initialize;