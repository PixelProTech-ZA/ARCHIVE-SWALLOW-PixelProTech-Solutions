// app.js — all data shown here comes from window.pixel (preload bridge)
// calling the real main-process pipeline. Nothing on this screen is placeholder data.

const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item');

navItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    navItems.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    views.forEach((v) => v.classList.remove('active'));
    document.getElementById('view-' + btn.dataset.view).classList.add('active');
    if (btn.dataset.view === 'dashboard') loadDashboard();
    if (btn.dataset.view === 'archive') loadArchives();
    if (btn.dataset.view === 'boxes') loadBoxesView();
    if (btn.dataset.view === 'review') loadReview();
    if (btn.dataset.view === 'swallow') loadSwallowSetup();
  });
});

async function loadDashboard() {
  const stats = await window.pixel.dashboardStats();
  document.getElementById('stat-documents').textContent = stats.documents;
  document.getElementById('stat-pages').textContent = stats.pages;
  document.getElementById('stat-boxes').textContent = stats.boxes;
  document.getElementById('stat-review').textContent = stats.needsReview;
  document.getElementById('stat-last').textContent = stats.lastSwallow || 'No batches yet';
}

document.getElementById('btn-start-swallow').addEventListener('click', () => {
  document.querySelector('.nav-item[data-view="swallow"]').click();
});

// --- Archives ---------------------------------------------------------------
async function loadArchives() {
  const archives = await window.pixel.listArchives();
  const list = document.getElementById('archive-list');
  list.innerHTML = archives.map((a) => `
    <div class="list-item">
      <div class="title">${escapeHtml(a.name)}</div>
      <div class="meta">Created ${a.created_at}</div>
    </div>`).join('') || '<p class="hint">No archives yet — create one above.</p>';

  const selects = [document.getElementById('swallow-archive'), document.getElementById('box-archive-select')];
  selects.forEach((sel) => {
    sel.innerHTML = archives.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  });
  if (archives.length) await loadBoxesForArchive(archives[0].id);
}

document.getElementById('btn-create-archive').addEventListener('click', async () => {
  const input = document.getElementById('new-archive-name');
  if (!input.value.trim()) return;
  await window.pixel.createArchive(input.value.trim());
  input.value = '';
  loadArchives();
});

document.getElementById('swallow-archive').addEventListener('change', (e) => loadBoxesForArchive(e.target.value));
document.getElementById('box-archive-select').addEventListener('change', (e) => loadBoxesView());

async function loadBoxesForArchive(archiveId) {
  const boxes = await window.pixel.listBoxes(archiveId);
  const sel = document.getElementById('swallow-box');
  sel.innerHTML = boxes.map((b) => `<option value="${b.id}">${escapeHtml(b.label)}</option>`).join('');
}

// --- Boxes --------------------------------------------------------------
async function loadBoxesView() {
  const archiveId = document.getElementById('box-archive-select').value;
  if (!archiveId) return;
  const boxes = await window.pixel.listBoxes(archiveId);
  document.getElementById('box-list').innerHTML = boxes.map((b) => `
    <div class="list-item">
      <div class="title">${escapeHtml(b.label)}</div>
      <div class="meta">${b.year_range || 'no year range'} · ${b.department || 'no department'} · created ${b.created_at}</div>
    </div>`).join('') || '<p class="hint">No boxes yet.</p>';
}

document.getElementById('btn-create-box').addEventListener('click', async () => {
  const archiveId = document.getElementById('box-archive-select').value;
  const label = document.getElementById('new-box-label').value.trim();
  const years = document.getElementById('new-box-years').value.trim();
  if (!archiveId || !label) return;
  await window.pixel.createBox(archiveId, label, years, null);
  document.getElementById('new-box-label').value = '';
  document.getElementById('new-box-years').value = '';
  loadBoxesView();
});

// --- Swallow / scanning --------------------------------------------------
let currentBatchId = null;
let currentBoxId = null;

async function loadSwallowSetup() {
  const status = await window.pixel.listScannerDevices();
  const sel = document.getElementById('swallow-device');
  if (status.available && status.devices.length) {
    sel.innerHTML = status.devices.map((d) => `<option>${escapeHtml(d)}</option>`).join('');
  } else {
    sel.innerHTML = `<option>— ${escapeHtml(status.reason || 'no scanner detected')}, using manual import —</option>`;
  }
}

document.getElementById('btn-begin-batch').addEventListener('click', async () => {
  currentBoxId = document.getElementById('swallow-box').value;
  if (!currentBoxId) { alert('Create a box first.'); return; }
  const result = await window.pixel.startWatchFolder(currentBoxId);
  currentBatchId = result.batchId;
  document.getElementById('import-folder-path').textContent = 'Import folder: ' + result.importDir;
  document.getElementById('btn-finalize-batch').disabled = false;
  document.getElementById('live-log').innerHTML = '';
});

window.pixel.onPageProcessed(({ pageNumber, status, error }) => {
  const log = document.getElementById('live-log');
  const line = document.createElement('div');
  line.className = status === 'ok' ? 'ok' : 'err';
  line.textContent = status === 'ok'
    ? `PAGE ${String(pageNumber).padStart(3, '0')}    PROCESSED`
    : `PAGE ${String(pageNumber).padStart(3, '0')}    FAILED — ${error}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
});

document.getElementById('btn-finalize-batch').addEventListener('click', async () => {
  if (!currentBatchId || !currentBoxId) return;
  const result = await window.pixel.finalizeBatch(currentBatchId, currentBoxId);
  const log = document.getElementById('live-log');
  const line = document.createElement('div');
  line.className = 'ok';
  line.textContent = `BATCH FINALIZED — ${result.documentsCreated} document(s) created`;
  log.appendChild(line);
  document.getElementById('btn-finalize-batch').disabled = true;
  currentBatchId = null;
});

// --- Search ---------------------------------------------------------------
document.getElementById('btn-search').addEventListener('click', runSearch);
document.getElementById('search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

async function runSearch() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;
  const results = await window.pixel.search(query);
  document.getElementById('search-results').innerHTML = results.map((r) => `
    <div class="list-item">
      <div class="title">${escapeHtml(r.category)} — Box ${escapeHtml(r.box_label)}</div>
      <div class="meta">${r.page_count} page(s) · ${r.snippet ? escapeHtml(r.snippet) : ''}</div>
    </div>`).join('') || '<p class="hint">No matches.</p>';
}

// --- Review -----------------------------------------------------------------
async function loadReview() {
  const summary = await window.pixel.reviewSummary();
  document.getElementById('review-summary').innerHTML = `
    <div class="stat-card warn"><div class="stat-value">${summary.total}</div><div class="stat-label">TOTAL OPEN</div></div>
    ${summary.byType.map((t) => `<div class="stat-card"><div class="stat-value">${t.count}</div><div class="stat-label">${t.item_type.toUpperCase()}</div></div>`).join('')}
  `;
  const items = await window.pixel.reviewItems(null);
  document.getElementById('review-list').innerHTML = items.map((i) => `
    <div class="list-item">
      <div class="title">${i.item_type.toUpperCase()} — ${escapeHtml(i.reason || '')}</div>
      <div class="meta">Reference: ${i.reference_id} · Opened ${i.created_at}
        <button class="secondary-btn" onclick="resolveItem('${i.id}')" style="margin-left:10px;">MARK RESOLVED</button>
      </div>
    </div>`).join('') || '<p class="hint">Nothing needs review right now.</p>';
}

window.resolveItem = async (id) => {
  await window.pixel.resolveReview(id);
  loadReview();
};

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Initial load
loadDashboard();
loadArchives();
