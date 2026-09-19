// boxLabel.js
// Real printable box label as an actual PDF via pdf-lib. No QR/internet dependency
// unless explicitly enabled — per spec section 20, no cloud-dependent QR by default.

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');

async function generateBoxLabel({
  archiveName,
  boxLabel,
  yearRange,
  digitalArchiveId,
  documentCount,
  processedDate,
  outputPath,
}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([288, 432]); // 4x6 inch label at 72dpi
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let y = 400;
  const drawLine = (text, size, bold = false) => {
    page.drawText(text, { x: 20, y, size, font: bold ? font : regularFont, color: rgb(0, 0, 0) });
    y -= size + 10;
  };

  drawLine('PIXEL ARCHIVE SWALLOW', 12, true);
  y -= 10;
  drawLine('ARCHIVE', 9, true);
  drawLine(archiveName, 14);
  drawLine('BOX', 9, true);
  drawLine(boxLabel, 20, true);
  if (yearRange) {
    drawLine('YEARS', 9, true);
    drawLine(yearRange, 14);
  }
  drawLine('DIGITAL ARCHIVE ID', 9, true);
  drawLine(digitalArchiveId, 12);
  drawLine('DOCUMENTS', 9, true);
  drawLine(String(documentCount), 14);
  drawLine('PROCESSED', 9, true);
  drawLine(processedDate, 12);

  page.drawRectangle({
    x: 10, y: 10, width: 268, height: 412,
    borderColor: rgb(0, 0, 0), borderWidth: 1,
  });

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, pdfBytes);
  return outputPath;
}

module.exports = { generateBoxLabel };
