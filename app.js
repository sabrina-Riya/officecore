// ---------- MODULES ----------
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const flash = require("express-flash");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const logger = require("./utils/logger");
const { pool } = require("./dbconfig");
const pgSession = require("connect-pg-simple")(session);
const initPass = require("./passport/passportconfig");
const { body, validationResult } = require("express-validator");

// Middlewares
const {
  redirectAuthenticated,
  ensureAuthenticated,
  permitRoles
} = require("./middleware/auth");

// Routes
const apiRoutes = require("./routes/api");
const adminRoutes = require("./routes/admin");

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

// ---------- SESSION ----------
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
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax"
    }
  })
);

// ---------- REQUEST LOGGER ----------
app.use((req, res, next) => {
  console.log("➡️ REQUEST:", req.method, req.originalUrl);
  next();
});

// ---------- PASSPORT ----------
app.use(passport.initialize());
app.use(passport.session());
initPass(passport);

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
  max: 5,
  message: "Too many attempts. Try again later."
});

app.use("/login", authLimiter);
app.use("/register", authLimiter);

// ---------- ROUTES ----------
app.use("/", apiRoutes);
app.use("/admin", adminRoutes);

// ---------- SERVER ----------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// ---------- PROCESS LEVEL HANDLERS ----------
process.on("unhandledRejection", err => {
  logger.error(`Unhandled Rejection | ${err.stack || err}`);
});

process.on("uncaughtException", err => {
  logger.error(`Uncaught Exception | ${err.stack || err}`);
  process.exit(1);
});

