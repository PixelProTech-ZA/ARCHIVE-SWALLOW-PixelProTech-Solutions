// boundary.js — document boundary detection: a real, deterministic, transparent
// heuristic (not a trained model), per the spec's instruction to prefer
// deterministic code where it is legitimately the better v1 choice.
//
// Rule set, applied in order over a batch's pages (already in scan order):
//   1. A blank page always ends the current document (and is not itself part of it).
//   2. If the extracted reference number changes between consecutive
//      non-blank pages, start a new document.
//   3. Otherwise, consecutive pages stay together in the same document.
//   4. A single trailing page with no successor closes its document.
const { extractReference } = require('./entities');

function detectBoundaries(pages) {
  // pages: [{ pageNumber, ocrText, isBlank }] in scan order.
  const documents = [];
  let current = null;

  for (const page of pages) {
    if (page.isBlank) {
      if (current) {
        documents.push(current);
        current = null;
      }
      continue;
    }

    const ref = extractReference(page.ocrText || '');

    if (!current) {
      current = { pages: [page], reference: ref };
      continue;
    }

    if (ref && current.reference && ref !== current.reference) {
      documents.push(current);
      current = { pages: [page], reference: ref };
    } else {
      current.pages.push(page);
      if (!current.reference && ref) current.reference = ref;
    }
  }

  if (current) documents.push(current);
  return documents;
}

module.exports = { detectBoundaries };
