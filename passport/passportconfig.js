const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");
const { pool } = require("../dbconfig"); // Make sure this path is correct

function init(passport) {
  const authUser = (email, password, done) => {
    if (!pool) return done(new Error("Database pool is not defined"));

    pool.query("SELECT * FROM users WHERE email=$1", [email], (err, result) => {
      if (err) return done(err);

      if (result.rows.length === 0) {
        return done(null, false, { message: "Email not registered" });
      }

      const user = result.rows[0];

      bcrypt.compare(password, user.password, (err, isMatch) => {
        if (err) return done(err);

        if (!isMatch) return done(null, false, { message: "Incorrect password" });
        if (!user.is_active) return done(null, false, { message: "User is inactive" });

        return done(null, user);
      });
    });
  };

  passport.use(
    new LocalStrategy({ usernameField: "email", passwordField: "password" }, authUser)
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    pool.query("SELECT * FROM users WHERE id=$1", [id], (err, result) => {
      if (err) return done(err);
      done(null, result.rows[0]);
    });
  });
}

module.exports = init;
