const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");
const { ensureAuthenticated, permitRoles } = require("../middleware/auth");
const { pool } = require("../dbconfig");
const { Parser } = require("json2csv");
const logger = require("../utils/logger");
const { logAudit } = require("../utils/logAudit");

router.get("/leave-list/export/csv", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
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
router.get("/leave/:leaveId/history/export/csv", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
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
router.get("/audit_logs/export/csv", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
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



// EMPLOYEE AUDIT LOGS 
router.get("/audit_logs", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
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
router.get("/leave/history/:id", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
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


router.get("/leave/cancel/:id", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
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

// ---------- EMPLOYEE DASHBOARD ----------
router.get("/dashboard", ensureAuthenticated,permitRoles("employee"), async (req, res) => {
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
router.get("/leave-apply", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
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
router.post("/leave-apply", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
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
router.get("/leave-list", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
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
router.get("/leave/edit/:id", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
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

router.post("/leave/edit/:id", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
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

module.exports = router;