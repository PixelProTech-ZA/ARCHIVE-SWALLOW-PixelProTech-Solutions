// db.js — SQLite schema + connection. Single local database, no cloud, no network.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function getUserDataDir(app) {
  const base = app ? app.getPath('userData') : path.join(require('os').homedir(), '.pixel-archive-swallow');
  const dataDir = path.join(base, 'PixelArchive');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

let db = null;

function initDb(app) {
  const dataDir = getUserDataDir(app);
  const dbPath = path.join(dataDir, 'archive.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS archives (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS boxes (
      id TEXT PRIMARY KEY,
      archive_id TEXT NOT NULL REFERENCES archives(id),
      label TEXT NOT NULL,
      year_range TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      box_id TEXT NOT NULL REFERENCES boxes(id),
      dpi INTEGER,
      color_mode TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      started_at TEXT NOT NULL,
      finalized_at TEXT
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES batches(id),
      box_id TEXT NOT NULL REFERENCES boxes(id),
      archive_id TEXT NOT NULL REFERENCES archives(id),
      category TEXT,
      supplier TEXT,
      doc_date TEXT,
      amount REAL,
      vat_number TEXT,
      reference TEXT,
      confidence TEXT NOT NULL DEFAULT 'REVIEW',
      review_reason TEXT,
      phash TEXT,
      duplicate_of TEXT REFERENCES documents(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      document_id TEXT REFERENCES documents(id),
      batch_id TEXT NOT NULL REFERENCES batches(id),
      page_number INTEGER NOT NULL,
      original_path TEXT NOT NULL,
      processed_path TEXT,
      ocr_text TEXT,
      is_blank INTEGER NOT NULL DEFAULT 0,
      is_handwriting INTEGER NOT NULL DEFAULT 0,
      confidence TEXT NOT NULL DEFAULT 'REVIEW',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_items (
      id TEXT PRIMARY KEY,
      document_id TEXT REFERENCES documents(id),
      page_id TEXT REFERENCES pages(id),
      reason TEXT NOT NULL,
      confidence TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS supplier_signatures (
      id TEXT PRIMARY KEY,
      archive_id TEXT NOT NULL REFERENCES archives(id),
      name TEXT NOT NULL,
      keywords TEXT NOT NULL,
      category TEXT NOT NULL,
      hits INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      document_id UNINDEXED,
      content
    );
  `);

  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized — call initDb(app) first.');
  return db;
}

module.exports = { initDb, getDb, getUserDataDir };
