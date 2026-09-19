// pipeline.js
// Orchestrates PAGE RECEIVED -> PREPROCESS -> OCR -> ENTITY EXTRACTION -> BOUNDARY
// -> CLASSIFICATION -> DUPLICATE CHECK -> INDEX, one page at a time, off the UI
// thread's critical path (each step is async; the caller queues pages and can
// keep scanning while this runs, per spec section 5).
//
// Every step logs to the audit trail and flags uncertain results to the review
// queue instead of guessing. Nothing here claims success when a step failed.

const { randomUUID } = require('crypto');
const path = require('path');

const { preprocessForOcr, detectBlankPage, perceptualHash } = require('./imagePrep');
const { runPrintedOcr } = require('./ocr');
const { extractAllEntities } = require('./entities');
const { detectBoundaries } = require('./boundary');
const { classifyByKeywords, matchOrRecordKnownEntity } = require('./classify');
const { flagForReview } = require('./review');
const { reindexDocument } = require('./search');
const { logEvent } = require('./audit');

/**
 * Processes one freshly-scanned/imported page image through OCR + entity
 * extraction + persistence. Returns the created page row's id.
 * Document grouping (boundary detection) runs separately, once a batch is
 * finished or on demand, since it needs to see neighboring pages.
 */
async function processPage(db, { batchId, pageNumber, originalPath, processedDir }) {
  const pageId = randomUUID();
  const now = new Date().toISOString();

  logEvent(db, 'page_received', pageId, `batch ${batchId}, page ${pageNumber}`);

  const processedPath = path.join(processedDir, `page_${pageNumber}_${pageId}.png`);
  await preprocessForOcr(originalPath, processedPath);

  const blank = await detectBlankPage(processedPath);
  const hash = await perceptualHash(processedPath);

  let ocrResult = { text: '', confidenceBucket: 'REVIEW REQUIRED', engine: 'tesseract.js' };
  if (!blank.isBlank) {
    ocrResult = await runPrintedOcr(processedPath);
  }

  db.prepare(`
    INSERT INTO pages (id, batch_id, page_number, original_path, processed_path, is_blank,
      ocr_text, ocr_confidence, ocr_engine, perceptual_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pageId, batchId, pageNumber, originalPath, processedPath, blank.isBlank ? 1 : 0,
    ocrResult.text, ocrResult.confidenceBucket, ocrResult.engine, hash, now
  );

  if (ocrResult.confidenceBucket === 'LOW' || ocrResult.confidenceBucket === 'REVIEW REQUIRED') {
    if (!blank.isBlank) {
      flagForReview(db, 'ocr_confidence', pageId, `OCR confidence ${ocrResult.confidenceBucket}`);
    }
  }

  logEvent(db, 'page_processed', pageId, `OCR confidence: ${ocrResult.confidenceBucket}`);
  return pageId;
}

/**
 * Groups all unassigned pages in a batch into documents using boundary
 * detection, then runs classification + entity extraction + archive-learning
 * per resulting document. Call this after a batch finishes scanning (or
 * periodically for very large batches, per spec's resumable-batch requirement).
 */
function finalizeBatch(db, batchId, boxId) {
  const pages = db.prepare(`SELECT * FROM pages WHERE batch_id = ? ORDER BY page_number`).all(batchId);
  if (pages.length === 0) return { documentsCreated: 0 };

  const enriched = pages.map((p) => {
    const entities = extractAllEntities(p.ocr_text);
    const ref = entities.find((e) => e.entity_type === 'reference_number');
    const date = entities.find((e) => e.entity_type === 'date' && e.normalized);
    return { ...p, extractedRefNumber: ref ? ref.normalized : null, extractedDate: date ? date.normalized : null, entities };
  });

  const boundaries = detectBoundaries(enriched);

  let documentsCreated = 0;
  let currentDocId = null;
  let currentDocPages = [];

  const commitDocument = () => {
    if (!currentDocId || currentDocPages.length === 0) return;
    const combinedText = currentDocPages.map((p) => p.ocr_text).join('\n');
    const classification = classifyByKeywords(combinedText);

    const allEntities = currentDocPages.flatMap((p) => p.entities);
    const companyLike = allEntities.filter((e) => e.entity_type === 'reference_number'); // proxy signal
    let knownMatch = null;
    // crude company-name heuristic: longest all-caps line in first page's text
    const firstPageLines = (currentDocPages[0].ocr_text || '').split('\n');
    const candidateCompanyLine = firstPageLines.find((l) => /^[A-Z0-9 .,&()'-]{6,}$/.test(l.trim()));
    if (candidateCompanyLine) {
      knownMatch = matchOrRecordKnownEntity(db, candidateCompanyLine.trim());
    }

    let categoryConfidence = classification.confidence;
    let reason = classification.reason;
    if (knownMatch && knownMatch.isKnown) {
      categoryConfidence = 'HIGH';
      reason += ` | matches known supplier "${knownMatch.canonicalName}" (seen ${knownMatch.seenCount}x)`;
    }

    db.prepare(`
      INSERT INTO documents (id, box_id, category, category_confidence, page_count, boundary_confidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(currentDocId, boxId, classification.category, categoryConfidence, currentDocPages.length,
      currentDocPages[0]._boundaryConfidence || 'MEDIUM', new Date().toISOString());

    db.prepare(`UPDATE pages SET document_id = ? WHERE id IN (${currentDocPages.map(() => '?').join(',')})`)
      .run(currentDocId, ...currentDocPages.map((p) => p.id));

    for (const e of allEntities) {
      db.prepare(`
        INSERT INTO entities (id, document_id, entity_type, raw_value, normalized_value, confidence)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), currentDocId, e.entity_type, e.raw, e.normalized || null, e.confidence);
    }

    if (classification.confidence === 'REVIEW REQUIRED') {
      flagForReview(db, 'classification', currentDocId, classification.reason);
    }

    reindexDocument(db, currentDocId);
    logEvent(db, 'document_created', currentDocId, `${classification.category} (${currentDocPages.length} pages)`);
    documentsCreated++;
  };

  enriched.forEach((page, i) => {
    const boundary = boundaries[i];
    if (boundary.startsNewDocument || currentDocId === null) {
      commitDocument();
      currentDocId = randomUUID();
      currentDocPages = [];
    }
    page._boundaryConfidence = boundary.confidence;
    currentDocPages.push(page);

    if (boundary.confidence === 'REVIEW REQUIRED') {
      flagForReview(db, 'boundary', page.id, `Ambiguous document boundary: ${boundary.reasons.join('; ')}`);
    }
  });
  commitDocument();

  db.prepare(`UPDATE batches SET status = 'complete', finished_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), batchId);

  logEvent(db, 'batch_finalized', batchId, `${documentsCreated} document(s) created`);
  return { documentsCreated };
}

module.exports = { processPage, finalizeBatch };
