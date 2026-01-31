const express = require("express");
const router = express.Router();
const { pool } = require("../dbconfig"); // your Postgres connection
const { ensureAuthenticated, permitRoles } = require("../middleware/auth");

// Get all leaves for a specific employee
router.get("/leaves/:userId", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query("SELECT * FROM leaves WHERE user_id=$1 ORDER BY created_at DESC", [userId]);
    res.json({ success: true, leaves: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Submit a new leave request
router.post("/leaves", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  try {
    const { start_date, end_date, reason } = req.body;
    const userId = req.user.id;

    const result = await pool.query(
      "INSERT INTO leaves (user_id, start_date, end_date, reason, status, created_at) VALUES ($1,$2,$3,$4,'pending',NOW()) RETURNING *",
      [userId, start_date, end_date, reason]
    );

    res.json({ success: true, leave: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
