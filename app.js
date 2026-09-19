// app.js — renderer logic. Everything here calls window.pixel, the narrow
// bridge exposed by preload.js. No fs/child_process access exists here.

let currentBatchId = null;
let currentBoxId = null;
let currentArchiveId = null;

// ---------- Navigation ----------
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
    if (btn.dataset.view === 'archive') refreshArchiveList();
    if (btn.dataset.view === 'review') refreshReview();
    if (btn.dataset.view === 'boxes') refreshBoxArchiveSelect();
  });
});

// ---------- Dashboard ----------
async function refreshDashboard() {
  const stats = await window.pixel.dashboardStats();
  document.getElementById('stat-documents').textContent = stats.documents;
  document.getElementById('stat-pages').textContent = stats.pages;
  document.getElementById('stat-boxes').textContent = stats.boxes;
  document.getElementById('stat-review').textContent = stats.needsReview;
  document.getElementById('stat-last').textContent = stats.lastSwallow ? new Date(stats.lastSwallow).toLocaleString() : '—';
}
document.getElementById('btn-start-swallow').addEventListener('click', () => {
  document.querySelector('.nav-item[data-view="swallow"]').click();
});

// ---------- Archive ----------
async function refreshArchiveList() {
  const archives = await window.pixel.listArchives();
  const list = document.getElementById('archive-list');
  list.innerHTML = '';
  for (const a of archives) {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `<div><div>${a.name}</div><div class="meta">Created ${new Date(a.created_at).toLocaleDateString()}</div></div>`;
    list.appendChild(el);
  }
  await populateArchiveSelects(archives);
}

async function populateArchiveSelects(archives) {
  const selects = [
    document.getElementById('swallow-archive'),
    document.getElementById('box-archive-select')
  ];
  for (const sel of selects) {
    const prev = sel.value;
    sel.innerHTML = archives.map((a) => `<option value="${a.id}">${a.name}</option>`).join('');
    if (prev) sel.value = prev;
  }
  currentArchiveId = document.getElementById('swallow-archive').value || (archives[0] && archives[0].id);
}

document.getElementById('btn-create-archive').addEventListener('click', async () => {
  const input = document.getElementById('new-archive-name');
  if (!input.value.trim()) return;
  await window.pixel.createArchive(input.value.trim());
  input.value = '';
  refreshArchiveList();
});

// ---------- Boxes ----------
async function refreshBoxArchiveSelect() {
  const archives = await window.pixel.listArchives();
  await populateArchiveSelects(archives);
  await refreshBoxList();
}

document.getElementById('box-archive-select').addEventListener('change', refreshBoxList);
document.getElementById('swallow-archive').addEventListener('change', async (e) => {
  currentArchiveId = e.target.value;
  await refreshSwallowBoxes();
});

async function refreshBoxList() {
  const archiveId = document.getElementById('box-archive-select').value;
  if (!archiveId) return;
  const boxes = await window.pixel.listBoxes(archiveId);
  const list = document.getElementById('box-list');
  list.innerHTML = '';
  for (const b of boxes) {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `<div><div>${b.label}</div><div class="meta">${b.year_range || 'no year range'}</div></div>`;
    list.appendChild(el);
  }
  await refreshSwallowBoxes();
}

async function refreshSwallowBoxes() {
  const archiveId = document.getElementById('swallow-archive').value;
  if (!archiveId) return;
  const boxes = await window.pixel.listBoxes(archiveId);
  const sel = document.getElementById('swallow-box');
  sel.innerHTML = boxes.map((b) => `<option value="${b.id}">${b.label}</option>`).join('');
}

document.getElementById('btn-create-box').addEventListener('click', async () => {
  const archiveId = document.getElementById('box-archive-select').value;
  const label = document.getElementById('new-box-label').value.trim();
  const years = document.getElementById('new-box-years').value.trim();
  if (!archiveId || !label) return;
  await window.pixel.createBox(archiveId, label, years || null);
  document.getElementById('new-box-label').value = '';
  document.getElementById('new-box-years').value = '';
  refreshBoxList();
});

document.getElementById('btn-print-label').addEventListener('click', async () => {
  const archiveSelect = document.getElementById('box-archive-select');
  const archiveName = archiveSelect.options[archiveSelect.selectedIndex]?.text || 'Archive';
  const label = document.getElementById('new-box-label').value.trim();
  const years = document.getElementById('new-box-years').value.trim();
  if (!label) return;
  await window.pixel.generateBoxLabel({ archiveName, boxLabel: label, yearRange: years || null });
});

