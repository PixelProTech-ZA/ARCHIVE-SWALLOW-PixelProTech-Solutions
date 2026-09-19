// image.test.js — tests imagePrep against real generated PNGs (not mocks).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const imagePrep = require('./imagePrep');

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  - ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL  - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-swallow-imgtest-'));

async function makeBlankPage(outPath) {
  await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .png()
    .toFile(outPath);
}

async function makeTextLikePage(outPath, seed) {
  // Synthetic "text" page: a grid of dark rectangles on white, varied by seed
  // so different seeds produce visually different (non-duplicate) pages.
  const rects = [];
  for (let i = 0; i < 40; i++) {
    const x = (i * 37 + seed * 13) % 560;
    const y = (i * 23 + seed * 7) % 760;
    rects.push(`<rect x="${x}" y="${y}" width="20" height="4" fill="black"/>`);
  }
  const svg = `<svg width="600" height="800" xmlns="http://www.w3.org/2000/svg">
    <rect width="600" height="800" fill="white"/>${rects.join('')}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outPath);
}

(async () => {
  const blankPath = path.join(tmpDir, 'blank.png');
  await makeBlankPage(blankPath);

  const textPathA = path.join(tmpDir, 'text-a.png');
  await makeTextLikePage(textPathA, 1);

  const textPathA2 = path.join(tmpDir, 'text-a-copy.png');
  await makeTextLikePage(textPathA2, 1); // identical seed -> should hash as a near-duplicate

  const textPathB = path.join(tmpDir, 'text-b.png');
  await makeTextLikePage(textPathB, 99); // different seed -> should hash as clearly different

  await check('isBlankPage identifies a genuinely blank page', async () => {
    const result = await imagePrep.isBlankPage(blankPath);
    assert.strictEqual(result.isBlank, true);
  });

  await check('isBlankPage does not flag a page with content as blank', async () => {
    const result = await imagePrep.isBlankPage(textPathA);
    assert.strictEqual(result.isBlank, false);
  });

  await check('preprocess writes a separate processed file, never touching the original', async () => {
    const originalBytesBefore = fs.readFileSync(textPathA);
    const processedDir = path.join(tmpDir, 'processed');
    const outPath = await imagePrep.preprocess(textPathA, processedDir);
    assert.ok(fs.existsSync(outPath));
    assert.notStrictEqual(outPath, textPathA);
    const originalBytesAfter = fs.readFileSync(textPathA);
    assert.deepStrictEqual(originalBytesBefore, originalBytesAfter);
  });

  await check('perceptualHash gives identical-content pages a very small hamming distance', async () => {
    const hashA = await imagePrep.perceptualHash(textPathA);
    const hashA2 = await imagePrep.perceptualHash(textPathA2);
    const dist = imagePrep.hammingDistanceHex(hashA, hashA2);
    assert.ok(dist <= 4, `expected near-duplicate distance <= 4, got ${dist}`);
  });

  await check('perceptualHash gives visually different pages a large hamming distance', async () => {
    const hashA = await imagePrep.perceptualHash(textPathA);
    const hashB = await imagePrep.perceptualHash(textPathB);
    const dist = imagePrep.hammingDistanceHex(hashA, hashB);
    assert.ok(dist > 8, `expected clearly-different distance > 8, got ${dist}`);
  });

  console.log(`\n${passed} check(s) passed.`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
})();
