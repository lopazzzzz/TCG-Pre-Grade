import { API_BASE, GAME_LABELS } from './config.js';
import { renderResultsDashboard, parseJsonResponse } from './grading.js';
import { initThemeToggle } from './theme.js';

initThemeToggle();

const loginPanel = document.getElementById('login-panel');
const usagePanel = document.getElementById('usage-panel');
const dashboardPanel = document.getElementById('dashboard-panel');
const usageBarFill = document.getElementById('usage-bar-fill');
const usageStat = document.getElementById('usage-stat');
const usagePausedNote = document.getElementById('usage-paused-note');
const usageResetBtn = document.getElementById('usage-reset-btn');
const passwordInput = document.getElementById('password-input');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const listEl = document.getElementById('admin-list');
const emptyEl = document.getElementById('admin-empty');
const modal = document.getElementById('detail-modal');
const modalBody = document.getElementById('detail-body');
const modalClose = document.getElementById('detail-close');
const selectToggleBtn = document.getElementById('select-toggle-btn');
const bulkBar = document.getElementById('admin-bulk-bar');
const selectAllCheckbox = document.getElementById('select-all-checkbox');
const deleteSelectedBtn = document.getElementById('delete-selected-btn');
const cancelSelectBtn = document.getElementById('cancel-select-btn');

let lastScans = [];
let selectionMode = false;
const selectedIds = new Set();

function showLogin() {
  loginPanel.hidden = false;
  usagePanel.hidden = true;
  dashboardPanel.hidden = true;
}
function showDashboard() {
  loginPanel.hidden = true;
  usagePanel.hidden = false;
  dashboardPanel.hidden = false;
}

function renderUsage(status) {
  const pct = status.limit ? Math.min(100, Math.round((status.count / status.limit) * 100)) : 0;
  usageBarFill.style.width = `${pct}%`;
  usageBarFill.classList.toggle('is-blocked', status.blocked);
  usageBarFill.classList.toggle('is-warning', !status.blocked && status.count >= status.threshold * 0.85);
  usageStat.textContent = `${status.count} / ${status.limit} analyses today (pauses at ${status.threshold})`;
  if (status.blocked) {
    const resetTime = new Date(status.resetAt).toLocaleString();
    usagePausedNote.textContent = `⏸ Paused — new analyses are blocked until ${resetTime} (UTC reset).`;
    usagePausedNote.hidden = false;
  } else {
    usagePausedNote.hidden = true;
  }
}

async function loadUsage() {
  try {
    const res = await fetch(`${API_BASE}/admin-usage`);
    if (!res.ok) return;
    const data = await parseJsonResponse(res);
    renderUsage(data);
  } catch {
    // Non-critical — the scan log itself still works without this.
  }
}

function scoreLine(scan) {
  const c = scan.companies || {};
  const part = (k) => (c[k] ? `${k.toUpperCase()} <b>${Number(c[k].estimate).toFixed(1)}</b>` : '');
  return ['psa', 'cgc', 'bgs', 'tag'].map(part).filter(Boolean).join(' · ');
}

function setSelected(id, checked) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  updateBulkBar();
}

function updateBulkBar() {
  deleteSelectedBtn.textContent = `Delete selected (${selectedIds.size})`;
  deleteSelectedBtn.disabled = selectedIds.size === 0;
  selectAllCheckbox.checked = lastScans.length > 0 && selectedIds.size === lastScans.length;
}

function setSelectionMode(on) {
  selectionMode = on;
  selectToggleBtn.hidden = on;
  bulkBar.hidden = !on;
  if (!on) selectedIds.clear();
  renderList();
}

function row(scan) {
  const wrap = document.createElement('div');
  wrap.className = 'admin-row';
  const when = new Date(scan.createdAt).toLocaleString();
  wrap.innerHTML = `
    <input type="checkbox" class="admin-row__checkbox" ${selectionMode ? '' : 'hidden'}>
    ${scan.frontThumb ? `<img class="admin-row__thumb" src="${scan.frontThumb}" alt="">` : '<div class="admin-row__thumb admin-row__thumb--empty"></div>'}
    <div class="admin-row__main">
      <div class="admin-row__title">${scan.cardName || 'Untitled card'} <span style="font-weight:400;color:var(--text-muted)">— ${GAME_LABELS[scan.game] || scan.game}</span></div>
      <div class="admin-row__meta">${when}${scan.ip ? ' · ' + scan.ip : ''}</div>
      <div class="admin-row__scores">${scoreLine(scan)}</div>
    </div>
  `;
  const checkbox = wrap.querySelector('.admin-row__checkbox');
  checkbox.checked = selectedIds.has(scan.id);
  checkbox.addEventListener('click', (evt) => {
    evt.stopPropagation();
    setSelected(scan.id, checkbox.checked);
  });
  wrap.addEventListener('click', () => {
    if (selectionMode) {
      checkbox.checked = !checkbox.checked;
      setSelected(scan.id, checkbox.checked);
    } else {
      openDetail(scan.id);
    }
  });
  return wrap;
}

