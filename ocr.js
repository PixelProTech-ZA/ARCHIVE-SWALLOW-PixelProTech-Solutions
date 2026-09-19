// ocr.js
// Real OCR using Tesseract.js (runs 100% locally, no network calls once language
// data is downloaded once and cached — see setup note at bottom of file).

const Tesseract = require('tesseract.js');

const CONFIDENCE_HIGH = 85;
const CONFIDENCE_MEDIUM = 60;

function classifyConfidence(meanConfidence) {
  if (meanConfidence >= CONFIDENCE_HIGH) return 'HIGH';
  if (meanConfidence >= CONFIDENCE_MEDIUM) return 'MEDIUM';
  if (meanConfidence > 0) return 'LOW';
  return 'REVIEW REQUIRED';
}

/**
 * Runs printed-text OCR on a preprocessed page image.
 * Returns text, word-level confidence data, and an overall confidence bucket.
 * Never fabricates a confidence number — passes through Tesseract's own metric.
 */
async function runPrintedOcr(imagePath, { lang = 'eng' } = {}) {
  const result = await Tesseract.recognize(imagePath, lang, {
    logger: () => {}, // wire to a progress callback in the UI layer if desired
  });

  const meanConfidence = result.data.confidence; // 0-100, Tesseract's own estimate
  return {
    text: result.data.text.trim(),
    meanConfidence,
    confidenceBucket: classifyConfidence(meanConfidence),
    words: (result.data.words || []).map((w) => ({
      text: w.text,
      confidence: w.confidence,
      bbox: w.bbox,
    })),
    engine: 'tesseract.js',
  };
}

/**
 * HONEST LIMITATION: Tesseract's handwriting accuracy on real cursive/mixed
 * handwriting is materially worse than its printed-text accuracy — this is a
 * known, documented limitation of the engine, not a bug in this integration.
 * This function still runs OCR on regions flagged as likely handwriting (by
 * the caller, using layout heuristics — irregular line spacing, low printed-
 * text confidence, presence outside table/form structure), but forces the
 * result into LOW or REVIEW REQUIRED unless Tesseract's own confidence is
 * unusually high, because a false "HIGH" here would violate the core
 * principle: never let the system claim more certainty than it has.
 */
async function runHandwritingAttempt(imagePath) {
  const result = await Tesseract.recognize(imagePath, 'eng', { logger: () => {} });
  const raw = result.data.confidence;
  // Deliberately harsh re-bucketing for handwriting — see comment above.
  let bucket = 'REVIEW REQUIRED';
  if (raw >= 92) bucket = 'MEDIUM'; // handwriting essentially never earns HIGH here
  else if (raw >= 75) bucket = 'LOW';

  return {
    text: result.data.text.trim(),
    meanConfidence: raw,
    confidenceBucket: bucket,
    engine: 'tesseract.js (handwriting mode — low reliability, always review)',
  };
}

module.exports = { runPrintedOcr, runHandwritingAttempt, classifyConfidence };

/*
SETUP NOTE (put this in the app's first-run screen, not buried here):
Tesseract.js downloads language training data (~15MB for 'eng') on first use
and caches it locally. That first download needs network access ONCE, unless
you bundle the .traineddata file with the installer (recommended for a true
"zero cloud, works offline day one" claim — see README).
*/
