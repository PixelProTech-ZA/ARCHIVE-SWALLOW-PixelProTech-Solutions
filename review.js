// review.js — review queue. Anything below HIGH confidence, or flagged as a
// possible duplicate, or with an ambiguous date, lands here and stays here
// until a human resolves it.
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./db');
const audit = require('./audit');

function addReviewItem(documentId, pageId, reason, confidence) {
  const db = getDb();
  db.prepare(
    `INSERT INTO review_items (id, document_id, page_id, reason, confidence, resolved, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(uuidv4(), documentId, pageId, reason, confidence, new Date().toISOString());
}

function summary() {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) AS count FROM review_items WHERE resolved = 0`).get();
  return { pending: row.count };
}

function items(reasonFilter = null, limit = 200) {
  const db = getDb();
  if (reasonFilter) {
    return db.prepare(
      `SELECT * FROM review_items WHERE resolved = 0 AND reason = ? ORDER BY created_at ASC LIMIT ?`
    ).all(reasonFilter, limit);
  }
  return db.prepare(
    `SELECT * FROM review_items WHERE resolved = 0 ORDER BY created_at ASC LIMIT ?`
  ).all(limit);
}

function resolve(id) {
  const db = getDb();
  db.prepare(`UPDATE review_items SET resolved = 1, resolved_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  audit.log('review.resolve', { id });
}

module.exports = { addReviewItem, summary, items, resolve };
