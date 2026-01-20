// ====== app.js ======
require("dotenv").config(); // LOAD ENV VARIABLES FIRST

const express = require("express");
const app = express();
const { pool } = require("./dbconfig");
const bcrypt = require("bcrypt");
const session = require("express-session");
const flash = require("express-flash");
const passport = require("passport");
const initPass = require("./passport/passportconfig");
const { redirectAuthenticated, ensureAuthenticated, permitRoles } = require("./middleware/auth");

const port = process.env.PORT || 4000;

// ====== MIDDLEWARE ======
app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "devsecret",
    resave: false,
    saveUninitialized: false
  })
);
app.use(passport.initialize());
app.use(passport.session());
initPass(passport);
app.use(flash());

// ====== ROUTES ======

// --------- HOME ---------
app.get("/", (req, res) => res.render("index"));

// --------- AUTH ---------
app.get("/register", redirectAuthenticated, (req, res) => res.render("register", { error: [] }));
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
    req.flash("success_msg", "You are successfully registered");
    res.redirect("/login");
  } catch (err) {
    console.log(err.message);
    res.send(err.message);
  }
});

app.get("/login", redirectAuthenticated, (req, res) => res.render("login"));
app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/redirect_after_login",
    failureRedirect: "/login",
    failureFlash: true
  })
);

app.get("/redirect_after_login", ensureAuthenticated, (req, res) => {
  if (req.user.role === "admin") return res.redirect("/admin/dashboard");
  return res.redirect("/employee/dashboard");
});

app.get("/logout", (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    req.flash("success_msg", "You are successfully logged out");
    res.redirect("/login");
  });
});

// --------- EMPLOYEE DASHBOARD ---------
// EMPLOYEE DASHBOARD
// ====== EMPLOYEE DASHBOARD ======
app.get("/employee/dashboard", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  try {
    // Count leave stats for this employee
    const totalLeaves = await pool.query("SELECT COUNT(*) FROM leave_req WHERE user_id=$1", [req.user.id]);
    const approvedLeaves = await pool.query("SELECT COUNT(*) FROM leave_req WHERE user_id=$1 AND status='approved'", [req.user.id]);
    const rejectedLeaves = await pool.query("SELECT COUNT(*) FROM leave_req WHERE user_id=$1 AND status='rejected'", [req.user.id]);

    res.render("employee/dashboard", {
      username: req.user.name,        // ✅ send as 'username'
      totalleave: totalLeaves.rows[0].count,
      approvedLeave: approvedLeaves.rows[0].count,
      rejectedLeave: rejectedLeaves.rows[0].count,
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg")
    })
      

  } catch (err) {
    console.log(err.message);
    req.flash("err_msg", "Unable to load dashboard");
    res.redirect("/");
  }
});