app.post("/login",
  authLimiter,
  [
    body("email")
      .notEmpty().withMessage("Email is Required")
      .isEmail().withMessage("Enter a Valid Email"),
    body("password")
      .notEmpty().withMessage("Password is required")
      .isLength({ min: 6 }).withMessage("Password must be at least 6 characters")
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
        req.flash("error", info.message || "Invalid credentials");
        return res.redirect("/login");
      }

      // ❌ BLOCK LOGIN IF ACCOUNT DISABLED
      if (!user.is_active) {
        req.flash("error", "Your account is deactivated. Contact admin.");
        return res.redirect("/login");
      }

      // 🔐 2FA ENABLED → STOP HERE
      if (user.two_factor_enabled) {
        req.session.twoFactorUserId = user.id;
        return res.redirect("/2fa");
      }

      // ✅ NORMAL LOGIN (NO 2FA)
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


//2fa
app.get("/2fa", ensureAuthenticated, (req, res) => {
  if (!req.user.two_factor_enabled) {
    const role = req.user.role.toLowerCase();
    return res.redirect(role === "admin" ? "/admin/dashboard" : "/employee/dashboard");
  }

  res.render("2fa", {
    error: req.flash("err_msg"),       // <-- might want to unify flash keys
    success_msg: req.flash("success_msg")
  });
});
app.post("/2fa", ensureAuthenticated, async (req, res) => {
  const { token } = req.body;
  const user = req.user;

  const verified = speakeasy.totp.verify({
    secret: user.two_factor_secret,
    encoding: "base32",
    token,
    window: 1 // allows 30s before/after
  });

  if (verified) {
    req.flash("success_msg", "Login successful with 2FA!");
    const role = user.role.toLowerCase();
    return res.redirect(role === "admin" ? "/admin/dashboard" : "/employee/dashboard");
  } else {
    req.flash("err_msg", "Invalid OTP. Try again."); // make sure this matches GET
    return res.redirect("/2fa");
  }
});
app.get("/2fa-setup", ensureAuthenticated, async (req, res) => {
  console.log("✅ HIT GET /setup-2fa", req.user?.email);
  if (req.user.two_factor_enabled) {
    req.flash("success_msg", "2FA is already enabled");
    return res.redirect("/dashboard");
  }

  // Generate a new secret
  const secret = speakeasy.generateSecret({ length: 20, name: `MyApp (${req.user.email})` });

  // Save temporarily in session until verified
  req.session.temp_two_factor_secret = secret.base32;

  // Generate QR code
  QRCode.toDataURL(secret.otpauth_url, (err, data_url) => {
    if (err) return res.send("Error generating QR code");

    res.render("2fa-setup", { qrCodeDataURL: data_url });
  });
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
      .isLength({ min: 8 }).withMessage("Password must be at least 8 characters")
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

app.post("/2fa-setup", ensureAuthenticated, async (req, res) => {
  console.log("✅ HIT POST /setup-2fa");
  const userToken = req.body.token;
  const secret = req.session.temp_two_factor_secret;

  if (!secret) {
    req.flash("err_msg", "No 2FA secret found. Try again.");
    return res.redirect("/2fa-setup");
  }

  const verified = speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token: userToken,
    window: 1
  });

  if (verified) {
    // Save secret to user in DB and enable 2FA
    await pool.query(
      "UPDATE users SET two_factor_enabled=true, two_factor_secret=$1 WHERE id=$2",
      [secret, req.user.id]
    );

    delete req.session.temp_two_factor_secret;

    req.flash("success_msg", "2FA is enabled successfully!");
    return res.redirect("/dashboard");
  } else {
    req.flash("err_msg", "Invalid token. Try again.");
    return res.redirect("/2fa-setup");
  }
});




// ---------- REJECT LEAVE ----------
app.post("/admin/leave/reject/:leaveId", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const leaveId = req.params.leaveId;
  const adminId = req.user.id;
  const { reason } = req.body;

  if (!reason || reason.trim() === "") {
    req.flash("err_msg", "Rejection reason is required");
    return res.redirect(`/admin/leave/${leaveId}`);
  }

  try {
    const leaveResult = await pool.query(
      "SELECT status FROM leave_req WHERE id=$1",
      [leaveId]
    );
    const leave = leaveResult.rows[0];

    if (!leave) {
      req.flash("err_msg", "Leave not found");
      return res.redirect("/admin/leave");
    }

    if (leave.status !== "pending") {
      req.flash("err_msg", "Only pending leaves can be rejected");
      return res.redirect("/admin/leave");
    }

    await pool.query(
      "UPDATE leave_req SET status='rejected', rejection_reason=$1, approved_by=$2, actioned_at=NOW() WHERE id=$3",
      [reason, adminId, leaveId]
    );

    await logAudit({
      action: "LEAVE_REJECTED",
      performedBy: adminId,
      targetTable: "leave_req",
      targetId: leaveId,
      oldStatus: "pending",
      newStatus: "rejected",
      message: reason
    });
    logger.info(`Leave rejected: leaveId=${leaveId}, reason="${reason}", adminId=${adminId}`);

    req.flash("success_msg", "Leave rejected successfully");
    res.redirect("/admin/leave");

  } catch (err) {
    console.error(err.stack || err);
    req.flash("err_msg", "Failed to reject leave");
    res.redirect("/admin/leave");
  }
});

//logout
app.post("/logout", ensureAuthenticated, (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    logger.info(`User logged out: userId=${req.user?.id}`);
    req.flash("success_msg", "Logged out successfully");
    res.redirect("/login");
  });
});


