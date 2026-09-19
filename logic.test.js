// logic.test.js — automated tests for pure logic + SQLite-backed modules.
// Run with: node logic.test.js  (after `npm rebuild better-sqlite3` for plain Node)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  - ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL  - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// --- entities.js ---
const entities = require('./entities');

check('extractAmounts parses R-prefixed currency', () => {
  const amounts = entities.extractAmounts('Total due: R 1 234.56 including VAT');
  assert.deepStrictEqual(amounts, [1234.56]);
});

check('extractVatNumber finds a 10-digit SA VAT number', () => {
  assert.strictEqual(entities.extractVatNumber('VAT NO: 4123456789'), '4123456789');
});

check('extractReference finds an invoice reference', () => {
  assert.strictEqual(entities.extractReference('Invoice: INV-2024-0091'), 'INV-2024-0091');
});

check('extractDates flags a 2-digit year as ambiguous, never guesses the century', () => {
  const dates = entities.extractDates('Dated 14/03/24');
  assert.strictEqual(dates.length, 1);
  assert.strictEqual(dates[0].ambiguous, true);
  assert.strictEqual(dates[0].year, null);
});

check('extractDates resolves a 4-digit year confidently', () => {
  const dates = entities.extractDates('Dated 14/03/2024');
  assert.strictEqual(dates[0].ambiguous, false);
  assert.strictEqual(dates[0].year, 2024);
});

// --- boundary.js ---
const boundary = require('./boundary');

check('boundary keeps sequential pages with the same reference together', () => {
  const pages = [
    { pageNumber: 1, ocrText: 'Invoice REF: ABC123 page one', isBlank: false },
    { pageNumber: 2, ocrText: 'continued REF: ABC123 details', isBlank: false }
  ];
  const docs = boundary.detectBoundaries(pages);
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].pages.length, 2);
});

check('boundary splits on a blank page', () => {
  const pages = [
    { pageNumber: 1, ocrText: 'Invoice REF: ABC123', isBlank: false },
    { pageNumber: 2, ocrText: '', isBlank: true },
    { pageNumber: 3, ocrText: 'Invoice REF: XYZ999', isBlank: false }
  ];
  const docs = boundary.detectBoundaries(pages);
  assert.strictEqual(docs.length, 2);
});

check('boundary splits when the reference number changes without a blank page', () => {
  const pages = [
    { pageNumber: 1, ocrText: 'REF: ABC123', isBlank: false },
    { pageNumber: 2, ocrText: 'REF: DEF456', isBlank: false }
  ];
  const docs = boundary.detectBoundaries(pages);
  assert.strictEqual(docs.length, 2);
});

// --- db-backed modules: classify, duplicates, search, export, review ---
const dbModule = require('./db');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-swallow-test-'));
const fakeApp = { getPath: () => tmpDir };
dbModule.initDb(fakeApp);
const db = dbModule.getDb();

const { v4: uuidv4 } = require('uuid');
const archiveId = uuidv4();
db.prepare('INSERT INTO archives (id, name, created_at) VALUES (?, ?, ?)').run(archiveId, 'Test Archive', new Date().toISOString());
const boxId = uuidv4();
db.prepare('INSERT INTO boxes (id, archive_id, label, created_at) VALUES (?, ?, ?, ?)').run(boxId, archiveId, 'BOX-1', new Date().toISOString());
const batchId = uuidv4();
db.prepare('INSERT INTO batches (id, box_id, status, started_at) VALUES (?, ?, ?, ?)').run(batchId, boxId, 'open', new Date().toISOString());

const classify = require('./classify');

check('classify falls back to REVIEW with no keyword match', () => {
  const result = classify.classify(archiveId, 'random unrelated text with nothing useful');
  assert.strictEqual(result.confidence, 'REVIEW');
});

check('classify matches INVOICE keywords at MEDIUM confidence', () => {
  const result = classify.classify(archiveId, 'TAX INVOICE — amount due R500. Bill to: Acme Ltd');
  assert.strictEqual(result.category, 'INVOICE');
  assert.strictEqual(result.confidence, 'MEDIUM');
});

check('classify learns a supplier signature and returns HIGH confidence next time', () => {
  classify.learnSignature(archiveId, 'Acme Ltd', 'INVOICE', ['acme ltd']);
  const result = classify.classify(archiveId, 'Statement from Acme Ltd for services rendered');
  assert.strictEqual(result.confidence, 'HIGH');
  assert.strictEqual(result.supplier, 'Acme Ltd');
});

const duplicates = require('./duplicates');

check('duplicates.findDuplicate finds an identical phash', () => {
  const docId1 = uuidv4();
  const phash = 'a1b2c3d4e5f60718';
  db.prepare(`
    INSERT INTO documents (id, batch_id, box_id, archive_id, confidence, phash, created_at)
    VALUES (?, ?, ?, ?, 'HIGH', ?, ?)
  `).run(docId1, batchId, boxId, archiveId, phash, new Date().toISOString());

  const dup = duplicates.findDuplicate(archiveId, phash, uuidv4());
  assert.ok(dup);
  assert.strictEqual(dup.documentId, docId1);
  assert.strictEqual(dup.distance, 0);
});

check('duplicates.findDuplicate returns null for a very different hash', () => {
  const dup = duplicates.findDuplicate(archiveId, 'ffffffffffffffff', uuidv4());
  assert.strictEqual(dup, null);
});

const search = require('./search');

check('search finds a document by indexed content', () => {
  const docId2 = uuidv4();
  db.prepare(`
    INSERT INTO documents (id, batch_id, box_id, archive_id, category, confidence, created_at)
    VALUES (?, ?, ?, ?, 'INVOICE', 'MEDIUM', ?)
  `).run(docId2, batchId, boxId, archiveId, new Date().toISOString());
  search.indexDocument(docId2, 'Supplier Widgets CC invoice for stationery order 445');

  const results = search.search('stationery');
  assert.ok(results.some((r) => r.id === docId2));
});

const review = require('./review');

check('review queue adds and resolves items', () => {
  const docId3 = uuidv4();
  db.prepare(`
    INSERT INTO documents (id, batch_id, box_id, archive_id, confidence, created_at)
    VALUES (?, ?, ?, ?, 'REVIEW', ?)
  `).run(docId3, batchId, boxId, archiveId, new Date().toISOString());

  review.addReviewItem(docId3, null, 'low_confidence', 'REVIEW');
  const before = review.summary().pending;
  assert.ok(before >= 1);

  const item = review.items('low_confidence')[0];
  review.resolve(item.id);
  const after = review.summary().pending;
  assert.strictEqual(after, before - 1);
});

const exportData = require('./exportData');

check('exportDocumentsCsv writes a CSV with a header and rows', () => {
  const outPath = path.join(tmpDir, 'export.csv');
  const result = exportData.exportDocumentsCsv({ archiveId }, outPath);
  const content = fs.readFileSync(outPath, 'utf8');
  assert.ok(content.startsWith('id,category,supplier'));
  assert.strictEqual(result.count, content.trim().split('\n').length - 1);
});

const audit = require('./audit');

check('audit.log writes an append-only entry', () => {
  audit.log('test.action', { foo: 'bar' });
  const recent = audit.recent(1);
  assert.strictEqual(recent[0].action, 'test.action');
});

console.log(`\n${passed} check(s) passed.`);
fs.rmSync(tmpDir, { recursive: true, force: true });
