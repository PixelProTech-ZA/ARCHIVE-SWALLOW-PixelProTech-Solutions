// smoke-test.js — NOT part of the shipped app. Exercises the pure-Node modules
// (everything except main.js/scanner.js which need Electron/real hardware)
// end-to-end with real inputs to catch runtime bugs syntax-checking can't.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pas-smoke-'));
console.log('Working in', tmpDir);

const { openDatabase } = require('./db');
const { logEvent, getAuditTrail } = require('./audit');
const { extractAllEntities } = require('./entities');
const { detectBoundaries } = require('./boundary');
const { classifyByKeywords, matchOrRecordKnownEntity, signatureForName } = require('./classify');
const { compareDocuments, classifySimilarity } = require('./duplicates');
const { flagForReview, getOpenQueueSummary } = require('./review');
const { reindexDocument, search } = require('./search');
const { exportDocumentsToCsv } = require('./exportData');
const { generateBoxLabel } = require('./boxLabel');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS:', name);
  } catch (e) {
    failures++;
    console.log('FAIL:', name, '->', e.message);
  }
}

// --- DB ----------------------------------------------------------------
const db = openDatabase(tmpDir);
check('db: categories seeded', () => {
  const count = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
  if (count < 10) throw new Error('expected seeded categories, got ' + count);
});

// --- Audit ---------------------------------------------------------------
check('audit: log + retrieve', () => {
  logEvent(db, 'test_event', 'ref-1', 'smoke test');
  const trail = getAuditTrail(db, 'ref-1');
  if (trail.length !== 1) throw new Error('expected 1 audit row, got ' + trail.length);
});

// --- Entities --------------------------------------------------------------
check('entities: extracts amount/date/vat/ref/phone/email', () => {
  const text = `TAX INVOICE\nABC SUPPLIERS (PTY) LTD\nVAT NO: 4123456789\nInvoice Number: INV-10452\nDate: 14/06/2026\nTotal Due: R18,450.00\nTel: 012 345 6789\nEmail: accounts@abcsuppliers.co.za`;
  const entities = extractAllEntities(text);
  const types = new Set(entities.map((e) => e.entity_type));
  ['amount', 'date', 'vat_number', 'reference_number', 'phone', 'email'].forEach((t) => {
    if (!types.has(t)) throw new Error('missing entity type: ' + t);
  });
  const amount = entities.find((e) => e.entity_type === 'amount');
  if (amount.normalized !== '18450.00') throw new Error('amount normalization wrong: ' + amount.normalized);
  const date = entities.find((e) => e.entity_type === 'date');
  if (date.normalized !== '2026-06-14') throw new Error('date normalization wrong: ' + date.normalized);
});

check('entities: ambiguous 2-digit year flagged for review, not guessed', () => {
  const entities = extractAllEntities('Paid 14/06/07');
  const date = entities.find((e) => e.entity_type === 'date');
  if (date.normalized !== null || date.confidence !== 'REVIEW REQUIRED') {
    throw new Error('should not silently normalize 2-digit year');
  }
});

// --- Boundary detection ------------------------------------------------
check('boundary: sequential page-of-N pages stay one document', () => {
  const pages = [
    { ocr_text: 'INVOICE ABC SUPPLIERS page 1 of 2', is_blank: false, extractedRefNumber: 'INV-1', extractedDate: '2026-06-14' },
    { ocr_text: 'INVOICE ABC SUPPLIERS page 2 of 2', is_blank: false, extractedRefNumber: 'INV-1', extractedDate: '2026-06-14' },
  ];
  const results = detectBoundaries(pages);
  if (results[1].startsNewDocument) throw new Error('page 2 of 2 wrongly split into new document');
});

check('boundary: blank separator + different ref number starts new doc', () => {
  const pages = [
    { ocr_text: 'INVOICE ABC page 1 of 1', is_blank: false, extractedRefNumber: 'INV-1', extractedDate: '2026-06-14' },
    { ocr_text: '', is_blank: true, extractedRefNumber: null, extractedDate: null },
    { ocr_text: 'INVOICE XYZ page 1 of 1 completely different supplier content here', is_blank: false, extractedRefNumber: 'INV-2', extractedDate: '2026-07-01' },
  ];
  const results = detectBoundaries(pages);
  if (!results[2].startsNewDocument) throw new Error('should have started a new document after blank + ref change');
});

// --- Classification + archive learning ------------------------------------
check('classify: keyword rules pick Invoice', () => {
  const result = classifyByKeywords('TAX INVOICE\nAmount Due: R500.00');
  if (result.category !== 'Invoice') throw new Error('expected Invoice, got ' + result.category);
});

check('classify: unknown text is Unknown + REVIEW REQUIRED, not guessed', () => {
  const result = classifyByKeywords('asdf qwerty random text with no signal');
  if (result.category !== 'Unknown' || result.confidence !== 'REVIEW REQUIRED') {
    throw new Error('should not have guessed a category');
  }
});

check('classify: archive learning increments seen_count on repeat supplier', () => {
  const first = matchOrRecordKnownEntity(db, 'ABC SUPPLIERS (PTY) LTD');
  const second = matchOrRecordKnownEntity(db, 'ABC Suppliers Pty Ltd'); // different casing/punctuation
  if (!second.isKnown) throw new Error('normalized signature should have matched despite case/punctuation diff');
  if (second.seenCount !== 2) throw new Error('expected seen_count 2, got ' + second.seenCount);
});