app.get("/employee/leave-list/export/csv", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, start_date, end_date, reason, status, approved_by, actioned_at
      FROM leave_req
      WHERE user_id=$1
      ORDER BY created_at DESC
    `, [req.user.id]);

   
    const fields = ["id", "start_date", "end_date", "reason", "status", "approved_by", "actioned_at"];
    const parser = new Parser({ fields });
    const csv = parser.parse(result.rows);

    res.header("Content-Type", "text/csv");
    res.attachment(`my_leave_list.csv`);
    return res.send(csv);

  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Failed to export leave list");
    res.redirect("/employee/leave-list");
  }
});
app.get("/employee/leave/:leaveId/history/export/csv", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  const leaveId = req.params.leaveId;

  try {
    const logsResult = await pool.query(`
      SELECT 
        al.id,
        al.action,
        al.message,
        al.old_status,
        al.new_status,
        al.created_at,
        u.name AS performed_by
      FROM audit_logs al
      LEFT JOIN users u ON al.performed_by = u.id
      WHERE al.target_table='leave_req' AND al.target_id=$1
      ORDER BY al.created_at ASC
    `, [leaveId]);

    if (!logsResult.rows.length) {
      req.flash("err_msg", "No history found for this leave");
      return res.redirect("/employee/leave-list");
    }

    
    const parser = new Parser({
      fields: ["id", "action", "message", "old_status", "new_status", "performed_by", "created_at"]
    });
    const csv = parser.parse(logsResult.rows);

    res.header("Content-Type", "text/csv");
    res.attachment(`leave_${leaveId}_history.csv`);
    res.send(csv);

  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Failed to export leave history");
    res.redirect("/employee/leave-list");
  }
});
app.get("/employee/audit_logs/export/csv", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, action, message, old_status, new_status, target_table, target_id, created_at
      FROM audit_logs
      WHERE performed_by=$1
      ORDER BY created_at DESC
    `, [req.user.id]);

   
    const parser = new Parser({ fields: ["id","action","message","old_status","new_status","target_table","target_id","created_at"] });
    const csv = parser.parse(result.rows);

    res.header("Content-Type", "text/csv");
    res.attachment(`my_audit_logs.csv`);
    res.send(csv);

  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Failed to export your actions");
    res.redirect("/employee/dashboard");
  }
});

app.get("/admin/users", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users ORDER BY id ASC");
    res.render("admin/users", {
      users: result.rows,
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg")
    });
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to fetch users");
    res.redirect("/admin/dashboard");
  }
});
app.post("/admin/users/:userId", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    const result = await pool.query("SELECT id, is_active FROM users WHERE id=$1", [userId]);
    
    const user = result.rows[0];
    if (!user) {
      req.flash("err_msg", "User not found");
      return res.redirect("/admin/users");
    }

    if (user.id === req.user.id) {
      req.flash("err_msg", "You cannot deactivate yourself");
      return res.redirect("/admin/users");
    }

    const newStatus = !user.is_active;
    await pool.query("UPDATE users SET is_active=$1 WHERE id=$2", [newStatus, userId]);
    logger.info(`User status updated: userId=${userId}, newStatus=${newStatus}, by adminId=${req.user.id}`);
    req.flash("success_msg", newStatus ? "User activated successfully" : "User deactivated successfully");
    res.redirect("/admin/users");
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to update user status");
    res.redirect("/admin/users");
  }
});
app.get("/", (req, res) => {
  const error = req.flash("error") || [];
  res.render("index", { error });
});


// login page
app.get("/login", redirectAuthenticated, (req, res) => {
  res.render("login", {
    demoEmail: "",      // send empty string if not using demo
    demoPassword: "",   // send empty string if not using demo
    error: req.flash("error"),
    success_msg: req.flash("success_msg")
  });
});

// EMPLOYEE AUDIT LOGS 
app.get("/employee/audit_logs", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  try {
    const filterAction = req.query.action || "all";
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    let query = "SELECT * FROM audit_logs WHERE performed_by=$1";
    let params = [req.user.id];

    if (filterAction !== "all") {
      query += " AND action=$2";
      params.push(filterAction);
    }

    const countQuery = filterAction === "all"
      ? "SELECT COUNT(*) FROM audit_logs WHERE performed_by=$1"
      : "SELECT COUNT(*) FROM audit_logs WHERE performed_by=$1 AND action=$2";

    const countResult = await pool.query(countQuery, params);
    const totalRows = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / limit);

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.render("employee/audit_logs", {
      logs: result.rows,
      filterAction,
      currentPage: page,
      totalPages
    });
  } catch (err) {
    logger.error(`Failed to fetch employee audit logs: ${err.stack || err}`);
    req.flash("err_msg", "Unable to fetch your audit logs");
    res.redirect("/employee/dashboard");
  }
});

