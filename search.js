// search.js
// Real full-text search via SQLite FTS5 — no external search service, fully local.

function indexDocument(db, documentId, contentParts) {
  const content = contentParts.filter(Boolean).join('\n');
  db.prepare(`DELETE FROM search_index WHERE document_id = ?`).run(documentId);
  db.prepare(`INSERT INTO search_index (document_id, content) VALUES (?, ?)`).run(documentId, content);
}

/**
 * Rebuilds the searchable content for a document from its pages + entities,
 * then indexes it. Call this whenever OCR/entities/classification change.
 */
function reindexDocument(db, documentId) {
  const pages = db.prepare(`SELECT ocr_text, handwriting_text FROM pages WHERE document_id = ?`).all(documentId);
  const entities = db.prepare(`SELECT raw_value, normalized_value FROM entities WHERE document_id = ?`).all(documentId);
  const doc = db.prepare(`SELECT category FROM documents WHERE id = ?`).get(documentId);

  const parts = [
    doc ? doc.category : '',
    ...pages.map((p) => p.ocr_text),
    ...pages.map((p) => p.handwriting_text),
    ...entities.map((e) => e.raw_value),
    ...entities.map((e) => e.normalized_value),
  ];
  indexDocument(db, documentId, parts);
}

/**
 * Natural-language-ish search: FTS5 handles multi-word queries, prefix matching
 * (append * to a term), and ranking via bm25 out of the box.
 */
function search(db, query, limit = 50) {
  // Sanitize: FTS5 query syntax has special characters (", -, etc.) — wrap plain
  // terms in quotes if the user's query isn't already valid FTS5 syntax attempt.
  let ftsQuery = query.trim();
  if (!/[":*()]/.test(ftsQuery)) {
    ftsQuery = ftsQuery
      .split(/\s+/)
      .map((t) => `"${t.replace(/"/g, '')}"*`)
      .join(' ');
  }

  const rows = db
    .prepare(
      `SELECT d.id as document_id, d.category, d.page_count, d.box_id, b.label as box_label,
              bm25(search_index) as rank, snippet(search_index, 1, '[', ']', '...', 12) as snippet
       FROM search_index si
       JOIN documents d ON d.id = si.document_id
       JOIN boxes b ON b.id = d.box_id
       WHERE search_index MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(ftsQuery, limit);

  return rows;
}

module.exports = { indexDocument, reindexDocument, search };
