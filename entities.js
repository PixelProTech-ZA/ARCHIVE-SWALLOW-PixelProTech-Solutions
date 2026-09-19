// entities.js — SA-tuned entity extraction. Rule: never guess an ambiguous
// 2-digit year. If a date's century is ambiguous, it is left unresolved and
// the page is routed to review rather than silently assuming 19xx/20xx.

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

function extractDates(text) {
  const results = [];

  // Numeric dates with 4-digit year: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
  const numeric4 = text.matchAll(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b|\b(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\b/g);
  for (const m of numeric4) {
    if (m[3]) results.push({ raw: m[0], day: +m[1], month: +m[2], year: +m[3], ambiguous: false });
    else results.push({ raw: m[0], day: +m[6], month: +m[5], year: +m[4], ambiguous: false });
  }

  // Numeric dates with 2-digit year — ambiguous century, flagged, not resolved.
  const numeric2 = text.matchAll(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})\b/g);
  for (const m of numeric2) {
    results.push({ raw: m[0], day: +m[1], month: +m[2], year: null, rawYear2: m[3], ambiguous: true });
  }

  // Written dates: "14 March 2024" / "March 14, 2024"
  const written = text.matchAll(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{4})\b/gi);
  for (const m of written) {
    results.push({ raw: m[0], day: +m[1], month: MONTHS[m[2].toLowerCase()], year: +m[3], ambiguous: false });
  }

  return results;
}

function extractVatNumber(text) {
  // SA VAT numbers are 10 digits, conventionally starting with 4.
  const m = text.match(/\bVAT\s*(?:NO|NUMBER|#)?\s*[:.]?\s*(4\d{9})\b/i) || text.match(/\b(4\d{9})\b/);
  return m ? m[1] : null;
}

function extractAmounts(text) {
  // R 1 234.56 / R1,234.56 / ZAR 1234.56
  const matches = [...text.matchAll(/\b(?:R|ZAR)\s?([\d\s,]+\.\d{2})\b/gi)];
  return matches.map((m) => parseFloat(m[1].replace(/[\s,]/g, '')));
}

function extractReference(text) {
  // The captured token must itself contain a digit (enforced via lookahead) —
  // otherwise a phrase like "Invoice Reference:" would match "Invoice" as the
  // keyword and wrongly capture the word "Reference" as the reference value.
  // Requiring a digit forces the regex to keep looking until it reaches the
  // actual code after the keyword(s).
  const m = text.match(/\b(?:invoice|inv|reference|ref|po|order)(?:\s+(?:number|no\.?|num|#))?[\s:#.\-]*((?=[a-z0-9\-\/]*\d)[a-z0-9][a-z0-9\-\/]{2,19})\b/i);
  return m ? m[1].toUpperCase() : null;
}

function extractPhone(text) {
  const m = text.match(/\b(0\d{2}[\s\-]?\d{3}[\s\-]?\d{4}|\+27[\s\-]?\d{2}[\s\-]?\d{3}[\s\-]?\d{4})\b/);
  return m ? m[1] : null;
}

function extractEmail(text) {
  const m = text.match(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/);
  return m ? m[0] : null;
}

function extractAll(text) {
  const dates = extractDates(text);
  const hasAmbiguousDate = dates.some((d) => d.ambiguous);
  return {
    dates,
    hasAmbiguousDate,
    vatNumber: extractVatNumber(text),
    amounts: extractAmounts(text),
    reference: extractReference(text),
    phone: extractPhone(text),
    email: extractEmail(text)
  };
}

module.exports = { extractDates, extractVatNumber, extractAmounts, extractReference, extractPhone, extractEmail, extractAll };
