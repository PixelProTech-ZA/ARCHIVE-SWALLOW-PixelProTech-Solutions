// audit.js — append-only audit trail. Never updated or deleted, only inserted.
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./db');

function log(action, details) {
  const db = getDb();
  db.prepare(`INSERT INTO audit_log (id, ts, action, details) VALUES (?, ?, ?, ?)`).run(
    uuidv4(),
    new Date().toISOString(),
    action,
    typeof details === 'string' ? details : JSON.stringify(details || {})
  );
}

function recent(limit = 100) {
  const db = getDb();
  return db.prepare(`SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?`).all(limit);
}

module.exports = { log, recent };