// --- Duplicates ------------------------------------------------------------
check('duplicates: identical text + matching ref/amount scores High', () => {
  const docA = { ocrText: 'invoice abc suppliers total 18450', perceptualHash: 'ffffffffffffffff', refNumber: 'INV-1', amount: '18450.00' };
  const docB = { ocrText: 'invoice abc suppliers total 18450', perceptualHash: 'ffffffffffffffff', refNumber: 'INV-1', amount: '18450.00' };
  const { similarity } = compareDocuments(docA, docB);
  if (classifySimilarity(similarity) !== 'High') throw new Error('expected High similarity, got score ' + similarity);
});

check('duplicates: unrelated documents score Low', () => {
  const docA = { ocrText: 'invoice abc suppliers widgets and gears', perceptualHash: '0000000000000000', refNumber: 'INV-1', amount: '100.00' };
  const docB = { ocrText: 'delivery note xyz logistics completely unrelated cargo manifest', perceptualHash: 'ffffffffffffffff', refNumber: 'DN-99', amount: '9999.00' };
  const { similarity } = compareDocuments(docA, docB);
  if (classifySimilarity(similarity) !== 'Low') throw new Error('expected Low similarity, got score ' + similarity);
});

// --- Review queue ------------------------------------------------------
check('review: flag + summary counts', () => {
  flagForReview(db, 'classification', 'doc-1', 'test reason');
  const summary = getOpenQueueSummary(db);
  if (summary.total < 1) throw new Error('expected at least 1 open review item');
});

// --- Search (needs a real document + index) -------------------------------
check('search: indexed document is findable by supplier name and ref number', () => {
  const archiveId = randomUUID();
  db.prepare(`INSERT INTO archives (id, name, created_at) VALUES (?, ?, ?)`).run(archiveId, 'Test Archive', new Date().toISOString());
  const boxId = randomUUID();
  db.prepare(`INSERT INTO boxes (id, archive_id, label, created_at) VALUES (?, ?, ?, ?)`).run(boxId, archiveId, 'FIN-014', new Date().toISOString());
  const docId = randomUUID();
  db.prepare(`INSERT INTO documents (id, box_id, category, page_count, created_at) VALUES (?, ?, 'Invoice', 1, ?)`).run(docId, boxId, new Date().toISOString());
  const batchId = randomUUID();
  db.prepare(`INSERT INTO batches (id, box_id, started_at, status) VALUES (?, ?, ?, 'complete')`).run(batchId, boxId, new Date().toISOString());
  db.prepare(`INSERT INTO pages (id, batch_id, page_number, original_path, ocr_text, document_id, created_at) VALUES (?, ?, 1, ?, ?, ?, ?)`)
    .run(randomUUID(), batchId, '/fake/path.png', 'ABC SUPPLIERS INVOICE INV-10452 total R18,450.00', docId, new Date().toISOString());
  db.prepare(`INSERT INTO entities (id, document_id, entity_type, raw_value, normalized_value, confidence) VALUES (?, ?, 'reference_number', 'INV-10452', 'INV-10452', 'HIGH')`)
    .run(randomUUID(), docId);
  reindexDocument(db, docId);

  const bySupplier = search(db, 'ABC Suppliers');
  if (bySupplier.length !== 1) throw new Error('expected 1 result searching supplier name, got ' + bySupplier.length);

  const byRef = search(db, 'INV-10452');
  if (byRef.length !== 1) throw new Error('expected 1 result searching reference number, got ' + byRef.length);
});

// --- Export ----------------------------------------------------------------
check('export: CSV export produces a real file with expected columns', () => {
  const docId = db.prepare(`SELECT id FROM documents LIMIT 1`).get().id;
  const outPath = path.join(tmpDir, 'export-test.csv');
  exportDocumentsToCsv(db, [docId], outPath);
  const content = fs.readFileSync(outPath, 'utf8');
  if (!content.includes('document_id') || !content.includes('reference_number')) {
    throw new Error('CSV missing expected columns');
  }
});

// --- Box label PDF (async) -------------------------------------------------
async function runAsyncChecks() {
  try {
    const outPath = path.join(tmpDir, 'label-test.pdf');
    await generateBoxLabel({
      archiveName: 'Financial Records', boxLabel: 'FIN-014', yearRange: '2005-2008',
      digitalArchiveId: 'PX-FIN-014', documentCount: 327, processedDate: '2026-09-19', outputPath: outPath,
    });
    const stat = fs.statSync(outPath);
    if (stat.size < 500) throw new Error('PDF suspiciously small: ' + stat.size + ' bytes');
    console.log('PASS: boxLabel: generates a real non-trivial PDF file (' + stat.size + ' bytes)');
  } catch (e) {
    failures++;
    console.log('FAIL: boxLabel PDF generation ->', e.message);
  }

  console.log('\n' + (failures === 0 ? `ALL CHECKS PASSED` : `${failures} CHECK(S) FAILED`));
  process.exit(failures === 0 ? 0 : 1);
}

runAsyncChecks();