// ====== EMPLOYEE LEAVE HISTORY ======
app.get("/employee/leave/history/:id", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  const leaveId = req.params.id;
  try {
    const leaveResult = await pool.query(
      `SELECT lr.*, a.name AS approved_by
       FROM leave_req lr
       LEFT JOIN users a ON lr.approved_by = a.id
       WHERE lr.id=$1 AND lr.user_id=$2`,
      [leaveId, req.user.id]
    );

    if (leaveResult.rows.length === 0) {
      req.flash("err_msg", "Leave not found");
      return res.redirect("/employee/leave-list");
    }

    const leave = leaveResult.rows[0];

    const logsResult = await pool.query(
      `SELECT al.*, u.name AS performed_by_name
       FROM audit_logs al
       LEFT JOIN users u ON al.performed_by = u.id
       WHERE al.target_table='leave_req' AND al.target_id=$1
       ORDER BY al.created_at ASC`,
      [leaveId]
    );

    res.render("employee/leave-history", {
      username: req.user.name,
      leave,
      logs: logsResult.rows,
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg")
    });

  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to fetch leave history");
    res.redirect("/employee/leave-list");
  }
});


app.get("/employee/leave/cancel/:id", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  const leaveId = req.params.id;
  try {
    const result = await pool.query(
      "UPDATE leave_req SET deleted_at=NOW(), status='cancelled' WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING *",
      [leaveId, req.user.id]
    );
    logger.info(`Leave cancelled: leaveId=${leaveId} by userId=${req.user.id}`);


    if (result.rows.length === 0) {
      req.flash("err_msg", "Cannot cancel leave (maybe already actioned)");
      return res.redirect("/employee/leave-list");
    }

    await logAudit({
      action: "LEAVE_CANCELLED",
      performedBy: req.user.id,
      targetTable: "leave_req",
      targetId: leaveId,
      oldStatus: "pending",
      newStatus: "cancelled",
      message: "Employee cancelled leave"
    });

    req.flash("success_msg", "Leave cancelled successfully");
    res.redirect("/employee/leave-list");
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Cannot cancel leave");
    res.redirect("/employee/leave-list");
  }
});
// POST change user role
app.post("/admin/users/role/:userId", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    if (userId === req.user.id) {
      req.flash("err_msg", "You cannot change your own role");
      return res.redirect("/admin/users");
    }

    const result = await pool.query("SELECT id, role FROM users WHERE id=$1", [userId]);
    logger.info(`User role changed: userId=${userId}, newRole=${newRole}, by adminId=${req.user.id}`);

    const user = result.rows[0];
    if (!user) {
      req.flash("err_msg", "User not found");
      return res.redirect("/admin/users");
    }

    const newRole = user.role === "admin" ? "employee" : "admin";
    await pool.query("UPDATE users SET role=$1 WHERE id=$2", [newRole, userId]);

    req.flash("success_msg", `Role changed to ${newRole}`);
    res.redirect("/admin/users");
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to change role");
    res.redirect("/admin/users");
  }
});

// GET edit user form
app.get("/admin/users/edit/:userId", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    const result = await pool.query("SELECT id, name, email, role, is_active FROM users WHERE id=$1", [userId]);
    logger.info(`User edited: userId=${userId}, by adminId=${req.user.id}`);

    if (!result.rows[0]) {
      req.flash("err_msg", "User not found");
      return res.redirect("/admin/users");
    }
    const user = result.rows[0];
    res.render("admin/edit-user", { user, success_msg: [], err_msg: [] });
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Cannot load user for editing");
    res.redirect("/admin/users");
  }
});

// POST edit user
app.post("/admin/users/edit/:userId", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const userId = parseInt(req.params.userId);
  const { name, email, role } = req.body;
  try {
    if (userId === req.user.id) {
      req.flash("err_msg", "You cannot edit your own role");
      return res.redirect("/admin/users");
    }

    await pool.query("UPDATE users SET name=$1, email=$2, role=$3 WHERE id=$4", [name, email, role, userId]);
    req.flash("success_msg", "User updated successfully");
    res.redirect("/admin/users");
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Failed to update user");
    res.redirect("/admin/users");
  }
});





app.get("/dashboard", ensureAuthenticated, (req, res) => {
  if (!req.user) return res.redirect("/login");

  const role = req.user.role.toLowerCase();
  if (role === "admin") return res.redirect("/admin/dashboard");
  return res.redirect("/employee/dashboard");
});


