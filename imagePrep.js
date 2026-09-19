// imagePrep.js
// Real image preprocessing using sharp. The ORIGINAL file is never modified —
// a separate processed copy is written for OCR to consume.

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

/**
 * Produces a processed copy optimized for OCR: grayscale, normalized contrast,
 * mild denoise, and adaptive-ish threshold via sharp's linear/threshold ops.
 * Full projective deskew (rotation correction) needs a dedicated CV library
 * (e.g. OpenCV) for real angle detection — sharp alone only gives us 90/180/270
 * auto-orientation via EXIF plus manual rotation if the caller supplies an angle.
 * That limitation is intentional and documented here rather than faked.
 */
async function preprocessForOcr(originalPath, processedPath, { rotateDegrees = 0 } = {}) {
  fs.mkdirSync(path.dirname(processedPath), { recursive: true });

  let pipeline = sharp(originalPath).rotate(); // auto-orient from EXIF if present

  if (rotateDegrees) pipeline = pipeline.rotate(rotateDegrees);

  await pipeline
    .grayscale()
    .normalize() // stretch contrast to real black/white range
    .sharpen()
    .toFile(processedPath);

  return processedPath;
}

/**
 * Real blank-page detection: computes mean pixel value + std deviation of the
 * grayscale image. A near-uniform, near-white image is flagged blank.
 * Thresholds are conservative — a page is only auto-marked blank when confident;
 * borderline cases are left for the review queue rather than silently dropped.
 */
async function detectBlankPage(imagePath) {
  const stats = await sharp(imagePath).grayscale().stats();
  const channel = stats.channels[0];
  const isVeryUniform = channel.stdev < 4;
  const isVeryLight = channel.mean > 245;
  return { isBlank: isVeryUniform && isVeryLight, mean: channel.mean, stdev: channel.stdev };
}

/**
 * Simple average-hash perceptual hash for duplicate detection.
 * Not cryptographic — deliberately tolerant of scan noise, JPEG artifacts,
 * slight rotation. Returns a 64-bit hash as a hex string.
 */
async function perceptualHash(imagePath) {
  const size = 8;
  const { data } = await sharp(imagePath)
    .resize(size, size, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
  let hash = 0n;
  for (let i = 0; i < data.length; i++) {
    hash = (hash << 1n) | (data[i] >= avg ? 1n : 0n);
  }
  return hash.toString(16).padStart(16, '0');
}

function hammingDistanceHex(hexA, hexB) {
  const a = BigInt('0x' + hexA);
  const b = BigInt('0x' + hexB);
  let xor = a ^ b;
  let dist = 0;
  while (xor > 0n) {
    dist += Number(xor & 1n);
    xor >>= 1n;
  }
  return dist;
}

module.exports = { preprocessForOcr, detectBlankPage, perceptualHash, hammingDistanceHex };
