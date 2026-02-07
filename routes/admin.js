const express = require("express");
const router = express.Router();
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");


const { pool } = require("../dbconfig");
const logger = require("../utils/logger");
const logAudit = require("../utils/logAudit");
const { ensureAuthenticated, redirectAuthenticated, permitRoles } = require("../middleware/auth");
const ensure2FAVerified = require("../middleware/ensure2FAVerified");
const require2FAEnabled = require("../middleware/require2FAEnabled");


const { Parser } = require("json2csv");



router.get("/users", ensureAuthenticated,permitRoles("admin"), async (req, res) => {
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
router.post("/users/:userId", ensureAuthenticated,permitRoles("admin"), async (req, res) => {
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
// POST change user role
router.post("/users/role/:userId", ensureAuthenticated, permitRoles("admin"),async (req, res) => {
  const userId = parseInt(req.params.userId);

  try {
    // Prevent admin from changing their own role
    if (userId === req.user.id) {
      req.flash("err_msg", "You cannot change your own role");
      return res.redirect("/admin/users");
    }

    // Fetch the user from DB
    const result = await pool.query("SELECT id, role FROM users WHERE id=$1", [userId]);
    const user = result.rows[0];

    if (!user) {
      req.flash("err_msg", "User not found");
      return res.redirect("/admin/users");
    }

    // Determine new role
    const newRole = user.role === "admin" ? "employee" : "admin";

    // Update role in DB
    await pool.query("UPDATE users SET role=$1 WHERE id=$2", [newRole, userId]);

    // Log after defining newRole
    logger.info(`User role changed: userId=${userId}, newRole=${newRole}, by adminId=${req.user.id}`);

    req.flash("success_msg", `Role changed to ${newRole}`);
    res.redirect("/admin/users");

  } catch (err) {
    logger.error(err.stack || err);
    req.flash("err_msg", "Unable to change role");
    res.redirect("/admin/users");
  }
});

// GET edit user form
router.get("/users/edit/:userId", ensureAuthenticated,  permitRoles("admin"), async (req, res) => {
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
router.post("/users/edit/:userId",ensureAuthenticated,permitRoles("admin"), async (req, res) => {
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

// ---------- ADMIN LEAVE MANAGEMENT ----------
router.get("/leave", ensureAuthenticated, permitRoles("admin"),async (req, res) => {
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


router.get("/audit_logs/export/csv", ensureAuthenticated,permitRoles("admin"), async (req, res) => {
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
router.post("/leave/reject/:leaveId", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
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
// ---------- APPROVE LEAVE ----------
router.post("/leave/approve/:leaveId", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
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
router.get("/audit_logs", ensureAuthenticated, permitRoles("admin"),async (req, res) => {
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
// ---------- ADMIN DASHBOARD ----------
router.get("/dashboard", ensureAuthenticated,permitRoles("admin"), async (req, res) => {
  
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
router.get("/leave/history/:leaveId", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
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
// ---------- VIEW SINGLE LEAVE DETAILS ----------
router.get("/leave/:leaveId", ensureAuthenticated, permitRoles("admin"),async (req, res) => {
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

module.exports = router;

