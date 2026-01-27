// Load environment variables
require("dotenv").config();

const express = require("express");
const app = express();
const PORT = process.env.PORT || 10000; // <-- Add PORT here

const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const passport = require("passport");
const flash = require("express-flash");

// Custom modules
const initPass = require("./passport/passportconfig");
const { redirectAuthenticated, ensureAuthenticated, permitRoles } = require("./middleware/auth");
const logger = require("./logger");

// ---------- DB ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------- Middleware ----------
app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: false }));
app.set("trust proxy", 1); // Required for Render behind proxy

app.use(
  session({
    store: new pgSession({ pool, tableName: "session", createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    // Render requires this for HTTPS and cookies
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      secure: process.env.NODE_ENV === "production", // Only true in prod
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", // Use 'none' for cross-site in prod
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());
initPass(passport);
app.use(flash());

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`[INFO]: Server running on port ${PORT}`);
});

// ---------------- Landing Page ----------------
app.get("/", (req, res) => {
  res.render("index"); // renders your index.ejs
});

// ---------------- Demo Login Route ----------------
app.get("/demo/:role", async (req, res) => {
  const { role } = req.params;
  let demoEmail = "";
  let demoPassword = "";

  if (role === "admin") {
    demoEmail = "admin@officecore.demo";
    demoPassword = "Admin@123";
  } else if (role === "employee") {
    demoEmail = "employee@officecore.demo";
    demoPassword = "Employee@123";
  } else {
    return res.redirect("/login");
  }

  // ✅ Send webhook for demo login usage
  try {
    console.log(`Webhook sent for demo login as ${role}`);
  } catch (err) {
    console.error("Failed to send webhook:", err);
  }

  res.render("login", { messages: req.flash(), demoEmail, demoPassword });
});

// ---------------- Auth Routes ----------------
app.get("/register", redirectAuthenticated, (req, res) => {
  res.render("register", { error: [] });
});

app.get("/login", redirectAuthenticated, (req, res) => {
  // Normal login page, no pre-filled demo credentials
  res.render("login", { messages: req.flash(), demoEmail: "", demoPassword: "" });
});

app.post("/login", passport.authenticate("local", {
  successRedirect: "/dashboard",
  failureRedirect: "/login",
  failureFlash: true
}), async (req, res) => {
  // Optional: webhook on successful login
});


// Test email route
app.get("/test-email", async (req, res) => {
  try {
    await sendEmail({
      to: "sabrinaleetcode@gmail.com",
      subject: "OfficeCore Test Email",
      html: "<p>Hello, this is a test email from OfficeCore!</p>",
    });
    res.send("Test email sent successfully ✅");
  } catch (err) {
    console.error("Failed to send email:", err);
    res.status(500).send("Failed to send test email ❌");
  }
});

app.post("/register", async (req, res) => {
  const { name, email, password, conpass } = req.body;
  let error = [];
  if (!name || !email || !password || !conpass) error.push({ message: "Please enter all fields" });
  if (password.length < 6) error.push({ message: "Password needs at least 6 characters" });
  if (password !== conpass) error.push({ message: "Passwords do not match" });

  if (error.length > 0) return res.render("register", { error });

  try {
    const hashpass = await bcrypt.hash(password, 10);
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    if (result.rows.length > 0) {
      return res.render("register", { error: [{ message: "Email already exists" }] });
    }

    await pool.query(
      "INSERT INTO users (name,email,password,role) VALUES ($1,$2,$3,$4)",
      [name, email, hashpass, "employee"]
    );

    // ✅ Send webhook after successful registration

    req.flash("success_msg", "You are successfully registered");
    res.redirect("/login");
  } catch (err) {
    logger.error(err.stack || err);
    res.send(err.message);
  }
});

app.use((req, res, next) => {
  console.log("Session:", req.session);
  console.log("User:", req.user);
  next();
});
app.get("/login", redirectAuthenticated, (req, res) => res.render("login"));

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/redirect_after_login",
    failureRedirect: "/login",
    failureFlash: true,
  })
);

