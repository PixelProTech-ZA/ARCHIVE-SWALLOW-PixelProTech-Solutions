// imagePrep.js — preprocessing, blank-page detection, perceptual hash.
// Rule: the original scan file is never modified. A separate processed copy is written.
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const PHASH_SIZE = 8; // 8x8 = 64-bit hash

async function preprocess(originalPath, processedDir) {
  if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir, { recursive: true });
  const outName = `proc_${path.basename(originalPath, path.extname(originalPath))}.png`;
  const outPath = path.join(processedDir, outName);

  await sharp(originalPath)
    .rotate() // auto-orient from EXIF
    .grayscale()
    .normalize() // stretch contrast
    .sharpen()
    .png()
    .toFile(outPath);

  return outPath;
}

// Blank-page detection: downsample to a small grayscale buffer and measure
// variance. A near-uniform buffer (low variance, high mean brightness) is blank.
async function isBlankPage(imagePath) {
  const { data, info } = await sharp(imagePath)
    .resize(64, 64, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const mean = sum / data.length;

  let variance = 0;
  for (let i = 0; i < data.length; i++) variance += Math.pow(data[i] - mean, 2);
  variance = variance / data.length;

  const isBlank = mean > 235 && variance < 60;
  return { isBlank, mean, variance, width: info.width, height: info.height };
}

// Perceptual hash (dHash variant): resize to 9x8, compare adjacent pixels,
// produces a 64-bit hash robust to scan brightness/scale differences.
async function perceptualHash(imagePath) {
  const { data } = await sharp(imagePath)
    .resize(PHASH_SIZE + 1, PHASH_SIZE, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = '';
  for (let row = 0; row < PHASH_SIZE; row++) {
    for (let col = 0; col < PHASH_SIZE; col++) {
      const left = data[row * (PHASH_SIZE + 1) + col];
      const right = data[row * (PHASH_SIZE + 1) + col + 1];
      hash += left > right ? '1' : '0';
    }
  }
  // Store as hex for compactness
  return BigInt('0b' + hash).toString(16).padStart(16, '0');
}

function hammingDistanceHex(hexA, hexB) {
  const a = BigInt('0x' + hexA);
  const b = BigInt('0x' + hexB);
  let x = a ^ b;
  let dist = 0;
  while (x > 0n) {
    dist += Number(x & 1n);
    x >>= 1n;
  }
  return dist;
}

module.exports = { preprocess, isBlankPage, perceptualHash, hammingDistanceHex };
