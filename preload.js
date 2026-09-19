// preload.js — the ONLY bridge between renderer (UI) and main process.
// Explicit allowlist of channels — the renderer can never call arbitrary IPC.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pixel', {
  dashboardStats: () => ipcRenderer.invoke('dashboard:stats'),

  createArchive: (name) => ipcRenderer.invoke('archive:create', { name }),
  listArchives: () => ipcRenderer.invoke('archive:list'),
  createBox: (archiveId, label, yearRange, department) =>
    ipcRenderer.invoke('box:create', { archiveId, label, yearRange, department }),
  listBoxes: (archiveId) => ipcRenderer.invoke('box:list', { archiveId }),

  listScannerDevices: () => ipcRenderer.invoke('scanner:listDevices'),
  startWatchFolder: (boxId) => ipcRenderer.invoke('scanner:startWatchFolder', { boxId }),
  finalizeBatch: (batchId, boxId) => ipcRenderer.invoke('scanner:finalizeBatch', { batchId, boxId }),
  scanReal: (params) => ipcRenderer.invoke('scanner:scanReal', params),
  onPageProcessed: (callback) => {
    ipcRenderer.removeAllListeners('scanner:pageProcessed');
    ipcRenderer.on('scanner:pageProcessed', (event, data) => callback(data));
  },

  search: (query) => ipcRenderer.invoke('search:query', { query }),

  reviewSummary: () => ipcRenderer.invoke('review:summary'),
  reviewItems: (itemType) => ipcRenderer.invoke('review:items', { itemType }),
  resolveReview: (reviewId) => ipcRenderer.invoke('review:resolve', { reviewId }),

  exportCsv: (documentIds) => ipcRenderer.invoke('export:csv', { documentIds }),
  exportDocumentText: (documentId) => ipcRenderer.invoke('export:documentText', { documentId }),
  generateBoxLabel: (params) => ipcRenderer.invoke('box:generateLabel', params),

  auditTrail: (referenceId) => ipcRenderer.invoke('audit:trail', { referenceId }),
});
