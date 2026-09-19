// ocr.js — printed OCR + honestly-capped handwriting OCR.
// Tesseract.js is the only fully local, free OCR engine available. It is
// materially weaker on handwriting than on printed text, so handwriting
// results are forced into LOW/REVIEW confidence unless the engine itself
// reports unusually high confidence. This app does not claim certainty it
// doesn't have — see README "Honesty commitments".
//
// First run downloads eng.traineddata (~15MB) from the network once, then
// caches it locally. To ship a fully offline-from-first-launch build, bundle
// eng.traineddata alongside the app and point Tesseract at it with a local
// langPath instead of the default CDN path — see the commented block below.
const { createWorker } = require('tesseract.js');

let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng');
    // For a fully offline build, replace the line above with:
    // workerPromise = createWorker('eng', 1, { langPath: path.join(__dirname, 'tessdata') });
  }
  return workerPromise;
}

function confidenceBand(rawConfidence, isHandwriting) {
  // rawConfidence is Tesseract's 0-100 mean confidence.
  if (isHandwriting) {
    // Handwriting is capped: only ever HIGH if the engine is unusually sure.
    if (rawConfidence >= 92) return 'MEDIUM';
    return 'REVIEW';
  }
  if (rawConfidence >= 85) return 'HIGH';
  if (rawConfidence >= 65) return 'MEDIUM';
  if (rawConfidence >= 40) return 'LOW';
  return 'REVIEW';
}

const OCR_TIMEOUT_MS = 30000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runOcr(imagePath, { isHandwriting = false } = {}) {
  try {
    const worker = await withTimeout(getWorker(), OCR_TIMEOUT_MS, 'OCR worker init');
    const { data } = await withTimeout(worker.recognize(imagePath), OCR_TIMEOUT_MS, 'OCR recognize');
    const text = (data.text || '').trim();
    const confidence = confidenceBand(data.confidence || 0, isHandwriting);
    return { text, rawConfidence: data.confidence || 0, confidence, error: null };
  } catch (err) {
    // OCR failing or hanging (network hiccup fetching language data — confirmed
    // by testing that a failed fetch can leave the underlying promise neither
    // resolved nor rejected — corrupt image, etc.) must never lose the page or
    // stall the batch. It goes to review instead, with the real error kept for
    // whoever resolves it. On a timeout specifically, the stuck worker is
    // discarded so the next page gets a fresh one rather than retrying a dead
    // worker forever.
    if (String(err.message).includes('timed out')) {
      workerPromise = null;
    }
    return { text: '', rawConfidence: 0, confidence: 'REVIEW', error: String(err && err.message ? err.message : err) };
  }
}

async function terminate() {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

module.exports = { runOcr, confidenceBand, terminate };
