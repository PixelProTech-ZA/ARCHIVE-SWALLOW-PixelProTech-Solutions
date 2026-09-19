// review.js
// Central review queue. Anything with confidence LOW or REVIEW REQUIRED lands here.
// This is the efficiency target from the spec: humans inspect exceptions, not everything.

const { randomUUID } = require('crypto');

function flagForReview(db, itemType, referenceId, reason) {
  // Avoid duplicate open flags for the same item/type.
  const existing = db
    .prepare(`SELECT id FROM review_queue WHERE item_type = ? AND reference_id = ? AND status = 'open'`)
    .get(itemType, referenceId);
  if (existing) return existing.id;

  const id = randomUUID();
  db.prepare(
    `INSERT INTO review_queue (id, item_type, reference_id, reason, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)`
  ).run(id, itemType, referenceId, reason, new Date().toISOString());
  return id;
}

function resolveReview(db, reviewId) {
  db.prepare(`UPDATE review_queue SET status = 'resolved', resolved_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), reviewId);
}

function getOpenQueueSummary(db) {
  const rows = db
    .prepare(`SELECT item_type, COUNT(*) as count FROM review_queue WHERE status = 'open' GROUP BY item_type`)
    .all();
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return { total, byType: rows };
}

function getOpenQueueItems(db, itemType = null, limit = 100) {
  if (itemType) {
    return db
      .prepare(`SELECT * FROM review_queue WHERE status = 'open' AND item_type = ? ORDER BY created_at LIMIT ?`)
      .all(itemType, limit);
  }
  return db.prepare(`SELECT * FROM review_queue WHERE status = 'open' ORDER BY created_at LIMIT ?`).all(limit);
}

module.exports = { flagForReview, resolveReview, getOpenQueueSummary, getOpenQueueItems };
