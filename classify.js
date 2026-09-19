// classify.js — keyword classifier + archive-learning. A document is only
// ever HIGH confidence if a learned supplier signature matches exactly;
// keyword-only matches are MEDIUM; no match is REVIEW.
const { getDb } = require('./db');

const DEFAULT_CATEGORIES = {
  INVOICE: ['invoice', 'tax invoice', 'amount due', 'bill to'],
  RECEIPT: ['receipt', 'thank you for your purchase', 'till slip'],
  STATEMENT: ['statement', 'account summary', 'opening balance', 'closing balance'],
  CONTRACT: ['agreement', 'contract', 'terms and conditions', 'signed by'],
  CORRESPONDENCE: ['dear sir', 'dear madam', 'yours faithfully', 'yours sincerely'],
  PAYSLIP: ['payslip', 'net pay', 'gross pay', 'uif']
};

function keywordScore(text) {
  const lower = text.toLowerCase();
  let best = { category: null, score: 0 };
  for (const [category, keywords] of Object.entries(DEFAULT_CATEGORIES)) {
    const score = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
    if (score > best.score) best = { category, score };
  }
  return best;
}

function findSupplierSignature(archiveId, text) {
  const db = getDb();
  const signatures = db.prepare(`SELECT * FROM supplier_signatures WHERE archive_id = ?`).all(archiveId);
  const lower = text.toLowerCase();
  for (const sig of signatures) {
    const keywords = JSON.parse(sig.keywords);
    const allMatch = keywords.every((kw) => lower.includes(kw.toLowerCase()));
    if (allMatch) return sig;
  }
  return null;
}

function classify(archiveId, text) {
  const learned = findSupplierSignature(archiveId, text);
  if (learned) {
    return { category: learned.category, supplier: learned.name, confidence: 'HIGH', source: 'learned' };
  }

  const kw = keywordScore(text);
  if (kw.category && kw.score >= 2) {
    return { category: kw.category, supplier: null, confidence: 'MEDIUM', source: 'keyword' };
  }
  if (kw.category && kw.score === 1) {
    return { category: kw.category, supplier: null, confidence: 'LOW', source: 'keyword' };
  }
  return { category: null, supplier: null, confidence: 'REVIEW', source: 'none' };
}

// Called when a human confirms/corrects a category+supplier during review —
// this is how the archive "learns" for next time.
function learnSignature(archiveId, supplierName, category, keywords) {
  const db = getDb();
  const { v4: uuidv4 } = require('uuid');
  const existing = db.prepare(
    `SELECT * FROM supplier_signatures WHERE archive_id = ? AND name = ?`
  ).get(archiveId, supplierName);

  if (existing) {
    db.prepare(`UPDATE supplier_signatures SET hits = hits + 1, category = ? WHERE id = ?`).run(category, existing.id);
  } else {
    db.prepare(
      `INSERT INTO supplier_signatures (id, archive_id, name, keywords, category, hits) VALUES (?, ?, ?, ?, ?, 1)`
    ).run(uuidv4(), archiveId, supplierName, JSON.stringify(keywords), category);
  }
}

module.exports = { classify, learnSignature, DEFAULT_CATEGORIES, keywordScore };
