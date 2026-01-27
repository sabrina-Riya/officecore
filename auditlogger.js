const { pool } = require("./dbconfig");

async function logAudit({ action, performedBy, targetTable, targetId, oldStatus = null, newStatus = null, message = null }) {
  try {
    const result = await pool.query(
      `
      INSERT INTO audit_logs
      (action, performed_by, target_table, target_id, old_status, new_status, message, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      RETURNING id
      `,
      [action, performedBy, targetTable, targetId, oldStatus, newStatus, message]
    );
    return result.rows[0];
  } catch (err) {
    console.error("Failed to log audit:", err);
    return null;
  }
}

module.exports = logAudit;
