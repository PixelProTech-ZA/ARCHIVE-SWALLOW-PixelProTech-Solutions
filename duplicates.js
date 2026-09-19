// duplicates.js — duplicate scoring. Rule: duplicates are only ever flagged
// for human review, never automatically deleted or merged.
const { getDb } = require('./db');
const { hammingDistanceHex } = require('./imagePrep');

const MATCH_THRESHOLD = 8; // out of 64 bits — empirically a tight visual match

function findDuplicate(archiveId, phash, excludeDocumentId = null) {
  if (!phash) return null;
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, phash FROM documents WHERE archive_id = ? AND phash IS NOT NULL AND id != ?`
  ).all(archiveId, excludeDocumentId || '');

  let best = null;
  for (const row of rows) {
    const dist = hammingDistanceHex(phash, row.phash);
    if (dist <= MATCH_THRESHOLD && (!best || dist < best.distance)) {
      best = { documentId: row.id, distance: dist };
    }
  }
  return best;
}

module.exports = { findDuplicate, MATCH_THRESHOLD };
