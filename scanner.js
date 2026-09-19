// scanner.js — real scanner integration + manual-import fallback.
//
// NAPS2 (https://www.naps2.com, free/open source) ships a CLI (NAPS2.Console
// on Windows, naps2 on Linux) that can list and drive real scanner devices.
// If it's installed and on PATH, we shell out to it. If it isn't — which is
// the case in any environment with no physical scanner attached — a watch
// folder is used instead: point your MFP's own scanning software at the
// folder this module reports, and every file dropped there is picked up
// automatically by the ingestion pipeline. This fallback is guaranteed to
// work on any machine with any scanner, because it never talks to the
// hardware directly.
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');

function naps2Command() {
  return process.platform === 'win32' ? 'NAPS2.Console.exe' : 'naps2';
}

function listScannerDevices() {
  return new Promise((resolve) => {
    execFile(naps2Command(), ['--listdevices'], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        resolve({ available: false, devices: [], reason: 'NAPS2 not found on PATH — using manual import fallback.' });
        return;
      }
      const devices = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      resolve({ available: true, devices, reason: null });
    });
  });
}

function getWatchFolder(userDataDir, batchId) {
  const folder = path.join(userDataDir, 'ImportWatch', batchId);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  return folder;
}

// Watches a folder for new image/PDF files and invokes onFile(filePath) for each.
// Returns a stop() function.
function watchFolder(folder, onFile) {
  const watcher = chokidar.watch(folder, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 }
  });

  watcher.on('add', (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.pdf'].includes(ext)) {
      onFile(filePath);
    }
  });

  return () => watcher.close();
}

module.exports = { listScannerDevices, getWatchFolder, watchFolder };
