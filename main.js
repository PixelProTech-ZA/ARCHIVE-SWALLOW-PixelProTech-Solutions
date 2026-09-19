// main.js — Electron main process.
// This process owns the database connection and all filesystem/scanner access.
// The renderer (UI) never touches the filesystem or DB directly — everything
// goes through ipcMain handlers below, so the DB and file layout stay consistent
// regardless of which screen the user is on.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const { openDatabase } = require('./db');
const scanner = require('./scanner');
const { processPage, finalizeBatch } = require('./pipeline');
const { search, reindexDocument } = require('./search');
const { getOpenQueueSummary, getOpenQueueItems, resolveReview } = require('./review');
const { generateBoxLabel } = require('./boxLabel');
const { exportDocumentsToCsv, exportDocumentOcrText } = require('./exportData');
const { logEvent, getAuditTrail } = require('./audit');

let db;
let mainWindow;
let watcherHandle = null;

function getUserDataPath() {
  return app.getPath('userData');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : process.platform === 'darwin' ? 'icon.icns' : 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  db = openDatabase(getUserDataPath());
  logEvent(db, 'app_started', null, `v${app.getVersion()}`);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (watcherHandle) watcherHandle.stop();
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// IPC: Dashboard
// ---------------------------------------------------------------------------
ipcMain.handle('dashboard:stats', () => {
  const documents = db.prepare(`SELECT COUNT(*) as c FROM documents`).get().c;
  const pages = db.prepare(`SELECT COUNT(*) as c FROM pages`).get().c;
  const boxes = db.prepare(`SELECT COUNT(*) as c FROM boxes`).get().c;
  const review = getOpenQueueSummary(db);
  const lastBatch = db.prepare(`SELECT finished_at FROM batches WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`).get();
  return { documents, pages, boxes, needsReview: review.total, lastSwallow: lastBatch ? lastBatch.finished_at : null };
});

// ---------------------------------------------------------------------------
// IPC: Archives / Boxes
// ---------------------------------------------------------------------------
ipcMain.handle('archive:create', (e, { name }) => {
  const id = randomUUID();
  db.prepare(`INSERT INTO archives (id, name, created_at) VALUES (?, ?, ?)`).run(id, name, new Date().toISOString());
  logEvent(db, 'archive_created', id, name);
  return { id, name };
});

ipcMain.handle('archive:list', () => db.prepare(`SELECT * FROM archives ORDER BY created_at DESC`).all());

ipcMain.handle('box:create', (e, { archiveId, label, yearRange, department }) => {
  const id = randomUUID();
  db.prepare(`INSERT INTO boxes (id, archive_id, label, year_range, department, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, archiveId, label, yearRange || null, department || null, new Date().toISOString());
  logEvent(db, 'box_created', id, label);
  return { id, label };
});

ipcMain.handle('box:list', (e, { archiveId }) => db.prepare(`SELECT * FROM boxes WHERE archive_id = ? ORDER BY created_at DESC`).all(archiveId));

// ---------------------------------------------------------------------------
// IPC: Scanner
// ---------------------------------------------------------------------------
ipcMain.handle('scanner:listDevices', async () => scanner.listDevices());

ipcMain.handle('scanner:startWatchFolder', (e, { boxId }) => {
  const importDir = path.join(getUserDataPath(), 'PixelArchive', 'Import', boxId);
  if (watcherHandle) watcherHandle.stop();
  const batchId = randomUUID();
  db.prepare(`INSERT INTO batches (id, box_id, started_at, status) VALUES (?, ?, ?, 'in_progress')`)
    .run(batchId, boxId, new Date().toISOString());

  let pageNumber = 0;
  const processedDir = path.join(getUserDataPath(), 'PixelArchive', 'Processed', batchId);

  watcherHandle = scanner.watchFolder(importDir, async (filePath) => {
    pageNumber++;
    try {
      await processPage(db, { batchId, pageNumber, originalPath: filePath, processedDir });
      mainWindow.webContents.send('scanner:pageProcessed', { pageNumber, status: 'ok' });
    } catch (err) {
      logEvent(db, 'page_failed', batchId, err.message);
      mainWindow.webContents.send('scanner:pageProcessed', { pageNumber, status: 'error', error: err.message });
    }
  });

  return { batchId, importDir };
});

ipcMain.handle('scanner:finalizeBatch', (e, { batchId, boxId }) => {
  if (watcherHandle) { watcherHandle.stop(); watcherHandle = null; }
  return finalizeBatch(db, batchId, boxId);
});

ipcMain.handle('scanner:scanReal', async (e, { boxId, deviceName, dpi, colorMode, duplex }) => {
  const importDir = path.join(getUserDataPath(), 'PixelArchive', 'Import', boxId);
  const filePath = await scanner.scanPage({ outputDir: importDir, deviceName, dpi, colorMode, duplex });
  return { filePath };
});

// ---------------------------------------------------------------------------
// IPC: Search / Review / Export / Audit
// ---------------------------------------------------------------------------
ipcMain.handle('search:query', (e, { query }) => search(db, query));

ipcMain.handle('review:summary', () => getOpenQueueSummary(db));
ipcMain.handle('review:items', (e, { itemType }) => getOpenQueueItems(db, itemType || null));
ipcMain.handle('review:resolve', (e, { reviewId }) => { resolveReview(db, reviewId); return { ok: true }; });

ipcMain.handle('export:csv', async (e, { documentIds }) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: 'pixel-archive-export.csv' });
  if (!filePath) return { cancelled: true };
  exportDocumentsToCsv(db, documentIds, filePath);
  logEvent(db, 'export_csv', null, `${documentIds.length} document(s) -> ${filePath}`);
  return { filePath };
});

ipcMain.handle('export:documentText', async (e, { documentId }) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: `${documentId}.txt` });
  if (!filePath) return { cancelled: true };
  exportDocumentOcrText(db, documentId, filePath);
  return { filePath };
});

ipcMain.handle('box:generateLabel', async (e, params) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: `${params.boxLabel}-label.pdf` });
  if (!filePath) return { cancelled: true };
  await generateBoxLabel({ ...params, outputPath: filePath });
  return { filePath };
});

ipcMain.handle('audit:trail', (e, { referenceId }) => getAuditTrail(db, referenceId || null));
