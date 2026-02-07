// ---------- MODULES ----------
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const flash = require("express-flash");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();
const bcrypt = require("bcrypt");

const logger = require("./utils/logger");
const { pool } = require("./dbconfig");
const pgSession = require("connect-pg-simple")(session);
const initPass = require("./passport/passportconfig");
const { body, validationResult } = require("express-validator");
const { Parser } = require("json2csv");

// Middlewares
const { 
  redirectAuthenticated,
  ensureAuthenticated,
  permitRoles 
} = require("./middleware/auth");

// Routes
const apiRoutes = require("./routes/api");
const adminRoutes = require("./routes/admin");
const employeeRoutes = require("./routes/employee"); 


// ---------- APP INIT ----------
const app = express();
const PORT = process.env.PORT || 10000;

// ---------- SECURITY ----------
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));

// ---------- BODY PARSERS ----------
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ---------- VIEW ENGINE ----------
app.set("view engine", "ejs");
app.set("trust proxy", 1); // BEFORE session middleware

app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || "mySuperSecret123",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: true, // 👈 critical for Render
    cookie: {
      httpOnly: true,
      secure: true,       // 👈 always true on Render
      sameSite: "none",   // 👈 cross-site cookies
      maxAge: 10 * 60 * 1000
    }
  })
);

// ---------- REQUEST LOGGER ----------
app.use((req, res, next) => {
  console.log("➡️ REQUEST:", req.method, req.originalUrl);
  next();
});
// Prevent caching of sensitive pages
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});
// ---------- PASSPORT ----------
initPass(passport);
app.use(passport.initialize());
app.use(passport.session());




app.use((req, res, next) => {
  console.log("🔎 DEBUG", {
    path: req.originalUrl,
    isAuth: req.isAuthenticated?.(),
    user: req.user ? {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role
    } : null
  });
  next();
});

// ---------- FLASH ----------
app.use(flash());

// ---------- GLOBAL LOCALS ----------
app.use((req, res, next) => {
  res.locals.success_msg = req.flash("success_msg");
  res.locals.err_msg = req.flash("err_msg");
  res.locals.user = req.user;
  next();
});

// ---------- RATE LIMIT (AUTH ONLY) ----------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many attempts. Try again later."
});
app.use((req, res, next) => {
  res.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private"
  );
  next();
});

app.use("/login", authLimiter);
app.use("/register", authLimiter);

// ---------- ROUTES ----------
app.use("/", apiRoutes);        
app.use("/admin", adminRoutes);  
app.use("/employee", employeeRoutes); 



process.on("unhandledRejection", err => {
  logger.error(`Unhandled Rejection | ${err.stack || err}`);
});

process.on("uncaughtException", err => {
  logger.error(`Uncaught Exception | ${err.stack || err}`);
  process.exit(1);
});

app.use((req, res, next) => {
  console.log("🔎 DEBUG", {
    path: req.path,
    secure: req.secure,
    isAuth: req.isAuthenticated?.(),
    user: req.user?.email || null
  });
  next();
});

// ---------- LOGIN ----------
app.post(
  "/login",
  authLimiter,
  [
    body("email").notEmpty().withMessage("Email is Required").isEmail().withMessage("Enter a Valid Email"),
    body("password").notEmpty().withMessage("Password is required").isLength({ min: 6 }).withMessage("Password must be at least 6 characters")
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      errors.array().forEach(err => req.flash("error", err.msg));
      return res.redirect("/login");
    }

    passport.authenticate("local", async (err, user, info) => {
      if (err) return next(err);

      if (!user) {
        req.flash("error", info?.message || "Invalid credentials");
        return res.redirect("/login");
      }

      if (!user.is_active) {
        req.flash("error", "Your account is deactivated. Contact admin.");
        return res.redirect("/login");
      }

      // ✅ Add snippet here
      req.logIn(user, err => {
        if (err) return next(err);

        const role = user.role.toLowerCase();
        if (role === "admin") return res.redirect("/admin/dashboard");
        if (role === "employee") return res.redirect("/employee/dashboard");

        req.flash("error", "Unknown role");
        res.redirect("/login");
      });

    })(req, res, next);
  }
);

// ---------- DEMO LOGIN ----------
app.get("/demo/:role", async (req, res, next) => {
  const role = req.params.role;

  if (!["admin", "employee"].includes(role)) {
    req.flash("error", "Invalid demo role");
    return res.redirect("/login");
  }

  try {
    const email =
      role === "admin"
        ? "demo_admin@example.com"
        : "demo_employee@example.com";

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND is_active = true",
      [email]
    );

    const demoUser = result.rows[0];

    if (!demoUser) {
      req.flash("error", "Demo account not found");
      return res.redirect("/login");
    }

    req.logIn(demoUser, err => {
      if (err) return next(err);

      return res.redirect(
        role === "admin"
          ? "/admin/dashboard"
          : "/employee/dashboard"
      );
    });

  } catch (err) {
    next(err);
  }
});


