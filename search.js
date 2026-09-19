// search.js — SQLite FTS5 full-text search over document content.
const { getDb } = require('./db');

function indexDocument(documentId, content) {
  const db = getDb();
  db.prepare(`DELETE FROM documents_fts WHERE document_id = ?`).run(documentId);
  db.prepare(`INSERT INTO documents_fts (document_id, content) VALUES (?, ?)`).run(documentId, content || '');
}

function search(query, limit = 50) {
  if (!query || !query.trim()) return [];
  const db = getDb();
  // Escape FTS5 special characters by quoting each token, then OR them for a forgiving search.
  const tokens = query.trim().split(/\s+/).map((t) => `"${t.replace(/"/g, '""')}"`);
  const matchExpr = tokens.join(' OR ');

  return db.prepare(`
    SELECT d.*, snippet(documents_fts, 1, '[', ']', '…', 12) AS snippet
    FROM documents_fts f
    JOIN documents d ON d.id = f.document_id
    WHERE documents_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(matchExpr, limit);
}

module.exports = { indexDocument, search };
