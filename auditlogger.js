// auditlogger.js (CommonJS)
const { pool } = require("./dbconfig");

async function logAudit({ action, performedBy, targetTable, targetId, oldStatus, newStatus, message }) {
  const result = await pool.query(
    `
    INSERT INTO audit_logs
    (action, performed_by, target_table, target_id, old_status, new_status, message)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING id
    `,
    [action, performedBy, targetTable, targetId, oldStatus, newStatus, message]
  );
  return result.rows[0];
}

module.exports = logAudit;
