require("dotenv").config();
const express = require("express");
const app = express();
const { pool } = require("./dbconfig");
const logger = require("./logger");
const bcrypt = require("bcrypt");
const session = require("express-session");
const flash = require("express-flash");
const passport = require("passport");
const inipass = require("./passport/passportconfig");
const { redirectAuthenticated, ensureAuthenticated, permitRoles } = require("./middleware/auth");

/* =======================
   APP CONFIG
======================= */

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: false }));

app.set("trust proxy", 1);

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
  })
);

app.use(passport.initialize());
app.use(passport.session());
inipass(passport);

app.use(flash());

/* =======================
   ROUTES
======================= */

// HOME
app.get("/", (req, res) => res.render("index"));

// REGISTER
app.get("/register", redirectAuthenticated, (req, res) => res.render("register", { error: [] }));

app.post("/register", async (req, res) => {
  const { name, email, password, conpass } = req.body;
  let error = [];
  if (!name || !email || !password || !conpass) error.push({ message: "Please enter all fields" });
  if (password.length < 6) error.push({ message: "Password needs 6 characters" });
  if (password !== conpass) error.push({ message: "Passwords did not match" });

  if (error.length > 0) return res.render("register", { error });

  try {
    const exists = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    if (exists.rows.length > 0) {
      error.push({ message: "Email already exists" });
      return res.render("register", { error });
    }

    const hashpass = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (name,email,password,role) VALUES ($1,$2,$3,'employee')", [name, email, hashpass]);

    req.flash("success_msg", "You are successfully registered");
    res.redirect("/login");
  } catch (err) {
    logger.error(err.message);
    res.send(err.message);
  }
});

// LOGIN
app.get("/login", redirectAuthenticated, (req, res) => res.render("login"));

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/redirect_after_login",
    failureRedirect: "/login",
    failureFlash: true
  })
);

// REDIRECT AFTER LOGIN
app.get("/redirect_after_login", ensureAuthenticated, (req, res) => {
  if (req.user.role === "admin") return res.redirect("/admin/dashboard");
  return res.redirect("/employee/dashboard");
});

// LOGOUT
app.get("/logout", (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    req.flash("success_msg", "Successfully logged out");
    res.redirect("/login");
  });
});

/* =======================
   EMPLOYEE ROUTES
======================= */

app.get("/employee/dashboard", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  try {
    const total = await pool.query("SELECT COUNT(*) FROM leave_req WHERE user_id=$1", [req.user.id]);
    const approved = await pool.query("SELECT COUNT(*) FROM leave_req WHERE user_id=$1 AND status='approved'", [req.user.id]);
    const rejected = await pool.query("SELECT COUNT(*) FROM leave_req WHERE user_id=$1 AND status='rejected'", [req.user.id]);

    res.render("employee/dashboard", {
      user: req.user.name,
      totalleave: total.rows[0].count,
      approvedLeave: approved.rows[0].count,
      rejectedLeave: rejected.rows[0].count
    });
  } catch (err) {
    logger.error(err.message);
    res.redirect("/");
  }
});

app.get("/employee/leave-apply", ensureAuthenticated, permitRoles("employee"), (req, res) => {
  res.render("employee/leave-apply", { err_msg: [], success_msg: [] });
});

app.post("/employee/leave-apply", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  const { sdate, edate, reason } = req.body;
  let errors = [];
  if (!sdate || !edate || !reason) errors.push("All fields are required");
  if (new Date(sdate) > new Date(edate)) errors.push("Start date cannot be after end date");

  if (errors.length > 0) return res.render("employee/leave-apply", { err_msg: errors, success_msg: [] });

  try {
    await pool.query(
      "INSERT INTO leave_req (user_id,start_date,end_date,reason,status,created_at) VALUES ($1,$2,$3,$4,'pending',NOW())",
      [req.user.id, sdate, edate, reason]
    );
    res.render("employee/leave-apply", { err_msg: [], success_msg: ["Leave request submitted"] });
  } catch (err) {
    logger.error(err.message);
    res.render("employee/leave-apply", { err_msg: ["Failed to submit leave"], success_msg: [] });
  }
});

