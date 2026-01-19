const LocalStrategy = require("passport-local").Strategy;
const { getConnection } = require("../dbconfig");
const bcrypt = require("bcrypt");

function initialize(passport) {
  // auth function
  const authu = async (email, password, done) => {
    const client = getConnection();
    try {
      await client.connect();  // connect to Postgres

      const res = await client.query(
        "SELECT * FROM users WHERE email=$1",
        [email]
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
    } finally {
      await client.end(); // close connection
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
    const client = getConnection();
    try {
      await client.connect();
      const res = await client.query("SELECT * FROM users WHERE id=$1", [id]);
      done(null, res.rows[0]);
    } catch (err) {
      done(err);
    } finally {
      await client.end();
    }
  });
}

module.exports = initialize;
