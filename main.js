// main.js — Electron main process. All filesystem, database, scanner, and
// OCR work happens here; the renderer only ever talks through the
// contextBridge exposed in preload.js. No network calls of any kind except
// the one-time Tesseract language-data download (see ocr.js).
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { initDb, getDb, getUserDataDir } = require('./db');
const audit = require('./audit');
const scanner = require('./scanner');
const pipeline = require('./pipeline');
const review = require('./review');
const search = require('./search');
const exportData = require('./exportData');
const boxLabel = require('./boxLabel');

let mainWindow = null;
const activeWatchers = new Map(); // batchId -> stop() function

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#14181d',
    icon: path.join(__dirname, 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  initDb(app);
  audit.log('app.start', { version: app.getVersion() });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Safety net: tesseract.js's worker can throw from inside its own internal
// event handling (e.g. a blocked/offline language-data download) in a way
// that bypasses the try/catch around `await pipeline.processPage(...)`
// below — confirmed by testing this exact failure path. Without this
// handler, that single OCR failure would crash the entire app instead of
// just failing one page. This is a backstop, not a substitute for fixing
// the underlying cause (bundle eng.traineddata for a fully offline build —
// see the top of ocr.js).
process.on('uncaughtException', (err) => {
  audit.log('process.uncaughtException', { message: String(err && err.message), stack: String(err && err.stack) });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('page:processed', {
      pageNumber: null,
      status: 'error',
      error: `Internal error (recovered): ${err && err.message}`
    });
  }
});
process.on('unhandledRejection', (reason) => {
  audit.log('process.unhandledRejection', { reason: String(reason) });
});

// ---------- Dashboard ----------
ipcMain.handle('dashboard:stats', () => {
  const db = getDb();
  const documents = db.prepare('SELECT COUNT(*) AS c FROM documents').get().c;
  const pages = db.prepare('SELECT COUNT(*) AS c FROM pages').get().c;
  const boxes = db.prepare('SELECT COUNT(*) AS c FROM boxes').get().c;
  const needsReview = db.prepare('SELECT COUNT(*) AS c FROM review_items WHERE resolved = 0').get().c;
  const last = db.prepare('SELECT finalized_at FROM batches WHERE finalized_at IS NOT NULL ORDER BY finalized_at DESC LIMIT 1').get();
  return { documents, pages, boxes, needsReview, lastSwallow: last ? last.finalized_at : null };
});

// ---------- Archives ----------
ipcMain.handle('archives:list', () => {
  const db = getDb();
  return db.prepare('SELECT * FROM archives ORDER BY name ASC').all();
});

ipcMain.handle('archives:create', (event, name) => {
  const db = getDb();
  const id = uuidv4();
  db.prepare('INSERT INTO archives (id, name, created_at) VALUES (?, ?, ?)').run(id, name, new Date().toISOString());
  audit.log('archive.create', { id, name });
  return { id, name };
});

// ---------- Boxes ----------
ipcMain.handle('boxes:list', (event, archiveId) => {
  const db = getDb();
  return db.prepare('SELECT * FROM boxes WHERE archive_id = ? ORDER BY created_at DESC').all(archiveId);
});

ipcMain.handle('boxes:create', (event, archiveId, label, yearRange) => {
  const db = getDb();
  const id = uuidv4();
  db.prepare('INSERT INTO boxes (id, archive_id, label, year_range, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, archiveId, label, yearRange || null, new Date().toISOString());
  audit.log('box.create', { id, archiveId, label });
  return { id, archiveId, label, yearRange };
});

// ---------- Scanner / batch ingestion ----------
ipcMain.handle('scanner:listDevices', async () => {
  return scanner.listScannerDevices();
});

ipcMain.handle('batch:start', (event, boxId, dpi, colorMode) => {
  const db = getDb();
  const batchId = uuidv4();
  db.prepare('INSERT INTO batches (id, box_id, dpi, color_mode, status, started_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(batchId, boxId, dpi || 300, colorMode || 'Color', 'open', new Date().toISOString());

  const userDataDir = getUserDataDir(app);
  const watchFolder = scanner.getWatchFolder(userDataDir, batchId);
  const processedDir = path.join(userDataDir, 'Processed', batchId);

  let pageNumber = 0;
  const stop = scanner.watchFolder(watchFolder, async (filePath) => {
    pageNumber += 1;
    try {
      const result = await pipeline.processPage({ batchId, filePath, pageNumber, processedDir });
      if (mainWindow) {
        mainWindow.webContents.send('page:processed', { pageNumber, status: result.confidence, error: null });
      }
    } catch (err) {
      if (mainWindow) {
        mainWindow.webContents.send('page:processed', { pageNumber, status: 'error', error: String(err.message || err) });
      }
    }
  });

  activeWatchers.set(batchId, stop);
  audit.log('batch.start', { batchId, boxId, watchFolder });
  return { batchId, watchFolder };
});

ipcMain.handle('batch:finalize', async (event, batchId, boxId) => {
  const db = getDb();
  const box = db.prepare('SELECT * FROM boxes WHERE id = ?').get(boxId);
  const stop = activeWatchers.get(batchId);
  if (stop) { stop(); activeWatchers.delete(batchId); }
  const result = await pipeline.finalizeBatch(batchId, boxId, box.archive_id);
  return result;
});

// ---------- Search ----------
ipcMain.handle('search:query', (event, query) => search.search(query));

// ---------- Review ----------
ipcMain.handle('review:summary', () => review.summary());
ipcMain.handle('review:items', (event, reasonFilter) => review.items(reasonFilter));
ipcMain.handle('review:resolve', (event, id) => { review.resolve(id); return { ok: true }; });

// ---------- Export ----------
ipcMain.handle('export:csv', async (event, archiveId, boxId) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export documents as CSV',
    defaultPath: 'archive-export.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (canceled || !filePath) return { canceled: true };
  const result = exportData.exportDocumentsCsv({ archiveId, boxId }, filePath);
  audit.log('export.csv', result);
  shell.showItemInFolder(filePath);
  return result;
});

// ---------- Box labels ----------
ipcMain.handle('boxlabel:generate', async (event, { archiveName, boxLabel: label, yearRange }) => {
  const userDataDir = getUserDataDir(app);
  const outDir = path.join(userDataDir, 'Labels');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${label.replace(/[^a-z0-9-]/gi, '_')}.pdf`);
  await boxLabel.generateBoxLabel({ archiveName, boxLabel: label, yearRange }, outPath);
  audit.log('boxlabel.generate', { outPath });
  shell.showItemInFolder(outPath);
  return { path: outPath };
});

// ---------- Manual import fallback (no scanner / no NAPS2) ----------
ipcMain.handle('batch:manualImport', async (event, batchId) => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select scanned pages to import',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images / PDF', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'pdf'] }]
  });
  if (canceled) return { imported: 0 };

  const userDataDir = getUserDataDir(app);
  const watchFolder = scanner.getWatchFolder(userDataDir, batchId);
  for (const src of filePaths) {
    const dest = path.join(watchFolder, path.basename(src));
    fs.copyFileSync(src, dest);
  }
  return { imported: filePaths.length };
});
