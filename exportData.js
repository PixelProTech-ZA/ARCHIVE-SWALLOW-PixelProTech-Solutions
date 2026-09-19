// exportData.js — CSV export of documents for an archive or box.
const fs = require('fs');
const { getDb } = require('./db');

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function exportDocumentsCsv({ archiveId, boxId }, outPath) {
  const db = getDb();
  let rows;
  if (boxId) {
    rows = db.prepare(`SELECT * FROM documents WHERE box_id = ? ORDER BY created_at ASC`).all(boxId);
  } else {
    rows = db.prepare(`SELECT * FROM documents WHERE archive_id = ? ORDER BY created_at ASC`).all(archiveId);
  }

  const headers = ['id', 'category', 'supplier', 'doc_date', 'amount', 'vat_number', 'reference', 'confidence', 'review_reason', 'created_at'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  return { path: outPath, count: rows.length };
}

module.exports = { exportDocumentsCsv };
