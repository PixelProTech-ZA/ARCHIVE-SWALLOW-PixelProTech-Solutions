// preload.js — safe IPC bridge. The renderer never gets direct Node/Electron
// access; everything goes through this explicit, narrow surface.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pixel', {
  dashboardStats: () => ipcRenderer.invoke('dashboard:stats'),

  listArchives: () => ipcRenderer.invoke('archives:list'),
  createArchive: (name) => ipcRenderer.invoke('archives:create', name),

  listBoxes: (archiveId) => ipcRenderer.invoke('boxes:list', archiveId),
  createBox: (archiveId, label, yearRange) => ipcRenderer.invoke('boxes:create', archiveId, label, yearRange),

  listScannerDevices: () => ipcRenderer.invoke('scanner:listDevices'),
  startWatchFolder: (boxId, dpi, colorMode) => ipcRenderer.invoke('batch:start', boxId, dpi, colorMode),
  finalizeBatch: (batchId, boxId) => ipcRenderer.invoke('batch:finalize', batchId, boxId),
  manualImport: (batchId) => ipcRenderer.invoke('batch:manualImport', batchId),

  onPageProcessed: (callback) => {
    ipcRenderer.on('page:processed', (event, payload) => callback(payload));
  },

  search: (query) => ipcRenderer.invoke('search:query', query),

  reviewSummary: () => ipcRenderer.invoke('review:summary'),
  reviewItems: (reasonFilter) => ipcRenderer.invoke('review:items', reasonFilter),
  resolveReview: (id) => ipcRenderer.invoke('review:resolve', id),

  exportCsv: (archiveId, boxId) => ipcRenderer.invoke('export:csv', archiveId, boxId),
  generateBoxLabel: (payload) => ipcRenderer.invoke('boxlabel:generate', payload)
});