app.get("/register", (req, res) => {
  if (req.isAuthenticated()) {
    const role = req.user.role.toLowerCase();
    return res.redirect(role === "admin" ? "/admin/dashboard" : "/employee/dashboard");
  }

  res.render("register", {
    error: req.flash("err_msg") || [],    // flash errors
    success_msg: req.flash("success_msg") || [], // flash success messages
    oldInput: {}                           // pre-fill form if needed
  });
});

// ---------- POST /register ----------
app.post(
  "/register",
  [
    body("name").notEmpty().withMessage("Name is required"),
    body("email")
      .notEmpty().withMessage("Email is required")
      .isEmail().withMessage("Enter a valid email"),
    body("password")
      .notEmpty().withMessage("Password is required")
      .isLength({ min: 6 }).withMessage("Password must be at least 6 characters")
      .matches(/[a-z]/).withMessage("Password must contain at least one lowercase letter")
      .matches(/[0-9]/).withMessage("Password must contain at least one number")
      .matches(/[@$!%*?&]/).withMessage("Password must contain at least one special character (@$!%*?&)"),
    body("confirmPassword")
      .custom((value, { req }) => value === req.body.password)
      .withMessage("Password and Confirm Password do not match")
  ],
  async (req, res) => {
    const errors = validationResult(req);
    const { name, email, password } = req.body;
    const oldInput = { name, email };

    if (!errors.isEmpty()) {
      const errorArray = errors.array().map(e => e.msg);
      return res.render("register", {
        error: errorArray,
        success_msg: [],
        oldInput
      });
    }

    try {
      // ---------- CHECK IF USER EXISTS ----------
      const userExist = await pool.query("SELECT * FROM users WHERE email=$1", [email]);

      if (userExist.rows.length > 0) {
        // Email already registered
        return res.render("register", {
          error: ["Email is already registered"],
          success_msg: [],
          oldInput
        });
      }

      // ---------- HASH PASSWORD ----------
      const hashedPassword = await bcrypt.hash(password, 10);

      // ---------- CREATE EMPLOYEE ----------
      const newUser = await pool.query(
        `INSERT INTO users (name, email, password, role, active_status, is_active, created_at)
         VALUES ($1, $2, $3, 'employee', true, true, NOW()) RETURNING *`,
        [name, email, hashedPassword]
      );

      const createdUser = newUser.rows[0];
      logger.info(`New user registered: userId=${createdUser.id}, email=${email}`);

      // ---------- LOGIN NEW USER ----------
      req.login(createdUser, (err) => {
        if (err) {
          logger.error(`Login error for new user: userId=${createdUser.id}, email=${email} | ${err.stack}`);
          return res.render("register", {
            error: ["Something went wrong during login."],
            success_msg: [],
            oldInput
          });
        }

        req.flash("success_msg", "Account created and logged in successfully!");
        return res.redirect("/employee/dashboard");
      });

    } catch (err) {
      logger.error(`Registration error | ${err.stack}`);
      return res.render("register", {
        error: ["Something went wrong. Please try again."],
        success_msg: [],
        oldInput
      });
    }
  }
);
//logout
app.post("/logout", ensureAuthenticated, (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);

    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.redirect("/login");
    });
  });
});

app.get("/", (req, res) => {
  const error = req.flash("error") || [];
  res.render("index", { error });
});
app.get("/login", (req, res) => {
  if (req.isAuthenticated?.() && req.user) {
    const role = req.user.role.toLowerCase();
    return res.redirect(
      role === "admin" ? "/admin/dashboard" : "/employee/dashboard"
    );
  }

  res.render("login", {
    demoEmail: "demo_admin@example.com",
    demoPassword: "DemoAdmin123!",
    messages: {
      error: req.flash("error"),
      success_msg: req.flash("success_msg")
    }
  });
});

app.get("/dashboard", ensureAuthenticated, (req, res) => {
  if (!req.user) return res.redirect("/login");

  const role = req.user.role.toLowerCase();
  if (role === "admin") return res.redirect("/admin/dashboard");
  return res.redirect("/employee/dashboard");
});

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).render("error/404");
});

// ---------- GLOBAL ERROR HANDLER ----------
app.use((err, req, res, next) => {
  logger.error(`${req.method} ${req.originalUrl} | userId=${req.user?.id || "guest"} | ${err.stack}`);

  if (req.originalUrl.startsWith("/api")) {
    return res.status(err.status || 500).json({ success: false, message: err.message || "Internal server error" });
  }

  res.status(500).render("error/500", { message: "Something went wrong" });
});
// ---------- START SERVER ----------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
