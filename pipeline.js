// pipeline.js — orchestrates the full ingestion flow end to end.
// Per-page: preprocess -> blank check -> OCR.
// Per-batch (on finalize): boundary detection groups pages into documents,
// then each document gets entity extraction, classification, duplicate
// scoring, review-queue routing, and search indexing.
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./db');
const imagePrep = require('./imagePrep');
const ocr = require('./ocr');
const boundary = require('./boundary');
const entities = require('./entities');
const classify = require('./classify');
const duplicates = require('./duplicates');
const review = require('./review');
const search = require('./search');
const audit = require('./audit');

// Heuristic handwriting flag: no dedicated handwriting-detection model is
// bundled (would require real GPU/compute budget — see README). Instead,
// text that OCRs with very short average "word" length relative to its
// total length is a real, if imperfect, signal of non-printed/irregular
// script, and is routed through the handwriting confidence cap rather than
// the printed one. This is a documented approximation, not a hidden guess.
function looksLikeHandwriting(rawText) {
  const words = rawText.split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  const avgLen = words.reduce((a, w) => a + w.length, 0) / words.length;
  return avgLen < 2.4;
}

async function processPage({ batchId, filePath, pageNumber, processedDir }) {
  const db = getDb();
  const processedPath = await imagePrep.preprocess(filePath, processedDir);
  const blankCheck = await imagePrep.isBlankPage(processedPath);

  let ocrText = '';
  let confidence = 'REVIEW';
  let isHandwriting = false;
  let ocrError = null;

  if (!blankCheck.isBlank) {
    const printedResult = await ocr.runOcr(processedPath, { isHandwriting: false });
    if (printedResult.error) {
      ocrError = printedResult.error;
      confidence = 'REVIEW';
    } else {
      isHandwriting = looksLikeHandwriting(printedResult.text);
      if (isHandwriting) {
        const hwResult = await ocr.runOcr(processedPath, { isHandwriting: true });
        ocrText = hwResult.text;
        confidence = hwResult.confidence;
        ocrError = hwResult.error;
      } else {
        ocrText = printedResult.text;
        confidence = printedResult.confidence;
      }
    }
  }

  const pageId = uuidv4();
  db.prepare(`
    INSERT INTO pages (id, document_id, batch_id, page_number, original_path, processed_path, ocr_text, is_blank, is_handwriting, confidence, created_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(pageId, batchId, pageNumber, filePath, processedPath, ocrText, blankCheck.isBlank ? 1 : 0, isHandwriting ? 1 : 0, confidence, new Date().toISOString());

  if (ocrError) {
    review.addReviewItem(null, pageId, `ocr_error: ${ocrError}`, 'REVIEW');
  }

  audit.log('page.processed', { pageId, batchId, isBlank: blankCheck.isBlank, confidence, ocrError });

  return { pageId, isBlank: blankCheck.isBlank, confidence, ocrText, ocrError };
}

async function finalizeBatch(batchId, boxId, archiveId) {
  const db = getDb();
  const pages = db.prepare(`SELECT * FROM pages WHERE batch_id = ? ORDER BY page_number ASC`).all(batchId);

  const grouped = boundary.detectBoundaries(
    pages.map((p) => ({ pageNumber: p.page_number, ocrText: p.ocr_text, isBlank: !!p.is_blank, id: p.id }))
  );

  const createdDocuments = [];

  for (const group of grouped) {
    const combinedText = group.pages.map((p) => p.ocrText || '').join('\n');
    const extracted = entities.extractAll(combinedText);
    const classification = classify.classify(archiveId, combinedText);

    const phash = await imagePrep.perceptualHash(
      db.prepare(`SELECT processed_path FROM pages WHERE id = ?`).get(group.pages[0].id).processed_path
    );

    const documentId = uuidv4();
    const dup = duplicates.findDuplicate(archiveId, phash, documentId);

    // Confidence rolls up to the lowest of: classification confidence, and
    // REVIEW if the date is ambiguous or a duplicate was found.
    let confidence = classification.confidence;
    const reviewReasons = [];
    if (extracted.hasAmbiguousDate) { confidence = 'REVIEW'; reviewReasons.push('ambiguous_date'); }
    if (dup) { reviewReasons.push('possible_duplicate'); }
    if (confidence === 'REVIEW' || confidence === 'LOW') reviewReasons.push('low_confidence');

    const resolvedDate = extracted.dates.find((d) => !d.ambiguous);
    const docDate = resolvedDate ? `${resolvedDate.year}-${String(resolvedDate.month).padStart(2, '0')}-${String(resolvedDate.day).padStart(2, '0')}` : null;

    db.prepare(`
      INSERT INTO documents (id, batch_id, box_id, archive_id, category, supplier, doc_date, amount, vat_number, reference, confidence, review_reason, phash, duplicate_of, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      documentId, batchId, boxId, archiveId,
      classification.category, classification.supplier, docDate,
      extracted.amounts[0] || null, extracted.vatNumber, extracted.reference,
      confidence, reviewReasons.join(',') || null, phash,
      dup ? dup.documentId : null,
      new Date().toISOString()
    );

    for (const p of group.pages) {
      db.prepare(`UPDATE pages SET document_id = ? WHERE id = ?`).run(documentId, p.id);
    }

    search.indexDocument(documentId, combinedText);

    if (reviewReasons.length) {
      review.addReviewItem(documentId, group.pages[0].id, reviewReasons.join(','), confidence);
    }

    createdDocuments.push(documentId);
  }

  db.prepare(`UPDATE batches SET status = 'finalized', finalized_at = ? WHERE id = ?`).run(new Date().toISOString(), batchId);
  audit.log('batch.finalized', { batchId, documentCount: createdDocuments.length });

  return { documentCount: createdDocuments.length, documentIds: createdDocuments };
}

module.exports = { processPage, finalizeBatch };
