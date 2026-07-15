import { API_BASE, GAME_LABELS } from './config.js';
import { renderResultsDashboard, parseJsonResponse } from './grading.js';
import { initThemeToggle } from './theme.js';

initThemeToggle();

const loginPanel = document.getElementById('login-panel');
const dashboardPanel = document.getElementById('dashboard-panel');
const passwordInput = document.getElementById('password-input');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const listEl = document.getElementById('admin-list');
const emptyEl = document.getElementById('admin-empty');
const modal = document.getElementById('detail-modal');
const modalBody = document.getElementById('detail-body');
const modalClose = document.getElementById('detail-close');

function showLogin() {
  loginPanel.hidden = false;
  dashboardPanel.hidden = true;
}
function showDashboard() {
  loginPanel.hidden = true;
  dashboardPanel.hidden = false;
}

function scoreLine(scan) {
  const c = scan.companies || {};
  const part = (k) => (c[k] ? `${k.toUpperCase()} <b>${Number(c[k].estimate).toFixed(1)}</b>` : '');
  return ['psa', 'cgc', 'bgs', 'tag'].map(part).filter(Boolean).join(' · ');
}

function row(scan) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'admin-row';
  const when = new Date(scan.createdAt).toLocaleString();
  btn.innerHTML = `
    ${scan.frontThumb ? `<img class="admin-row__thumb" src="${scan.frontThumb}" alt="">` : '<div class="admin-row__thumb admin-row__thumb--empty"></div>'}
    <div class="admin-row__main">
      <div class="admin-row__title">${scan.cardName || 'Untitled card'} <span style="font-weight:400;color:var(--text-muted)">— ${GAME_LABELS[scan.game] || scan.game}</span></div>
      <div class="admin-row__meta">${when}${scan.ip ? ' · ' + scan.ip : ''}</div>
      <div class="admin-row__scores">${scoreLine(scan)}</div>
    </div>
  `;
  btn.addEventListener('click', () => openDetail(scan.id));
  return btn;
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
  listEl.innerHTML = '';
  if (!data.scans.length) {
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  data.scans.forEach((scan) => listEl.appendChild(row(scan)));
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
  showLogin();
});

loadLogs().catch(() => showLogin());