// ====== EMPLOYEE LEAVE LIST ======
app.get("/employee/leave-list", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT lr.*, a.name AS actioned_by_name
       FROM leave_req lr
       LEFT JOIN users a ON lr.approved_by = a.id
       WHERE lr.user_id=$1
       ORDER BY lr.created_at DESC`,
      [req.user.id]
    );

    // Map DB rows to a format EJS can safely use
    const leaves = result.rows.map(row => ({
      id: row.id,
      start_date: row.start_date ? new Date(row.start_date) : null,
      end_date: row.end_date ? new Date(row.end_date) : null,
      reason: row.reason || "",
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
    console.log(err.message);
    req.flash("err_msg", "Unable to fetch leave list.");
    res.redirect("/employee/dashboard");
  }
});

app.get("/employee/leave/cancel/:id", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  try {
    const leaveId = req.params.id;
    await pool.query("DELETE FROM leave_req WHERE id=$1 AND user_id=$2 AND status='pending'", [leaveId, req.user.id]);
    req.flash("success_msg", "Leave cancelled successfully");
    res.redirect("/employee/dashboard");
  } catch (err) {
    console.log(err.message);
    req.flash("err_msg", "Cannot cancel leave");
    res.redirect("/employee/dashboard");
  }
});
app.post("/employee/leave-apply",
  ensureAuthenticated,
  permitRoles("employee"),
  async (req, res) => {
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
      // 🚫 limit to 20 leave requests
      const count = await pool.query(
        "SELECT COUNT(*) FROM leave_req WHERE user_id=$1",
        [req.user.id]
      );

      if (parseInt(count.rows[0].count) >= 20) {
        req.flash("err_msg", "Leave request limit (20) reached");
        return res.redirect("/employee/leave-apply");
      }

      await pool.query(
        `INSERT INTO leave_req (user_id, start_date, end_date, reason)
         VALUES ($1,$2,$3,$4)`,
        [req.user.id, sdate, edate, reason]
      );

      req.flash("success_msg", "Leave request submitted");
      res.redirect("/employee/leave-list");

    } catch (err) {
      console.log(err.message);
      req.flash("err_msg", "Failed to apply for leave");
      res.redirect("/employee/leave-apply");
    }
  }
);
app.get("/employee/leave-apply",
  ensureAuthenticated,
  permitRoles("employee"),
  (req, res) => {
    res.render("employee/leave-apply", {
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg")
    });
  }
);




app.get("/employee/leave/edit/:id", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  const leaveid = req.params.id;
  try {
    const result = await pool.query("SELECT * FROM leave_req WHERE id=$1 AND user_id=$2", [leaveid, req.user.id]);
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
    console.log(err.message);
    req.flash("err_msg", "Cannot edit the leave request");
    res.redirect("/employee/leave-list");
  }
});

app.post("/employee/leave/edit/:id", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  const leaveid = req.params.id;
  const { sdate, edate, reason } = req.body;
  let error = [];
  if (!sdate || !edate || !reason) error.push("All fields are required");
  if (new Date(sdate) > new Date(edate)) error.push("Start date cannot be after end date");

  if (error.length > 0) {
    return res.render("employee/edit-leave", {
      leave: { id: leaveid, start_date: sdate, end_date: edate, reason },
      err_msg: error,
      success_msg: []
    });
  }

  try {
    const result = await pool.query(
      "UPDATE leave_req SET start_date=$1, end_date=$2, reason=$3 WHERE id=$4 AND user_id=$5 AND status='pending' RETURNING *",
      [sdate, edate, reason, leaveid, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.render("employee/edit-leave", {
        leave: { id: leaveid, start_date: sdate, end_date: edate, reason },
        err_msg: ["Cannot edit leave (maybe not pending)"],
        success_msg: []
      });
    }

    res.render("employee/edit-leave", {
      leave: result.rows[0],
      err_msg: [],
      success_msg: ["Leave updated successfully"]
    });
  } catch (err) {
    console.log(err.message);
    req.flash("err_msg", "Unable to update leave");
    res.redirect("/employee/leave-list");
  }
});

// --------- ADMIN DASHBOARD ---------
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
      pendingRequest: newRequest.rows
    });
  } catch (err) {
    console.log(err.message);
    req.flash("err_msg", "Unable to load dashboard");
    res.redirect("/");
  }
});

// --------- ADMIN LEAVE MANAGEMENT ---------
app.get("/admin/leave", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const status = req.query.status || "all";
  try {
    let result;
    if (status === "pending") {
      result = await pool.query(
        `SELECT lr.*, a.name AS actioned_by, u.name AS employee_name
         FROM leave_req lr
         INNER JOIN users u ON lr.user_id = u.id
         LEFT JOIN users a ON lr.approved_by = a.id
         WHERE lr.status='pending'
         ORDER BY lr.created_at DESC`
      );
    } else if (status === "approved") {
      result = await pool.query(
        `SELECT lr.*, a.name AS actioned_by, u.name AS employee_name
         FROM leave_req lr
         INNER JOIN users u ON lr.user_id = u.id
         LEFT JOIN users a ON lr.approved_by = a.id
         WHERE lr.status='approved'
         ORDER BY lr.created_at DESC`
      );
    } else if (status === "rejected") {
      result = await pool.query(
        `SELECT lr.*, a.name AS actioned_by, u.name AS employee_name
         FROM leave_req lr
         INNER JOIN users u ON lr.user_id = u.id
         LEFT JOIN users a ON lr.approved_by = a.id
         WHERE lr.status='rejected'
         ORDER BY lr.created_at DESC`
      );
    } else {
      result = await pool.query(
        `SELECT lr.*, a.name AS actioned_by, u.name AS employee_name
         FROM leave_req lr
         INNER JOIN users u ON lr.user_id = u.id
         LEFT JOIN users a ON lr.approved_by = a.id
         ORDER BY lr.created_at DESC`
      );
    }

    // ✅ Pass flash messages!
    res.render("admin/leave", {
      leaves: result.rows,
      filter: status,
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg")
    });
  } catch (err) {
    console.log(err.message);
    req.flash("err_msg", "Unable to fetch leave requests");
    res.redirect("/admin/dashboard");
  }
});

app.post("/admin/leave/approve/:id", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const leaveId = req.params.id;

  try {
    const check = await pool.query("SELECT status FROM leave_req WHERE id=$1", [leaveId]);
    if (!check.rows.length || check.rows[0].status !== "pending") {
      req.flash("err_msg", "Cannot approve this leave (not pending)");
      return res.redirect("/admin/leave");
    }

    await pool.query(
      "UPDATE leave_req SET status='approved', approved_by=$1, actioned_at=NOW() WHERE id=$2",
      [req.user.id, leaveId]
    );

    req.flash("success_msg", "Leave approved successfully");
    res.redirect("/admin/leave");
  } catch (err) {
    console.log(err.message);
    req.flash("err_msg", "Failed to approve leave");
    res.redirect("/admin/leave");
  }
});


app.post("/admin/leave/reject/:id", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const leaveId = req.params.id;
  const { reason } = req.body;  // <--- must match input name in form

  try {
    const check = await pool.query("SELECT status FROM leave_req WHERE id=$1", [leaveId]);
    if (!check.rows.length || check.rows[0].status !== "pending") {
      req.flash("err_msg", "Cannot reject this leave (not pending)");
      return res.redirect("/admin/leave");
    }

    await pool.query(
      "UPDATE leave_req SET status='rejected', rejection_reason=$1, approved_by=$2, actioned_at=NOW() WHERE id=$3",
      [reason, req.user.id, leaveId]
    );

    req.flash("success_msg", "Leave rejected successfully");
    res.redirect("/admin/leave");
  } catch (err) {
    console.log(err.message);
    req.flash("err_msg", "Failed to reject leave");
    res.redirect("/admin/leave");
  }
});


// --------- ADMIN USER MANAGEMENT ---------
app.get("/admin/users", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users ORDER BY id ASC");
    res.render("admin/users", {
      users: result.rows,
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg")
    });
  } catch (err) {
    console.log(err.message);
    req.flash("err_msg", "Unable to fetch users");
    res.redirect("/admin/dashboard");
  }
});

app.post("/admin/users/:id", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const userid = parseInt(req.params.id);
  try {
    const user = await pool.query("SELECT id, is_active FROM users WHERE id=$1", [userid]);
    if (user.rows.length === 0) {
      req.flash("err_msg", "User not found");
      return res.redirect("/admin/users");
    }

    if (user.rows[0].id === req.user.id) {
      req.flash("err_msg", "You cannot deactivate yourself");
      return res.redirect("/admin/users");
    }

    const newStatus = !user.rows[0].is_active;
    await pool.query("UPDATE users SET is_active=$1 WHERE id=$2", [newStatus, userid]);
    req.flash("success_msg", newStatus ? "User activated successfully" : "User deactivated successfully");
    res.redirect("/admin/users");
  } catch (err) {
    console.log(err.message);
    req.flash("err_msg", "Unable to update user status");
    res.redirect("/admin/users");
  }
});

app.post("/admin/users/role/:id", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const userid = parseInt(req.params.id);
  try {
    if (userid === req.user.id) {
      req.flash("err_msg", "You cannot change your own role");
      return res.redirect("/admin/users");
    }
    const result = await pool.query("SELECT id, role FROM users WHERE id=$1", [userid]);
    if (result.rows.length === 0) {
      req.flash("err_msg", "User not found");
      return res.redirect("/admin/users");
    }

    const newRole = result.rows[0].role === "admin" ? "employee" : "admin";
    await pool.query("UPDATE users SET role=$1 WHERE id=$2", [newRole, userid]);
    req.flash("success_msg", `Role changed to ${newRole}`);
    res.redirect("/admin/users");
  } catch (err) {
    console.log(err.message);
    req.flash("err_msg", "Unable to change role");
    res.redirect("/admin/users");
  }
});

// ====== START SERVER ======
app.listen(port, () => console.log(`Server running on port ${port}`));
