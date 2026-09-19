// exportData.js
// Real export to CSV (metadata/search results) and per-document text export.
// Every row carries its archive/box/document IDs so exports never lose traceability.

const fs = require('fs');

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function exportDocumentsToCsv(db, documentIds, outputPath) {
  const rows = [];
  const header = [
    'document_id', 'box_label', 'category', 'category_confidence',
    'page_count', 'created_at', 'entity_type', 'entity_value', 'entity_confidence',
  ];
  rows.push(header.join(','));

  const docStmt = db.prepare(`
    SELECT d.*, b.label as box_label FROM documents d JOIN boxes b ON b.id = d.box_id WHERE d.id = ?
  `);
  const entityStmt = db.prepare(`SELECT * FROM entities WHERE document_id = ?`);

  for (const id of documentIds) {
    const doc = docStmt.get(id);
    if (!doc) continue;
    const entities = entityStmt.all(id);
    if (entities.length === 0) {
      rows.push([doc.id, doc.box_label, doc.category, doc.category_confidence, doc.page_count, doc.created_at, '', '', '']
        .map(csvEscape).join(','));
    } else {
      for (const e of entities) {
        rows.push([doc.id, doc.box_label, doc.category, doc.category_confidence, doc.page_count, doc.created_at,
          e.entity_type, e.normalized_value || e.raw_value, e.confidence].map(csvEscape).join(','));
      }
    }
  }

  fs.writeFileSync(outputPath, rows.join('\n'), 'utf8');
  return outputPath;
}

function exportDocumentOcrText(db, documentId, outputPath) {
  const pages = db.prepare(`SELECT page_number, ocr_text, handwriting_text FROM pages WHERE document_id = ? ORDER BY page_number`).all(documentId);
  const text = pages
    .map((p) => `--- Page ${p.page_number} ---\n${p.ocr_text || ''}\n${p.handwriting_text ? '\n[Handwriting]\n' + p.handwriting_text : ''}`)
    .join('\n\n');
  fs.writeFileSync(outputPath, text, 'utf8');
  return outputPath;
}

module.exports = { exportDocumentsToCsv, exportDocumentOcrText };