app.get("/employee/leave-list", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT lr.*, a.name as actioned_by_name FROM leave_req lr LEFT JOIN users a ON lr.approved_by=a.id WHERE lr.user_id=$1 ORDER BY lr.created_at DESC",
      [req.user.id]
    );

    const leaves = result.rows.map(row => ({
      id: row.id,
      reason: row.reason,
      start: new Date(row.start_date),
      end: new Date(row.end_date),
      created_at: new Date(row.created_at),
      status: row.status,
      approved_by: row.actioned_by_name || null,
      actioned_at: row.actioned_at ? new Date(row.actioned_at) : null,
      rejection_reason: row.rejection_reason || null
    }));

    res.render("employee/leave-list", {
      leave: leaves,
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg")
    });
  } catch (err) {
    logger.error(err.message);
    req.flash("err_msg", "Unable to fetch leave list");
    res.redirect("/employee/dashboard");
  }
});

/* =======================
   ADMIN ROUTES
======================= */

app.get("/admin/dashboard", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  try {
    const totUser = await pool.query("SELECT COUNT(*) FROM users");
    const pending = await pool.query("SELECT COUNT(*) FROM leave_req WHERE status='pending'");
    const approved = await pool.query("SELECT COUNT(*) FROM leave_req WHERE status='approved'");
    const rejected = await pool.query("SELECT COUNT(*) FROM leave_req WHERE status='rejected'");

    const newRequest = await pool.query(
      "SELECT lr.id, u.name as employee_name, lr.start_date, lr.end_date, lr.reason, lr.created_at FROM leave_req lr JOIN users u ON lr.user_id=u.id WHERE lr.status='pending' ORDER BY lr.created_at ASC LIMIT 5"
    );

    res.render("admin/dashboard", {
      adminame: req.user.name,
      totaluser: totUser.rows[0].count,
      Leaveuser: pending.rows[0].count,
      approveuser: approved.rows[0].count,
      rejectuser: rejected.rows[0].count,
      pendingRequest: newRequest.rows[0]
    });
  } catch (err) {
    logger.error(err.message);
    req.flash("err_msg", "Unable to load dashboard");
    res.redirect("/");
  }
});

// APPROVE/REJECT LEAVES
app.post("/admin/leave/approve/:id", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const leaveid = req.params.id;
  const adminid = req.user.id;
  try {
    await pool.query("UPDATE leave_req SET status='approved', approved_by=$1, actioned_at=NOW() WHERE id=$2", [adminid, leaveid]);
    res.redirect("/admin/leave");
  } catch (err) {
    logger.error(err.message);
    res.redirect("/admin/leave");
  }
});

app.post("/admin/leave/reject/:id", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const leaveid = req.params.id;
  const reason = req.body.reason;
  const adminid = req.user.id;
  try {
    await pool.query(
      "UPDATE leave_req SET status='rejected', rejection_reason=$1, approved_by=$2, actioned_at=NOW() WHERE id=$3",
      [reason, adminid, leaveid]
    );
    res.redirect("/admin/leave");
  } catch (err) {
    logger.error(err.message);
    res.redirect("/admin/leave");
  }
});

// USER MANAGEMENT (ADMIN)
app.get("/admin/users", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users ORDER BY id ASC");
    res.render("admin/users", { users: result.rows, success_msg: req.flash("success_msg"), err_msg: req.flash("err_msg") });
  } catch (err) {
    logger.error(err.message);
    req.flash("err_msg", "Unable to fetch users");
    res.redirect("/admin/dashboard");
  }
});

app.post("/admin/users/:id", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const userid = req.params.id;
  const adminid = req.user.id;
  try {
    const result = await pool.query("SELECT id, is_active FROM users WHERE id=$1", [userid]);
    if (!result.rows[0]) {
      req.flash("err_msg", "User not found");
      return res.redirect("/admin/users");
    }
    if (userid == adminid) {
      req.flash("err_msg", "You cannot deactivate yourself");
      return res.redirect("/admin/users");
    }

    const newStatus = !result.rows[0].is_active;
    await pool.query("UPDATE users SET is_active=$1 WHERE id=$2", [newStatus, userid]);
    req.flash("success_msg", newStatus ? "User activated" : "User deactivated");
    res.redirect("/admin/users");
  } catch (err) {
    logger.error(err.message);
    req.flash("err_msg", "Unable to update user");
    res.redirect("/admin/users");
  }
});

/* =======================
   ERROR HANDLER
======================= */

app.use((err, req, res, next) => {
  console.error("ERROR CAUGHT:", err);
  res.status(500).send("Internal Server Error: Check Logs");
});

/* =======================
   START SERVER
======================= */

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server running on port ${port}`));