app.get("/redirect_after_login", ensureAuthenticated, (req, res) => {
  if (req.user.role === "admin") return res.redirect("/admin/dashboard");
  return res.redirect("/employee/dashboard");
});


app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash("success_msg", "You are successfully logged out");
    res.redirect("/login");
  });
});


// --------- EMPLOYEE DASHBOARD ---------
app.get("/employee/dashboard", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  try {
    // Get counts of leaves
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

    const totalleave = parseInt(totalLeavesResult.rows[0].count) || 0;
    const approvedLeave = parseInt(approvedLeavesResult.rows[0].count) || 0;
    const rejectedLeave = parseInt(rejectedLeavesResult.rows[0].count) || 0;

    // Get latest leave for the user
    const latestLeaveResult = await pool.query(
      "SELECT * FROM leave_req WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
      [req.user.id]
    );
    const latestLeave = latestLeaveResult.rows[0] || null;

    // Get audit logs for latest leave if exists
    let leaveLogs = [];
    if (latestLeave) {
      const logsResult = await pool.query(
        `SELECT al.*, u.name AS performed_by_name
         FROM audit_logs al
         LEFT JOIN users u ON al.performed_by = u.id
         WHERE al.target_table='leave_req' AND al.target_id=$1
         ORDER BY al.created_at ASC`,
        [latestLeave.id]
      );
      leaveLogs = logsResult.rows;
    }

    // Render dashboard
    res.render("employee/dashboard", {
      username: req.user.name,
      totalleave,
      approvedLeave,
      rejectedLeave,
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg"),
      leave: latestLeave,
      logs: leaveLogs
    });

  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to load dashboard");
    res.redirect("/");
  }
});


//  EMPLOYEE LEAVE ROUTES 
const { Parser } = require('json2csv');