// ---------- VIEW SINGLE LEAVE DETAILS ----------
app.get("/admin/leave/:leaveId", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const leaveId = req.params.leaveId;
  try {
    // Fetch leave details
    const leaveResult = await pool.query(`
      SELECT lr.*, u.name AS employee_name, u.email, a.name AS actioned_by
      FROM leave_req lr
      JOIN users u ON lr.user_id = u.id
      LEFT JOIN users a ON lr.approved_by = a.id
      WHERE lr.id=$1
    `, [leaveId]);

    if (!leaveResult.rows[0]) {
      req.flash("err_msg", "Leave not found");
      return res.redirect("/admin/leave");
    }

    const leave = leaveResult.rows[0];

    // Optional: fetch audit logs for this leave
    const logsResult = await pool.query(`
      SELECT al.*, u.name AS performed_by_name
      FROM audit_logs al
      LEFT JOIN users u ON al.performed_by = u.id
      WHERE al.target_table='leave_req' AND al.target_id=$1
      ORDER BY al.created_at ASC
    `, [leaveId]);

    res.render("admin/leave-details", {
      leave,
      logs: logsResult.rows,           // keep this if you want to show logs
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg")
    });

  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to fetch leave details");
    res.redirect("/admin/leave");
  }
});
// ---------- ADMIN DASHBOARD ----------
app.get("/admin/dashboard", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  try {
    const totalUsers = (await pool.query("SELECT COUNT(*) FROM users")).rows[0].count;
    const pendingLeave = (await pool.query("SELECT COUNT(*) FROM leave_req WHERE status='pending'")).rows[0].count;
    const approvedLeave = (await pool.query("SELECT COUNT(*) FROM leave_req WHERE status='approved'")).rows[0].count;
    const rejectedLeave = (await pool.query("SELECT COUNT(*) FROM leave_req WHERE status='rejected'")).rows[0].count;

    const filter = req.query.status || "all";

    let leaveQuery = "SELECT * FROM leave_req";
    const values = [];
    if (filter !== "all") {
      leaveQuery += " WHERE status=$1";
      values.push(filter);
    }

    const leaves = (await pool.query(leaveQuery, values)).rows;

    res.render("admin/dashboard", {
      adminName: req.user?.name || "Admin",
      totalUsers,
      pendingLeave,
      approvedLeave,
      rejectedLeave,
      leaves,
      filter,
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg")
    });
  } catch (err) {
    console.error(err);
    res.render("admin/dashboard", {
      adminName: "Admin",
      totalUsers: 0,
      pendingLeave: 0,
      approvedLeave: 0,
      rejectedLeave: 0,
      leaves: [],
      filter: "all",
      success_msg: [],
      err_msg: ["Something went wrong"]
    });
  }
});


// ---------- VIEW LEAVE HISTORY ----------
app.get("/admin/leave/history/:leaveId", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const leaveId = req.params.leaveId;
  try {
    const leaveResult = await pool.query(`
      SELECT lr.*, u.name AS employee_name, u.email
      FROM leave_req lr
      JOIN users u ON lr.user_id = u.id
      WHERE lr.id=$1
    `, [leaveId]);

    if (!leaveResult.rows[0]) {
      req.flash("err_msg", "Leave not found");
      return res.redirect("/admin/leave");
    }

    const leave = leaveResult.rows[0];

    const logsResult = await pool.query(`
      SELECT al.*, u.name AS performed_by_name
      FROM audit_logs al
      LEFT JOIN users u ON al.performed_by = u.id
      WHERE al.target_table='leave_req' AND al.target_id=$1
      ORDER BY al.created_at ASC
    `, [leaveId]);

    res.render("admin/leave-history", {
      leave,
      logs: logsResult.rows,
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg")
    });

  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to fetch leave history");
    res.redirect("/admin/leave");
  }
});

