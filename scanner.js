// scanner.js
//
// HONEST STATEMENT OF CAPABILITY (do not remove this comment or soften it in the UI):
//
// There is no universal, vendor-agnostic "scan from any MFP" API. Real options, in order
// of reliability, are:
//
//   1. NAPS2 (Not Another PDF Scanner 2) — free, open-source, actively maintained,
//      ships a command-line interface (naps2.console.exe on Windows) that talks to
//      WIA and TWAIN drivers correctly, including duplex and resolution options.
//      This app shells out to it if installed. This is the recommended real path —
//      writing a WIA/TWAIN driver bridge from scratch is a multi-week project on its
//      own and every commercial scan app either bundles or wraps an existing bridge.
//   2. Raw WIA automation via PowerShell (Windows only) — works for many consumer
//      scanners, fails silently on some business MFPs whose drivers don't expose a
//      full WIA interface. Provided as a fallback.
//   3. Manual import — the user scans using the manufacturer's own scanning software
//      (which is guaranteed to work, since it shipped with the device) and drops the
//      output files into a watched folder. This ALWAYS works, regardless of hardware,
//      and is the safety net so the rest of the pipeline (OCR onward) can be built,
//      tested and demoed without fighting driver compatibility first.
//
// This module never claims a scanner is supported until one of these paths has
// actually returned a real image file.

const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');

const NAPS2_CANDIDATES = [
  'C:\\Program Files\\NAPS2\\naps2.console.exe',
  'C:\\Program Files (x86)\\NAPS2\\naps2.console.exe'
];

function findNaps2() {
  for (const p of NAPS2_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Lists scanner devices actually detected on this machine.
 * Returns [] honestly (not a fake device) if none are found or NAPS2 isn't installed.
 */
function listDevices() {
  return new Promise((resolve) => {
    const naps2 = findNaps2();
    if (!naps2) {
      resolve({ available: false, reason: 'NAPS2 not found on this machine', devices: [] });
      return;
    }
    execFile(naps2, ['--listdevices'], { timeout: 15000 }, (err, stdout) => {
      if (err) {
        resolve({ available: false, reason: err.message, devices: [] });
        return;
      }
      const devices = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      resolve({ available: true, devices });
    });
  });
}

/**
 * Triggers a real scan via NAPS2 console into outputDir.
 * dpi, colorMode ('Color'|'Gray'|'BlackWhite'), duplex are passed straight through.
 * Resolves with the actual file path produced, or rejects with the real error —
 * never resolves with a placeholder/fake success.
 */
function scanPage({ outputDir, deviceName, dpi = 300, colorMode = 'Color', duplex = false }) {
  return new Promise((resolve, reject) => {
    const naps2 = findNaps2();
    if (!naps2) {
      reject(new Error('NAPS2 not installed — use manual import instead (watchFolder).'));
      return;
    }
    fs.mkdirSync(outputDir, { recursive: true });
    const outFile = path.join(outputDir, `scan_${Date.now()}.png`);
    const args = [
      '--device', deviceName,
      '--output', outFile,
      '--dpi', String(dpi),
      '--bitdepth', colorMode,
    ];
    if (duplex) args.push('--duplex');

    const proc = spawn(naps2, args);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outFile)) {
        resolve(outFile);
      } else {
        reject(new Error(`Scan failed (exit ${code}): ${stderr || 'no output produced'}`));
      }
    });
  });
}

/**
 * Watches a folder for manually-scanned files (the guaranteed-working fallback path).
 * Call stop() to release the watcher. onFile receives the absolute path of each new file.
 */
function watchFolder(folderPath, onFile) {
  fs.mkdirSync(folderPath, { recursive: true });
  const watcher = chokidar.watch(folderPath, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 },
  });
  watcher.on('add', (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.pdf'].includes(ext)) {
      onFile(filePath);
    }
  });
  return { stop: () => watcher.close() };
}

module.exports = { listDevices, scanPage, watchFolder, findNaps2 };