app.get("/employee/leave-list", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  try {
    const { status, startDate, endDate, page, exportCsv } = req.query;

    const currentPage = parseInt(page) || 1;
    const limit = 10;
    const offset = (currentPage - 1) * limit;

    // Build dynamic query
    let query = `SELECT lr.*, a.name AS actioned_by_name
                 FROM leave_req lr
                 LEFT JOIN users a ON lr.approved_by = a.id
                 WHERE lr.user_id=$1`;
    let params = [req.user.id];

    if (status && status !== "all") {
      params.push(status);
      query += ` AND lr.status=$${params.length}`;
    }
    if (startDate) {
      params.push(startDate);
      query += ` AND lr.start_date >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      query += ` AND lr.end_date <= $${params.length}`;
    }

    // CSV Export
    if (exportCsv === "1") {
      const csvResult = await pool.query(query + " ORDER BY lr.created_at DESC", params);
      const fields = ["id", "start_date", "end_date", "reason", "status", "rejection_reason", "actioned_by_name"];
      const parser = new Parser({ fields });
      const csv = parser.parse(csvResult.rows);
      res.header('Content-Type', 'text/csv');
      res.attachment('leave_history.csv');
      return res.send(csv);
    }

    // Pagination
    const countQuery = `SELECT COUNT(*) FROM leave_req lr WHERE lr.user_id=$1` +
      (status && status !== "all" ? ` AND lr.status='${status}'` : '') +
      (startDate ? ` AND lr.start_date >= '${startDate}'` : '') +
      (endDate ? ` AND lr.end_date <= '${endDate}'` : '');

    const countResult = await pool.query(countQuery, [req.user.id]);
    const totalRows = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / limit);

    query += ` ORDER BY lr.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    const leaves = result.rows.map(row => ({
      ...row,
      start_date: row.start_date ? new Date(row.start_date) : null,
      end_date: row.end_date ? new Date(row.end_date) : null,
      actioned_at: row.actioned_at ? new Date(row.actioned_at) : null
    }));

    res.render("employee/leave-list", {
      leaves,
      filter: { status, startDate, endDate },
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg"),
      currentPage,
      totalPages
    });

  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to fetch leave list.");
    res.redirect("/employee/dashboard");
  }
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

    // Get total count for pagination
    const countQuery = filterAction === "all"
      ? "SELECT COUNT(*) FROM audit_logs WHERE performed_by=$1"
      : "SELECT COUNT(*) FROM audit_logs WHERE performed_by=$1 AND action=$2";

    const countResult = await pool.query(countQuery, params);
    const totalRows = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / limit);

    // Add limit & offset for pagination
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
      leave, // ✅ single leave object
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
    // Soft delete: mark deleted_at and inactive instead of removing
    const result = await pool.query(
      "UPDATE leave_req SET deleted_at=NOW(), status='cancelled' WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING *",
      [leaveId, req.user.id]
    );

    if (result.rows.length === 0) {
      req.flash("err_msg", "Cannot cancel leave (maybe already actioned)");
      return res.redirect("/employee/leave-list");
    }

    // Log audit
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


app.get("/employee/leave-apply", ensureAuthenticated, permitRoles("employee"), (req, res) => {
  res.render("employee/leave-apply", {
    success_msg: req.flash("success_msg"),
    err_msg: req.flash("err_msg"),
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
    await pool.query(
      `INSERT INTO leave_req (user_id, start_date, end_date, reason, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [req.user.id, sdate, edate, reason]
    );

    req.flash("success_msg", "Leave request submitted");
    res.redirect("/employee/leave-list");

  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Failed to apply for leave");
    res.redirect("/employee/leave-apply");
  }
});


app.get("/employee/leave/edit/:id", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  const leaveId = req.params.id;
  try {
    const result = await pool.query("SELECT * FROM leave_req WHERE id=$1 AND user_id=$2", [leaveId, req.user.id]);
    if (result.rows.length === 0) {
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
    return res.render("employee/edit-leave", { leave: { id: leaveId, start_date: sdate, end_date: edate, reason }, err_msg: error, success_msg: [] });
  }

  try {
    const result = await pool.query(
      "UPDATE leave_req SET start_date=$1, end_date=$2, reason=$3 WHERE id=$4 AND user_id=$5 AND status='pending' RETURNING *",
      [sdate, edate, reason, leaveId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.render("employee/edit-leave", { leave: { id: leaveId, start_date: sdate, end_date: edate, reason }, err_msg: ["Cannot edit leave (maybe not pending)"], success_msg: [] });
    }

    res.render("employee/edit-leave", { leave: result.rows[0], err_msg: [], success_msg: ["Leave updated successfully"] });
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to update leave");
    res.redirect("/employee/leave-list");
  }
});



//  ADMIN DASHBOARD 
app.get("/admin/dashboard", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  try {
    const totUser = await pool.query("SELECT COUNT(*) FROM users");
    const leaveUser = await pool.query("SELECT COUNT(*) FROM leave_req WHERE status='pending'");
    const approvedUser = await pool.query("SELECT COUNT(*) FROM leave_req WHERE status='approved'");
    const rejectedUser = await pool.query("SELECT COUNT(*) FROM leave_req WHERE status='rejected'");

    const newRequest = await pool.query(
      `SELECT lr.id, u.name AS employee_name, lr.start_date, lr.end_date, lr.reason, lr.created_at
       FROM leave_req lr
       JOIN users u ON lr.user_id = u.id
       WHERE lr.status='pending'
       ORDER BY lr.created_at ASC
       LIMIT 5`
    );

    res.render("admin/dashboard", {
      adminame: req.user.name,
      totaluser: totUser.rows[0].count,
      Leaveuser: leaveUser.rows[0].count,
      approveuser: approvedUser.rows[0].count,
      rejectuser: rejectedUser.rows[0].count,
      pendingRequest: newRequest.rows,
    });
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to load dashboard");
    res.redirect("/");
  }
});

//  ADMIN LEAVE MANAGEMENT
app.get("/admin/leave", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const status = req.query.status || "all";
  try {
    let query = `SELECT lr.*, a.name AS actioned_by, u.name AS employee_name
                 FROM leave_req lr
                 INNER JOIN users u ON lr.user_id = u.id
                 LEFT JOIN users a ON lr.approved_by = a.id`;
    if (status !== "all") query += ` WHERE lr.status='${status}'`;
    query += ` ORDER BY lr.created_at DESC`;

    const result = await pool.query(query);
    res.render("admin/leave", { leaves: result.rows, filter: status, success_msg: req.flash("success_msg"), err_msg: req.flash("err_msg") });
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to fetch leave requests");
    res.redirect("/admin/dashboard");
  }
});

// Approve leave
// ===== ADMIN LEAVE MANAGEMENT =====

// Approve leave
app.post("/admin/leave/approve/:id", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const leaveId = req.params.id;
  const managerId = req.user.id;

  try {
    // 1️⃣ Get leave info
    const leaveResult = await pool.query(`
      SELECT lr.status, u.email, u.name
      FROM leave_req lr
      JOIN users u ON lr.user_id = u.id
      WHERE lr.id = $1
    `, [leaveId]);

    const leave = leaveResult.rows[0];
    if (!leave || leave.status !== "pending") {
      req.flash("err_msg", "Cannot approve this leave (not pending)");
      return res.redirect("/admin/leave");
    }

    const oldStatus = leave.status;

    // 2️⃣ Update DB
    await pool.query(`
      UPDATE leave_req
      SET status='approved', approved_by=$1, actioned_at=NOW()
      WHERE id=$2
    `, [managerId, leaveId]);

    // 3️⃣ Log audit
    await logAudit({
      action: "LEAVE_APPROVED",
      performedBy: managerId,
      targetTable: "leave_req",
      targetId: leaveId,
      oldStatus,
      newStatus: "approved",
      message: "Leave approved"
    });

    // 4️⃣ Send email using your variable
    await sendEmail({
      to: leave.email,   // user email
      subject: "Leave Approved",
      html: `<p>Hi ${leave.name},</p><p>Your leave request has been <b>approved</b>.</p>`
    });

    req.flash("success_msg", "Leave approved successfully");
    res.redirect("/admin/leave");

  } catch (err) {
    console.error("Email or DB failed:", err);
    logger.error(err.stack || err);
    req.flash("err_msg", "Failed to approve leave");
    res.redirect("/admin/leave");
  }
});


// Reject leave
app.post("/admin/leave/reject/:id", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const leaveId = req.params.id;
  const managerId = req.user.id;
  const { reason } = req.body;

  try {
    const leaveResult = await pool.query(`
      SELECT lr.status, u.email, u.name
      FROM leave_req lr
      JOIN users u ON lr.user_id = u.id
      WHERE lr.id = $1
    `, [leaveId]);

    const leave = leaveResult.rows[0];
    if (!leave || leave.status !== "pending") {
      req.flash("err_msg", "Cannot reject this leave (not pending)");
      return res.redirect("/admin/leave");
    }

    const oldStatus = leave.status;

    // Update DB
    await pool.query(`
      UPDATE leave_req
      SET status='rejected', rejection_reason=$1, approved_by=$2, actioned_at=NOW()
      WHERE id=$3
    `, [reason, managerId, leaveId]);

    // Audit log
    await logAudit({
      action: "LEAVE_REJECTED",
      performedBy: managerId,
      targetTable: "leave_req",
      targetId: leaveId,
      oldStatus,
      newStatus: "rejected",
      message: reason
    });

    // Send email using your variable
    await sendEmail({
      to: leave.email,
      subject: "Leave Approved",
      html: `<p>Hi ${leave.name},</p><p>Your leave request has been <b>approved</b>.</p>`
    });

    req.flash("success_msg", "Leave rejected successfully");
    res.redirect("/admin/leave");

  } catch (err) {
    console.error("Email or DB failed:", err);
    logger.error(err.stack || err);
    req.flash("err_msg", "Failed to reject leave");
    res.redirect("/admin/leave");
  }
});

//  ADMIN USER MANAGEMENT 
app.get("/admin/users", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users ORDER BY id ASC");
    res.render("admin/users", { users: result.rows, success_msg: req.flash("success_msg"), err_msg: req.flash("err_msg") });
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to fetch users");
    res.redirect("/admin/dashboard");
  }
});

app.post("/admin/users/:id", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const userId = parseInt(req.params.id);
  try {
    const user = await pool.query("SELECT id, is_active FROM users WHERE id=$1", [userId]);
    if (!user.rows[0]) {
      req.flash("err_msg", "User not found");
      return res.redirect("/admin/users");
    }

    if (user.rows[0].id === req.user.id) {
      req.flash("err_msg", "You cannot deactivate yourself");
      return res.redirect("/admin/users");
    }

    const newStatus = !user.rows[0].is_active;

    // Update DB
    await pool.query("UPDATE users SET is_active=$1 WHERE id=$2", [newStatus, userId]);

    //  Log audit
    await logAudit({
      action: newStatus ? "USER_ACTIVATED" : "USER_DEACTIVATED",
      performedBy: req.user.id,
      targetTable: "users",
      targetId: userId,
      oldStatus: user.rows[0].is_active ? "active" : "inactive",
      newStatus: newStatus ? "active" : "inactive",
      message: newStatus ? "User activated" : "User deactivated"
    });

    req.flash("success_msg", newStatus ? "User activated successfully" : "User deactivated successfully");
    res.redirect("/admin/users");
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to update user status");
    res.redirect("/admin/users");
  }
});


app.post("/admin/users/role/:id", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const userId = parseInt(req.params.id);
  try {
    if (userId === req.user.id) {
      req.flash("err_msg", "You cannot change your own role");
      return res.redirect("/admin/users");
    }

    const result = await pool.query("SELECT id, role FROM users WHERE id=$1", [userId]);
    if (!result.rows[0]) {
      req.flash("err_msg", "User not found");
      return res.redirect("/admin/users");
    }

    const oldRole = result.rows[0].role;
    const newRole = oldRole === "admin" ? "employee" : "admin";

    // Update DB
    await pool.query("UPDATE users SET role=$1 WHERE id=$2", [newRole, userId]);

    //  Log audit
    await logAudit({
      action: "ROLE_CHANGED",
      performedBy: req.user.id,
      targetTable: "users",
      targetId: userId,
      oldStatus: oldRole,
      newStatus: newRole,
      message: `Role changed to ${newRole}`
    });

    req.flash("success_msg", `Role changed to ${newRole}`);
    res.redirect("/admin/users");
  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to change role");
    res.redirect("/admin/users");
  }
});


//  ADMIN AUDIT LOGS 
app.get("/admin/audit_logs", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
    try {
        
        const filterAction = req.query.action || "all";
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;

        let query = "SELECT al.*, u.name AS performed_by_name FROM audit_logs al LEFT JOIN users u ON al.performed_by = u.id";
        let params = [];
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

        query += " ORDER BY created_at DESC LIMIT $" + (params.length + 1) + " OFFSET $" + (params.length + 2);
        params.push(limit, offset);

        const result = await pool.query(query, params);

        res.render("admin/audit_logs", {
            logs: result.rows,
            filterAction,
            currentPage: page,
            totalPages
        });
    } catch (err) {
        logger.error(`Failed to fetch audit logs: ${err.stack || err}`);
        req.flash("err_msg", "Unable to fetch audit logs");
        res.redirect("/admin/dashboard");
    }
});
// GET edit user form
app.get("/admin/users/edit/:id", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const userId = parseInt(req.params.id);
  try {
    const result = await pool.query("SELECT id, name, email, role, is_active FROM users WHERE id=$1", [userId]);
    if (result.rows.length === 0) {
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
app.post("/admin/users/edit/:id", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const userId = parseInt(req.params.id);
  const { name, email, role } = req.body;
  try {
    // Prevent editing yourself if needed
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