// ---------- ADMIN LEAVE MANAGEMENT ----------
app.get("/admin/leave", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const statusFilter = req.query.status || "all";
  try {
    let query = `
      SELECT lr.*, u.name AS employee_name, a.name AS actioned_by
      FROM leave_req lr
      JOIN users u ON lr.user_id = u.id
      LEFT JOIN users a ON lr.approved_by = a.id
    `;
    const params = [];
    if (statusFilter !== "all") {
      query += ` WHERE lr.status=$1`;
      params.push(statusFilter);
    }
    query += " ORDER BY lr.created_at DESC";

    const result = await pool.query(query, params);

    res.render("admin/leave", {
      leaves: result.rows,
      filter: statusFilter,
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg")
    });
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to fetch leave requests");
    res.redirect("/admin/dashboard");
  }
});

// ---------- APPROVE LEAVE ----------
app.post("/admin/leave/approve/:leaveId", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const leaveId = req.params.leaveId;
  const managerId = req.user.id;

  try {
    const leaveResult = await pool.query(`
      SELECT lr.status, u.name, u.email
      FROM leave_req lr
      JOIN users u ON lr.user_id = u.id
      WHERE lr.id=$1
    `, [leaveId]);
    logger.info(`Leave approved: leaveId=${leaveId} by adminId=${managerId}`);

    const leave = leaveResult.rows[0];
    if (!leave || leave.status !== "pending") {
      req.flash("err_msg", "Cannot approve this leave (not pending)");
      return res.redirect("/admin/leave");
    }

    const oldStatus = leave.status;

    await pool.query(`
      UPDATE leave_req
      SET status='approved', approved_by=$1, actioned_at=NOW()
      WHERE id=$2
    `, [managerId, leaveId]);

    await logAudit({
      action: "LEAVE_APPROVED",
      performedBy: managerId,
      targetTable: "leave_req",
      targetId: leaveId,
      oldStatus,
      newStatus: "approved",
      message: "Leave approved"
    });

    

    req.flash("success_msg", "Leave approved successfully");
    res.redirect("/admin/leave");

  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Failed to approve leave");
    res.redirect("/admin/leave");
  }
});

// ---------- AUDIT LOGS ----------
app.get("/admin/audit_logs", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  try {
    const filterAction = req.query.action || "all";
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    let query = "SELECT al.*, u.name AS performed_by_name FROM audit_logs al LEFT JOIN users u ON al.performed_by = u.id";
    const params = [];
    if (filterAction !== "all") {
      query += " WHERE action=$1";
      params.push(filterAction);
    }

    const countResult = await pool.query(
      filterAction === "all" ? "SELECT COUNT(*) FROM audit_logs" : "SELECT COUNT(*) FROM audit_logs WHERE action=$1",
      params
    );
    const totalRows = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / limit);

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.render("admin/audit_logs", {
      logs: result.rows,
      filterAction,
      currentPage: page,
      totalPages
    });
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to fetch audit logs");
    res.redirect("/admin/dashboard");
  }
});
app.get("/admin/audit_logs/export/csv", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  try {
    const filterAction = req.query.action || "all";

    let query = `
      SELECT 
        al.id,
        al.action,
        al.message,
        al.old_status,
        al.new_status,
        al.target_table,
        al.target_id,
        al.created_at,
        u.name AS performed_by
      FROM audit_logs al
      LEFT JOIN users u ON al.performed_by = u.id
    `;

    const params = [];

    if (filterAction !== "all") {
      query += " WHERE al.action=$1";
      params.push(filterAction);
    }

    query += " ORDER BY al.created_at DESC";

    const result = await pool.query(query, params);

    const fields = [
      "id",
      "action",
      "message",
      "old_status",
      "new_status",
      "target_table",
      "target_id",
      "performed_by",
      "created_at"
    ];
    logger.info(`CSV exported: userId=${req.user.id}, type=audit_logs`);


    const parser = new Parser({ fields });
    const csv = parser.parse(result.rows);

    res.header("Content-Type", "text/csv");
    res.attachment("audit_logs.csv");
    return res.send(csv);

  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Failed to export audit logs");
    res.redirect("/admin/audit_logs");
  }
});

