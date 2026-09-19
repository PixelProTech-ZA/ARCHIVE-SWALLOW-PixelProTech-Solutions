// db.js
// Real local database layer. SQLite via better-sqlite3 (synchronous, fast, no server).
// This is the single source of structural truth for the archive.
// No document content ever leaves this file / this machine.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function openDatabase(userDataPath) {
  const dbDir = path.join(userDataPath, 'PixelArchive', 'Database');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'archive.db');
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL'); // survive crashes mid-batch without corrupting the DB
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS archives (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS boxes (
      id TEXT PRIMARY KEY,
      archive_id TEXT NOT NULL REFERENCES archives(id),
      label TEXT NOT NULL,           -- e.g. FIN-014
      year_range TEXT,
      department TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      box_id TEXT NOT NULL REFERENCES boxes(id),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | complete | failed | resumed
      scan_dpi INTEGER,
      color_mode TEXT,
      duplex INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES batches(id),
      page_number INTEGER NOT NULL,
      original_path TEXT NOT NULL,     -- untouched scan, evidence copy, never modified
      processed_path TEXT,             -- deskewed/thresholded copy used for OCR
      is_blank INTEGER DEFAULT 0,
      ocr_text TEXT,
      ocr_confidence TEXT,             -- HIGH | MEDIUM | LOW | REVIEW REQUIRED
      ocr_engine TEXT,
      has_handwriting INTEGER DEFAULT 0,
      handwriting_text TEXT,
      handwriting_confidence TEXT,
      perceptual_hash TEXT,            -- for duplicate detection
      document_id TEXT,                -- assigned once boundary detection groups pages
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      box_id TEXT NOT NULL REFERENCES boxes(id),
      category TEXT DEFAULT 'Unknown',
      category_confidence TEXT DEFAULT 'REVIEW REQUIRED',
      supplier_entity_id TEXT,
      page_count INTEGER DEFAULT 0,
      boundary_confidence TEXT DEFAULT 'REVIEW REQUIRED',
      is_duplicate_of TEXT,            -- document id, if marked duplicate
      duplicate_status TEXT,           -- null | 'possible' | 'confirmed' | 'kept_both'
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id),
      entity_type TEXT NOT NULL,   -- invoice_number | date | amount | vat_number | phone | email | company_name | po_number
      raw_value TEXT NOT NULL,     -- exactly what was read
      normalized_value TEXT,       -- cleaned form, only if confidently normalizable
      confidence TEXT NOT NULL     -- HIGH | MEDIUM | LOW | REVIEW REQUIRED
    );

    CREATE TABLE IF NOT EXISTS known_entities (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL DEFAULT 'company_name',
      canonical_name TEXT NOT NULL,
      signature TEXT NOT NULL,     -- normalized fingerprint used to match future documents
      seen_count INTEGER DEFAULT 1,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      parent_category TEXT,
      is_builtin INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS review_queue (
      id TEXT PRIMARY KEY,
      item_type TEXT NOT NULL,    -- handwriting | boundary | date | classification | duplicate
      reference_id TEXT NOT NULL, -- page_id or document_id
      reason TEXT,
      status TEXT DEFAULT 'open', -- open | resolved
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      reference_id TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    -- Full text search index over OCR + handwriting text + key entity values.
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      document_id UNINDEXED,
      content,
      tokenize = 'porter unicode61'
    );
  `);

  const defaultCategories = [
    'Invoice', 'Quotation', 'Purchase Order', 'Delivery Note', 'Supplier Statement',
    'Contract', 'Receipt', 'Employee/Admin', 'Equipment Record', 'Maintenance Record',
    'Certificate', 'Correspondence', 'Form', 'Report', 'Other', 'Unknown'
  ];
  const insertCat = db.prepare(
    `INSERT OR IGNORE INTO categories (id, name, is_builtin) VALUES (?, ?, 1)`
  );
  const { randomUUID } = require('crypto');
  const insertMany = db.transaction((cats) => {
    for (const c of cats) insertCat.run(randomUUID(), c);
  });
  insertMany(defaultCategories);

  return db;
}

module.exports = { openDatabase };
