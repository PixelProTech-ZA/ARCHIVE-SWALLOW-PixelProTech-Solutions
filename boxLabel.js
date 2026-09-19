// boxLabel.js — generates a printable A6-ish box label PDF: box code, archive
// name, year range, and a barcode-style visual (text-based, no external
// barcode dependency) for quick shelf identification.
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');

async function generateBoxLabel({ archiveName, boxLabel, yearRange }, outPath) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([297, 210]); // A6 landscape, points-ish (compact label)
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  page.drawRectangle({ x: 0, y: 0, width: 297, height: 210, color: rgb(0.08, 0.09, 0.11) });

  page.drawText('PIXELPROTECH SOLUTIONS', {
    x: 16, y: 180, size: 9, font: fontRegular, color: rgb(0.6, 0.65, 0.7)
  });

  page.drawText(boxLabel, {
    x: 16, y: 130, size: 32, font, color: rgb(1, 1, 1)
  });

  page.drawText(archiveName, {
    x: 16, y: 95, size: 14, font: fontRegular, color: rgb(0.85, 0.85, 0.9)
  });

  if (yearRange) {
    page.drawText(yearRange, {
      x: 16, y: 70, size: 12, font: fontRegular, color: rgb(0.6, 0.65, 0.7)
    });
  }

  // Simple visual identifier bars (not a scannable barcode — a fast-glance shelf marker)
  const barSeed = [...boxLabel].reduce((a, c) => a + c.charCodeAt(0), 0);
  let x = 16;
  for (let i = 0; i < 24; i++) {
    const w = 2 + ((barSeed * (i + 1)) % 5);
    page.drawRectangle({ x, y: 20, width: w, height: 28, color: rgb(0.4, 0.5, 0.9) });
    x += w + 3;
  }

  const bytes = await doc.save();
  fs.writeFileSync(outPath, bytes);
  return outPath;
}

module.exports = { generateBoxLabel };