// ---------- EMPLOYEE DASHBOARD ----------
app.get("/employee/dashboard", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  try {
    // ---------- LEAVE COUNTS ----------
    const totalLeavesResult = await pool.query(
      "SELECT COUNT(*) AS count FROM leave_req WHERE user_id=$1",
      [req.user.id]
    );
    const approvedLeavesResult = await pool.query(
      "SELECT COUNT(*) AS count FROM leave_req WHERE user_id=$1 AND status='approved'",
      [req.user.id]
    );
    const rejectedLeavesResult = await pool.query(
      "SELECT COUNT(*) AS count FROM leave_req WHERE user_id=$1 AND status='rejected'",
      [req.user.id]
    );
    const pendingLeavesResult = await pool.query(
      "SELECT COUNT(*) AS count FROM leave_req WHERE user_id=$1 AND status='pending'",
      [req.user.id]
    );

    const totalleave = parseInt(totalLeavesResult.rows[0].count);
    const approvedLeave = parseInt(approvedLeavesResult.rows[0].count);
    const rejectedLeave = parseInt(rejectedLeavesResult.rows[0].count);
    const pendingLeave = parseInt(pendingLeavesResult.rows[0].count);

    // ---------- FETCH ALL LEAVES (or latest 10 for dashboard) ----------
    const leavesResult = await pool.query(
      "SELECT * FROM leave_req WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10",
      [req.user.id]
    );

    const leaves = leavesResult.rows.map(row => ({
      ...row,
      start_date: row.start_date ? new Date(row.start_date) : null,
      end_date: row.end_date ? new Date(row.end_date) : null,
      actioned_at: row.actioned_at ? new Date(row.actioned_at) : null
    }));

    // ---------- LATEST LEAVE ----------
    const latestLeave = leaves[0] || null;

    // ---------- RENDER DASHBOARD ----------
    res.render("employee/dashboard", {
      username: req.user.name,   // Use in EJS as <%= username %>
      totalleave,
      approvedLeave,
      rejectedLeave,
      pendingLeave,
      leave: latestLeave,        // optional separate latest leave
      leaves,                    // this fixes the 'leaves is not defined' error
      filter: "all",             // default filter value
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg")
    });
  } catch (err) {
    console.error(err.stack || err);
    req.flash("err_msg", "Cannot load dashboard");
    res.redirect("/");
  }
});