// ---------- Swallow (ingestion) ----------
async function initScannerDevices() {
  const status = await window.pixel.listScannerDevices();
  const sel = document.getElementById('swallow-device');
  if (status.available && status.devices.length) {
    sel.innerHTML = status.devices.map((d) => `<option>${d}</option>`).join('');
  } else {
    sel.innerHTML = '<option>— manual import fallback active —</option>';
    document.getElementById('btn-manual-import').disabled = false;
  }
}

document.getElementById('btn-begin-batch').addEventListener('click', async () => {
  const boxId = document.getElementById('swallow-box').value;
  if (!boxId) { alert('Create a box first (BOXES tab).'); return; }
  currentBoxId = boxId;
  const dpi = parseInt(document.getElementById('swallow-dpi').value, 10) || 300;
  const colorMode = document.getElementById('swallow-color').value;

  const { batchId, watchFolder } = await window.pixel.startWatchFolder(boxId, dpi, colorMode);
  currentBatchId = batchId;
  document.getElementById('import-folder-path').textContent = watchFolder;
  document.getElementById('btn-finalize-batch').disabled = false;
  document.getElementById('btn-manual-import').disabled = false;
  document.getElementById('live-log').innerHTML = '';
  logLine(`Batch ${batchId} started. Watching: ${watchFolder}`, 'ok');
});

document.getElementById('btn-manual-import').addEventListener('click', async () => {
  if (!currentBatchId) { alert('Begin a batch first.'); return; }
  const result = await window.pixel.manualImport(currentBatchId);
  logLine(`Imported ${result.imported} file(s) into watch folder.`, 'ok');
});

document.getElementById('btn-finalize-batch').addEventListener('click', async () => {
  if (!currentBatchId) return;
  logLine('Finalizing batch — grouping pages into documents…', 'ok');
  const result = await window.pixel.finalizeBatch(currentBatchId, currentBoxId);
  logLine(`Batch finalized. ${result.documentCount} document(s) created.`, 'ok');
  document.getElementById('btn-finalize-batch').disabled = true;
  currentBatchId = null;
  refreshDashboard();
});

function logLine(text, level = 'ok') {
  const log = document.getElementById('live-log');
  const line = document.createElement('div');
  line.className = `entry ${level}`;
  line.textContent = text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

window.pixel.onPageProcessed(({ pageNumber, status, error }) => {
  if (error) {
    logLine(`Page ${pageNumber}: ERROR — ${error}`, 'error');
  } else {
    const level = status === 'HIGH' ? 'ok' : (status === 'MEDIUM' ? 'ok' : 'warn');
    logLine(`Page ${pageNumber}: processed (${status})`, level);
  }
});

// ---------- Search ----------
document.getElementById('btn-search').addEventListener('click', runSearch);
document.getElementById('search-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

async function runSearch() {
  const query = document.getElementById('search-query').value.trim();
  const results = await window.pixel.search(query);
  const list = document.getElementById('search-results');
  list.innerHTML = '';
  if (!results.length) {
    list.innerHTML = '<div class="hint">No matches.</div>';
    return;
  }
  for (const r of results) {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div>
        <div>${r.supplier || r.category || 'Unclassified'} — ${r.reference || 'no ref'}</div>
        <div class="meta">${r.snippet || ''}</div>
      </div>
      <span class="badge badge-${(r.confidence || 'review').toLowerCase()}">${r.confidence}</span>
    `;
    list.appendChild(el);
  }
}

// ---------- Review ----------
async function refreshReview() {
  const summary = await window.pixel.reviewSummary();
  document.getElementById('review-count').textContent = `${summary.pending} item(s) pending`;
  const items = await window.pixel.reviewItems(null);
  const list = document.getElementById('review-list');
  list.innerHTML = '';
  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div>
        <div>${item.reason}</div>
        <div class="meta">Confidence: ${item.confidence} · ${new Date(item.created_at).toLocaleString()}</div>
      </div>
      <button data-id="${item.id}">RESOLVE</button>
    `;
    el.querySelector('button').addEventListener('click', async () => {
      await window.pixel.resolveReview(item.id);
      refreshReview();
      refreshDashboard();
    });
    list.appendChild(el);
  }
}

// ---------- Settings / export ----------
document.getElementById('btn-export-csv').addEventListener('click', async () => {
  if (!currentArchiveId) { alert('No archive selected — visit the ARCHIVE tab first.'); return; }
  const result = await window.pixel.exportCsv(currentArchiveId, null);
  if (!result.canceled) alert(`Exported ${result.count} document(s).`);
});

// ---------- Boot ----------
(async function init() {
  await refreshDashboard();
  await refreshArchiveList();
  await initScannerDevices();
})();
