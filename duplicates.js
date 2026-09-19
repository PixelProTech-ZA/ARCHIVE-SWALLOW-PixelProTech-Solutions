// duplicates.js
// Duplicate detection combines multiple weak signals into one score.
// Per spec section 14: NEVER automatically delete duplicates. This module only
// ever produces a "possible duplicate" flag for the review queue.

const { hammingDistanceHex } = require('./imagePrep');
const { jaccardSimilarity, tokenize } = require('./boundary');

const HASH_BITS = 64;

function imageSimilarityScore(hashA, hashB) {
  const dist = hammingDistanceHex(hashA, hashB);
  return 1 - dist / HASH_BITS; // 1.0 = identical, 0.0 = maximally different
}

/**
 * Compares two documents (each: { ocrText, perceptualHash, refNumber, amount, date })
 * and returns { similarity: 0-1, signals: [...] } — a transparent breakdown, not
 * a single opaque number.
 */
function compareDocuments(docA, docB) {
  const signals = [];
  let weightedScore = 0;
  let totalWeight = 0;

  if (docA.perceptualHash && docB.perceptualHash) {
    const imgSim = imageSimilarityScore(docA.perceptualHash, docB.perceptualHash);
    signals.push({ signal: 'image_similarity', value: imgSim });
    weightedScore += imgSim * 2;
    totalWeight += 2;
  }

  const textSim = jaccardSimilarity(tokenize(docA.ocrText), tokenize(docB.ocrText));
  signals.push({ signal: 'text_similarity', value: textSim });
  weightedScore += textSim * 2;
  totalWeight += 2;

  if (docA.refNumber && docB.refNumber) {
    const match = docA.refNumber === docB.refNumber ? 1 : 0;
    signals.push({ signal: 'reference_number_match', value: match });
    weightedScore += match * 1.5;
    totalWeight += 1.5;
  }

  if (docA.amount && docB.amount) {
    const match = docA.amount === docB.amount ? 1 : 0;
    signals.push({ signal: 'amount_match', value: match });
    weightedScore += match * 1;
    totalWeight += 1;
  }

  const similarity = totalWeight > 0 ? weightedScore / totalWeight : 0;
  return { similarity, signals };
}

function classifySimilarity(similarity) {
  if (similarity >= 0.9) return 'High';
  if (similarity >= 0.7) return 'Medium';
  return 'Low';
}

module.exports = { compareDocuments, classifySimilarity, imageSimilarityScore };
