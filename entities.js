// entities.js
// Real pattern-based entity extraction tuned for South African business documents.
// Every extractor returns { value, normalized, confidence } or null — never guesses
// a value that wasn't actually present in the text.

// --- Amounts (Rand) ---------------------------------------------------------
// Matches R18,000.00 / R18 450,00 / R18000 / ZAR 1 234.56 — common OCR variants
// including comma/period confusion, which is flagged rather than silently fixed.
const AMOUNT_PATTERN = /\b(?:R|ZAR)\s?([\d]{1,3}(?:[ ,]\d{3})*(?:[.,]\d{2})?)\b/gi;

function extractAmounts(text) {
  const matches = [];
  let m;
  while ((m = AMOUNT_PATTERN.exec(text)) !== null) {
    const raw = m[0];
    const numeric = m[1].replace(/\s/g, '');
    // Ambiguous separator (is "18,000" a thousands-comma or a decimal-comma?) —
    // only normalize when unambiguous (2 digits after final separator = decimal).
    const decimalLike = /[.,]\d{2}$/.test(numeric);
    let normalized = null;
    let confidence = 'MEDIUM';
    if (decimalLike) {
      normalized = numeric.replace(/,/g, (match, offset) =>
        offset === numeric.length - 3 ? '.' : ''
      ).replace(/[^\d.]/g, '');
      confidence = 'HIGH';
    } else if (/^\d+$/.test(numeric.replace(/,/g, ''))) {
      normalized = numeric.replace(/,/g, '');
      confidence = 'MEDIUM';
    } else {
      confidence = 'REVIEW REQUIRED';
    }
    matches.push({ raw, normalized, confidence });
  }
  return matches;
}

// --- Dates -------------------------------------------------------------------
// DD/MM/YYYY, DD/MM/YY, DD-MM-YYYY, DD Month YYYY. South African convention is
// day-first; century ambiguity on 2-digit years is explicitly flagged, never guessed.
const DATE_NUMERIC = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g;

function extractDates(text) {
  const results = [];
  let m;
  while ((m = DATE_NUMERIC.exec(text)) !== null) {
    const [raw, dStr, moStr, yStr] = m;
    const day = parseInt(dStr, 10);
    const month = parseInt(moStr, 10);
    let year = parseInt(yStr, 10);

    if (month > 12 || day > 31) {
      results.push({ raw, normalized: null, confidence: 'REVIEW REQUIRED', note: 'invalid day/month' });
      continue;
    }

    let confidence = 'HIGH';
    if (yStr.length === 2) {
      // Ambiguous century — do not silently assume 19xx vs 20xx.
      confidence = 'REVIEW REQUIRED';
      results.push({
        raw,
        normalized: null,
        confidence,
        note: `2-digit year "${yStr}" — century ambiguous, needs manual confirmation`,
      });
      continue;
    }

    const normalized = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    results.push({ raw, normalized, confidence });
  }
  return results;
}

// --- SA VAT number: 10 digits, starts with 4 -------------------------------
const VAT_PATTERN = /\bVAT\s*(?:NO|NUMBER|#)?\.?\s*:?\s*(4\d{9})\b/gi;

function extractVatNumbers(text) {
  const results = [];
  let m;
  while ((m = VAT_PATTERN.exec(text)) !== null) {
    results.push({ raw: m[0], normalized: m[1], confidence: 'HIGH' });
  }
  return results;
}

// --- Invoice / PO / reference numbers --------------------------------------
// Deliberately broad — real invoice numbering schemes vary wildly by supplier.
// This looks for a labeled alphanumeric token; confidence reflects how explicit the label was.
const REF_PATTERN = /\b(INVOICE|INV|PO|PURCHASE ORDER|QUOTE|QUOTATION|REF|REFERENCE)\s*(?:NO|NUMBER|#)?\.?\s*:?\s*([A-Z0-9][A-Z0-9\-\/]{2,20})\b/gi;

function extractReferenceNumbers(text) {
  const results = [];
  let m;
  while ((m = REF_PATTERN.exec(text)) !== null) {
    results.push({
      raw: m[0],
      label: m[1].toUpperCase(),
      normalized: m[2].toUpperCase(),
      confidence: 'HIGH',
    });
  }
  return results;
}

// --- SA phone numbers and email ---------------------------------------------
const PHONE_PATTERN = /\b(0\d{2}[\s\-]?\d{3}[\s\-]?\d{4}|\+27[\s\-]?\d{2}[\s\-]?\d{3}[\s\-]?\d{4})\b/g;
const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

function extractPhones(text) {
  return (text.match(PHONE_PATTERN) || []).map((raw) => ({ raw, normalized: raw.replace(/[\s\-]/g, ''), confidence: 'HIGH' }));
}

function extractEmails(text) {
  return (text.match(EMAIL_PATTERN) || []).map((raw) => ({ raw, normalized: raw.toLowerCase(), confidence: 'HIGH' }));
}

/**
 * Runs every extractor and returns a flat list ready for the `entities` table.
 * Fields that aren't found are simply absent — never filled with "Not detected"
 * placeholders at this layer (the UI layer renders absence as "Not detected").
 */
function extractAllEntities(text) {
  if (!text) return [];
  return [
    ...extractAmounts(text).map((e) => ({ entity_type: 'amount', ...e })),
    ...extractDates(text).map((e) => ({ entity_type: 'date', ...e })),
    ...extractVatNumbers(text).map((e) => ({ entity_type: 'vat_number', ...e })),
    ...extractReferenceNumbers(text).map((e) => ({ entity_type: 'reference_number', ...e })),
    ...extractPhones(text).map((e) => ({ entity_type: 'phone', ...e })),
    ...extractEmails(text).map((e) => ({ entity_type: 'email', ...e })),
  ];
}

module.exports = {
  extractAmounts,
  extractDates,
  extractVatNumbers,
  extractReferenceNumbers,
  extractPhones,
  extractEmails,
  extractAllEntities,
};
