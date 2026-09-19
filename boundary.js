// boundary.js
//
// Real, deterministic heuristic for grouping consecutive pages into documents.
// This is NOT a trained ML model — it's transparent rule-based scoring, which
// is the right choice for v1 per the spec's own instruction to prefer
// deterministic code where deterministic code is better. It can be replaced
// or supplemented by a trained classifier later without changing the schema.
//
// Signals used, each contributing a score toward "this page starts a NEW document":
//   - blank separator page immediately before it
//   - detected invoice/PO/reference number differs from previous page's
//   - date differs from previous page's
//   - OCR text similarity to previous page is low (Jaccard on word sets)
//   - page number sequence resets or breaks (e.g. "Page 1 of 3" pattern)
//
// Output is a boundary decision PLUS a confidence bucket. Ambiguous cases are
// never silently resolved — they go to the review queue (see review.js).

function tokenize(text) {
  return new Set(
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const PAGE_OF_PATTERN = /page\s+(\d+)\s+of\s+(\d+)/i;

function detectPageOfMarker(text) {
  const m = (text || '').match(PAGE_OF_PATTERN);
  if (!m) return null;
  return { current: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

/**
 * pages: array of { ocr_text, is_blank, extractedRefNumber, extractedDate } in scan order.
 * Returns array of { startsNewDocument: bool, confidence: 'HIGH'|'MEDIUM'|'LOW'|'REVIEW REQUIRED', reasons: [] }
 * aligned to the input array (first page is always a new document, trivially).
 */
function detectBoundaries(pages) {
  const results = [];

  for (let i = 0; i < pages.length; i++) {
    if (i === 0) {
      results.push({ startsNewDocument: true, confidence: 'HIGH', reasons: ['first page in batch'] });
      continue;
    }

    const prev = pages[i - 1];
    const curr = pages[i];
    const reasons = [];
    let newDocScore = 0;
    let totalSignals = 0;

    if (prev.is_blank) {
      newDocScore += 1;
      reasons.push('preceding blank separator page');
    }
    totalSignals += 1;

    if (curr.extractedRefNumber && prev.extractedRefNumber && curr.extractedRefNumber !== prev.extractedRefNumber) {
      newDocScore += 1;
      reasons.push(`reference number changed (${prev.extractedRefNumber} -> ${curr.extractedRefNumber})`);
    }
    totalSignals += 1;

    if (curr.extractedDate && prev.extractedDate && curr.extractedDate !== prev.extractedDate) {
      newDocScore += 0.5; // weaker signal alone — dates can repeat across pages of one doc
      reasons.push(`date changed (${prev.extractedDate} -> ${curr.extractedDate})`);
    }
    totalSignals += 0.5;

    const sim = jaccardSimilarity(tokenize(prev.ocr_text), tokenize(curr.ocr_text));
    if (sim < 0.15) {
      newDocScore += 1;
      reasons.push(`low text similarity to previous page (${(sim * 100).toFixed(0)}%)`);
    }
    totalSignals += 1;

    const pageOfPrev = detectPageOfMarker(prev.ocr_text);
    const pageOfCurr = detectPageOfMarker(curr.ocr_text);
    if (pageOfPrev && pageOfCurr) {
      if (pageOfCurr.current === pageOfPrev.current + 1 && pageOfCurr.total === pageOfPrev.total) {
        newDocScore -= 1.5; // strong signal this is the SAME document continuing
        reasons.push(`sequential "page ${pageOfCurr.current} of ${pageOfCurr.total}" marker`);
      } else if (pageOfCurr.current === 1) {
        newDocScore += 1.5;
        reasons.push('explicit "page 1 of N" marker restarts');
      }
    }

    const ratio = totalSignals > 0 ? newDocScore / totalSignals : 0;
    let confidence;
    let startsNewDocument;
    if (ratio >= 0.7) {
      startsNewDocument = true;
      confidence = 'HIGH';
    } else if (ratio >= 0.45) {
      startsNewDocument = true;
      confidence = 'MEDIUM';
    } else if (ratio >= 0.25) {
      startsNewDocument = false;
      confidence = 'REVIEW REQUIRED'; // genuinely ambiguous zone
    } else {
      startsNewDocument = false;
      confidence = 'HIGH';
    }

    results.push({ startsNewDocument, confidence, reasons });
  }

  return results;
}

module.exports = { detectBoundaries, jaccardSimilarity, tokenize };
