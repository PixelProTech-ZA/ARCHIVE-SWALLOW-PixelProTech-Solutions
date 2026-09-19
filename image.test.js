const sharp = require('sharp');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { preprocessForOcr, detectBlankPage, perceptualHash, hammingDistanceHex } = require('./imagePrep');

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pas-img-'));

  // Real synthetic "document" image: white background with black text-like bars
  const blankPath = path.join(tmpDir, 'blank.png');
  await sharp({ create: { width: 400, height: 500, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toFile(blankPath);

  const docPath = path.join(tmpDir, 'doc.png');
  const svgOverlay = Buffer.from(`<svg width="400" height="500">
    <rect width="400" height="500" fill="white"/>
    <rect x="30" y="40" width="300" height="20" fill="black"/>
    <rect x="30" y="80" width="200" height="15" fill="black"/>
    <rect x="30" y="110" width="250" height="15" fill="black"/>
  </svg>`);
  await sharp(svgOverlay).png().toFile(docPath);

  let failures = 0;
  const check = (name, cond) => { if (cond) console.log('PASS:', name); else { console.log('FAIL:', name); failures++; } };

  const blankResult = await detectBlankPage(blankPath);
  check('blank page correctly detected as blank', blankResult.isBlank === true);

  const docResult = await detectBlankPage(docPath);
  check('document-with-content NOT flagged blank', docResult.isBlank === false);

  const processedPath = path.join(tmpDir, 'processed.png');
  await preprocessForOcr(docPath, processedPath);
  check('processed file actually created', fs.existsSync(processedPath));
  check('original file untouched (still exists, unmodified path)', fs.existsSync(docPath));

  const hashA = await perceptualHash(docPath);
  const hashB = await perceptualHash(docPath); // same image
  const hashC = await perceptualHash(blankPath); // different image
  check('identical images produce identical hash', hashA === hashB);
  check('different images produce different hash', hashA !== hashC);
  check('hamming distance of identical hashes is 0', hammingDistanceHex(hashA, hashB) === 0);
  check('hamming distance of different hashes is > 0', hammingDistanceHex(hashA, hashC) > 0);

  console.log('\n' + (failures === 0 ? 'ALL IMAGE CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}
main();
