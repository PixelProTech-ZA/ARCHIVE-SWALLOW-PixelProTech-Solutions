// classify.js
//
// Deterministic keyword-rule classifier (v1) — transparent, editable, no black box.
// Categories are stored in the `categories` table and are fully user-configurable
// (see spec section 10) — these keyword rules are the DEFAULT seed only.
//
// Archive learning (spec section 11): when a document's extracted supplier name
// matches a `known_entities` signature seen before, classification confidence
// rises and the reason is shown to the user — this is the differentiator, and
// it is built on real repeat-customer data, not marketing.

const { randomUUID } = require('crypto');

const DEFAULT_RULES = [
  { category: 'Invoice', keywords: ['invoice', 'tax invoice', 'amount due', 'total due'] },
  { category: 'Quotation', keywords: ['quotation', 'quote', 'valid for', 'estimate'] },
  { category: 'Purchase Order', keywords: ['purchase order', 'po number', 'order confirmation'] },
  { category: 'Delivery Note', keywords: ['delivery note', 'goods received', 'proof of delivery'] },
  { category: 'Supplier Statement', keywords: ['statement of account', 'account statement', 'opening balance'] },
  { category: 'Contract', keywords: ['agreement', 'contract', 'terms and conditions', 'signed by both parties'] },
  { category: 'Receipt', keywords: ['receipt', 'payment received', 'till slip'] },
  { category: 'Certificate', keywords: ['certificate', 'certified', 'compliance certificate'] },
  { category: 'Maintenance Record', keywords: ['service report', 'maintenance', 'repair completed'] },
  { category: 'Correspondence', keywords: ['dear sir', 'dear madam', 'yours faithfully', 'regards'] },
];

function scoreText(text, keywords) {
  const lower = (text || '').toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) hits++;
  }
  return hits;
}

/**
 * Classifies a document's combined OCR text against rule keywords.
 * Returns { category, confidence, reason } — falls back to 'Unknown' with
 * REVIEW REQUIRED rather than guessing when nothing scores.
 */
function classifyByKeywords(text, rules = DEFAULT_RULES) {
  let best = { category: 'Unknown', score: 0 };
  for (const rule of rules) {
    const score = scoreText(text, rule.keywords);
    if (score > best.score) best = { category: rule.category, score };
  }
  if (best.score === 0) {
    return { category: 'Unknown', confidence: 'REVIEW REQUIRED', reason: 'no keyword rule matched' };
  }
  const confidence = best.score >= 2 ? 'HIGH' : 'MEDIUM';
  return { category: best.category, confidence, reason: `matched ${best.score} keyword(s) for "${best.category}"` };
}

/**
 * Builds a normalized signature for a company name so minor OCR noise
 * ("ABC SUPPLIERS (PTY) LTD" vs "ABC SUPPLIERS PTY LTD") still matches.
 */
function signatureForName(name) {
  return name
    .toUpperCase()
    .replace(/\(PTY\)|\bPTY\b|\bLTD\b|\bCC\b|[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Archive learning: checks a candidate company name against previously seen
 * entities. Updates seen_count/last_seen on match. This is the feature that
 * gets more useful the longer the archive runs — real, not simulated.
 */
function matchOrRecordKnownEntity(db, candidateName) {
  if (!candidateName) return null;
  const sig = signatureForName(candidateName);
  if (sig.length < 3) return null;

  const existing = db.prepare(`SELECT * FROM known_entities WHERE signature = ?`).get(sig);
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(`UPDATE known_entities SET seen_count = seen_count + 1, last_seen_at = ? WHERE id = ?`)
      .run(now, existing.id);
    return {
      id: existing.id,
      canonicalName: existing.canonical_name,
      seenCount: existing.seen_count + 1,
      isKnown: true,
    };
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO known_entities (id, entity_type, canonical_name, signature, seen_count, last_seen_at) VALUES (?, 'company_name', ?, ?, 1, ?)`
  ).run(id, candidateName, sig, now);
  return { id, canonicalName: candidateName, seenCount: 1, isKnown: false };
}

module.exports = { DEFAULT_RULES, classifyByKeywords, signatureForName, matchOrRecordKnownEntity };