// ---------- EMPLOYEE LEAVE APPLY ----------
app.get("/employee/leave-apply", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  const pending = await pool.query(
    "SELECT * FROM leave_req WHERE user_id=$1 AND status='pending'",
    [req.user.id]
  );

  if (pending.rows.length > 0) {
    req.flash("err_msg", "You have a pending leave. Cannot apply new leave.");
    return res.redirect("/employee/dashboard");
  }

  res.render("employee/leave-apply", {
    success_msg: req.flash("success_msg"),
    err_msg: req.flash("err_msg")
  });
});
app.post("/employee/leave-apply", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  const { sdate, edate, reason } = req.body;

  if (!sdate || !edate || !reason) {
    req.flash("err_msg", "All fields are required");
    return res.redirect("/employee/leave-apply");
  }
  if (new Date(sdate) > new Date(edate)) {
    req.flash("err_msg", "Start date cannot be after end date");
    return res.redirect("/employee/leave-apply");
  }

  try {
    const leaveCountResult = await pool.query(
      "SELECT COUNT(*) AS count FROM leave_req WHERE user_id=$1",
      [req.user.id]
    );
    if (parseInt(leaveCountResult.rows[0].count) >= 20) {
      req.flash("err_msg", "You have reached max leave limit. Contact admin.");
      return res.redirect("/employee/dashboard");
    }

    // INSERT and get the inserted leave ID
    const newLeave = await pool.query(
      `INSERT INTO leave_req (user_id, start_date, end_date, reason, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
      [req.user.id, sdate, edate, reason]
    );
    const newLeaveId = newLeave.rows[0].id;

    // Log here, after leave is created
    logger.info(`Leave applied: leaveId=${newLeaveId} by userId=${req.user.id}`);

    req.flash("success_msg", "Leave request submitted");
    res.redirect("/employee/leave-list");
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Failed to apply for leave");
    res.redirect("/employee/leave-apply");
  }
});

// ----------m EMPLOYEE LEAVE LIST (WITH FILTER, PAGINATION, CSV) ----------
app.get("/employee/leave-list", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  try {
    let { status = "all", startDate, endDate, page = 1, exportCsv } = req.query;
    page = parseInt(page);
    const limit = 10;
    const offset = (page - 1) * limit;

    let query = `SELECT lr.*, u.name AS actioned_by_name
                 FROM leave_req lr
                 LEFT JOIN users u ON lr.approved_by = u.id
                 WHERE lr.user_id = $1`;
    let params = [req.user.id];

    if (status !== "all") { params.push(status); query += ` AND lr.status=$${params.length}`; }
    if (startDate) { params.push(startDate); query += ` AND lr.start_date >= $${params.length}`; }
    if (endDate) { params.push(endDate); query += ` AND lr.end_date <= $${params.length}`; }

    if (exportCsv === "1") {
      const { Parser } = require("json2csv");
      const result = await pool.query(query + " ORDER BY lr.created_at DESC", params);
      const parser = new Parser({ fields: ["id","start_date","end_date","reason","status","rejection_reason","actioned_by_name"] });
      res.header('Content-Type', 'text/csv');
      res.attachment('leave_history.csv');
      return res.send(parser.parse(result.rows));
    }

    // Pagination count
    let countQuery = `SELECT COUNT(*) FROM leave_req WHERE user_id=$1`;
    let countParams = [req.user.id];
    if (status !== "all") { countQuery += ` AND status=$2`; countParams.push(status); }

    const totalResult = await pool.query(countQuery, countParams);
    const totalPages = Math.ceil(totalResult.rows[0].count / limit);

    query += ` ORDER BY lr.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.render("employee/leave-list", {
      leaves: result.rows,
      filter: { status, startDate, endDate },
      currentPage: page,
      totalPages,
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg")
    });

  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Cannot fetch leave list");
    res.redirect("/employee/dashboard");
  }
});

// ---------- EMPLOYEE EDIT LEAVE ----------
app.get("/employee/leave/edit/:id", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  const leaveId = req.params.id;
  try {
    const result = await pool.query("SELECT * FROM leave_req WHERE id=$1 AND user_id=$2", [leaveId, req.user.id]);
    logger.info(`Leave edited: leaveId=${leaveId} by userId=${req.user.id}`);

    if (!result.rows.length) {
      req.flash("err_msg", "Leave not found");
      return res.redirect("/employee/leave-list");
    }
    const leave = result.rows[0];
    if (leave.status !== "pending") {
      req.flash("err_msg", "Only pending leaves can be edited");
      return res.redirect("/employee/leave-list");
    }
    res.render("employee/edit-leave", { leave, err_msg: [], success_msg: [] });
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Cannot edit the leave request");
    res.redirect("/employee/leave-list");
  }
});

app.post("/employee/leave/edit/:id", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  const leaveId = req.params.id;
  const { sdate, edate, reason } = req.body;
  let error = [];
  if (!sdate || !edate || !reason) error.push("All fields are required");
  if (new Date(sdate) > new Date(edate)) error.push("Start date cannot be after end date");

  if (error.length > 0) {
    return res.render("employee/edit-leave", { 
      leave: { id: leaveId, start_date: sdate, end_date: edate, reason }, 
      err_msg: error, 
      success_msg: [] 
    });
  }

  try {
    const result = await pool.query(
      "UPDATE leave_req SET start_date=$1, end_date=$2, reason=$3 WHERE id=$4 AND user_id=$5 AND status='pending' RETURNING *",
      [sdate, edate, reason, leaveId, req.user.id]
    );

    if (!result.rows.length) {
      return res.render("employee/edit-leave", { 
        leave: { id: leaveId, start_date: sdate, end_date: edate, reason }, 
        err_msg: ["Cannot edit leave (maybe not pending)"], 
        success_msg: [] 
      });
    }

    res.render("employee/edit-leave", { leave: result.rows[0], err_msg: [], success_msg: ["Leave updated successfully"] });
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to update leave");
    res.redirect("/employee/leave-list");
  }
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