function renderList() {
  listEl.innerHTML = '';
  if (!lastScans.length) {
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  lastScans.forEach((scan) => listEl.appendChild(row(scan)));
  updateBulkBar();
}

async function loadLogs() {
  const res = await fetch(`${API_BASE}/admin-logs`);
  if (res.status === 401) {
    showLogin();
    return;
  }
  const data = await parseJsonResponse(res);
  if (!res.ok) throw new Error(data.error || 'Failed to load logs');

  showDashboard();
  lastScans = data.scans;
  renderList();
  loadUsage();
}

async function openDetail(id) {
  modal.classList.add('is-open');
  modalBody.innerHTML = '<p class="loading">Loading…</p>';
  try {
    const res = await fetch(`${API_BASE}/admin-log?id=${encodeURIComponent(id)}`);
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error || 'Failed to load scan');

    modalBody.innerHTML = '';

    const header = document.createElement('div');
    header.innerHTML = `
      <div class="admin-detail__images">
        ${data.front_image_data_url ? `<img src="${data.front_image_data_url}" alt="front">` : ''}
        ${data.back_image_data_url ? `<img src="${data.back_image_data_url}" alt="back">` : ''}
      </div>
      <h2 style="margin:0 0 4px">${data.cardName || 'Untitled card'}</h2>
      <p style="margin:0 0 4px;color:var(--text-muted);font-size:0.85rem">${GAME_LABELS[data.game] || data.game}${data.setName ? ' · ' + data.setName : ''}${data.cardNumber ? ' · #' + data.cardNumber : ''}</p>
      <p style="margin:0 0 14px;color:var(--text-muted);font-size:0.8rem">${new Date(data.createdAt).toLocaleString()}${data.ip ? ' · ' + data.ip : ''}</p>
    `;
    modalBody.appendChild(header);

    const dashboard = document.createElement('div');
    renderResultsDashboard(dashboard, {
      centering: data.centering,
      corners_score: data.corners_score,
      surface_score: data.surface_score,
      edges_score: data.edges_score,
      defects: data.defects || [],
      summary: data.summary || '',
      companies: data.companies,
    });
    modalBody.appendChild(dashboard);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-secondary btn-small';
    deleteBtn.textContent = 'Delete this log entry';
    deleteBtn.style.marginTop = '16px';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Delete this scan log permanently?')) return;
      await fetch(`${API_BASE}/admin-log-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      modal.classList.remove('is-open');
      loadLogs();
    });
    modalBody.appendChild(deleteBtn);
  } catch (err) {
    modalBody.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

modalClose.addEventListener('click', () => modal.classList.remove('is-open'));
modal.addEventListener('click', (evt) => { if (evt.target === modal) modal.classList.remove('is-open'); });

loginBtn.addEventListener('click', async () => {
  loginError.hidden = true;
  try {
    const res = await fetch(`${API_BASE}/admin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordInput.value }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error || 'Login failed');
    passwordInput.value = '';
    await loadLogs();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.hidden = false;
  }
});

passwordInput.addEventListener('keydown', (evt) => {
  if (evt.key === 'Enter') loginBtn.click();
});

logoutBtn.addEventListener('click', async () => {
  await fetch(`${API_BASE}/admin-logout`, { method: 'POST' });
  setSelectionMode(false);
  showLogin();
});

selectToggleBtn.addEventListener('click', () => setSelectionMode(true));
cancelSelectBtn.addEventListener('click', () => setSelectionMode(false));

selectAllCheckbox.addEventListener('change', () => {
  if (selectAllCheckbox.checked) lastScans.forEach((s) => selectedIds.add(s.id));
  else selectedIds.clear();
  renderList();
});

deleteSelectedBtn.addEventListener('click', async () => {
  if (!selectedIds.size) return;
  if (!confirm(`Delete ${selectedIds.size} selected scan(s) permanently? This cannot be undone.`)) return;
  deleteSelectedBtn.disabled = true;
  deleteSelectedBtn.textContent = 'Deleting…';
  try {
    await Promise.all([...selectedIds].map((id) => fetch(`${API_BASE}/admin-log-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })));
  } finally {
    setSelectionMode(false);
    await loadLogs();
  }
});

usageResetBtn.addEventListener('click', async () => {
  if (!confirm('Reset today\'s analysis counter and resume immediately?')) return;
  usageResetBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/admin-usage`, { method: 'POST' });
    const data = await parseJsonResponse(res);
    if (res.ok) renderUsage(data);
  } finally {
    usageResetBtn.disabled = false;
  }
});

loadLogs().catch(() => showLogin());
