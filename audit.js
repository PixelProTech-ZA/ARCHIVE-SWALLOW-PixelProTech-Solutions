// audit.js
// Append-only audit trail. Never update or delete rows here — that defeats the point.
const { randomUUID } = require('crypto');

function logEvent(db, event, referenceId, detail) {
  db.prepare(
    `INSERT INTO audit_log (id, event, reference_id, detail, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(randomUUID(), event, referenceId || null, detail || null, new Date().toISOString());
}

function getAuditTrail(db, referenceId, limit = 200) {
  if (referenceId) {
    return db.prepare(
      `SELECT * FROM audit_log WHERE reference_id = ? ORDER BY created_at DESC LIMIT ?`
    ).all(referenceId, limit);
  }
  return db.prepare(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?`).all(limit);
}

module.exports = { logEvent, getAuditTrail };
