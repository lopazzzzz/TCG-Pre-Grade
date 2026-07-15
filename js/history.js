import { API_BASE, GAME_LABELS } from './config.js';
import { renderResultsDashboard, parseJsonResponse } from './grading.js';

const grid = document.getElementById('history-grid');
const emptyState = document.getElementById('history-empty');
const filterButtons = document.querySelectorAll('.filter-btn');
const modal = document.getElementById('detail-modal');
const modalBody = document.getElementById('detail-modal-body');
const modalClose = document.getElementById('detail-modal-close');

let currentFilter = 'all';

async function fetchCards(game) {
  const url = new URL(`${API_BASE}/list-cards`, window.location.origin);
  if (game && game !== 'all') url.searchParams.set('game', game);
  const res = await fetch(url);
  const data = await parseJsonResponse(res);
  if (!res.ok) throw new Error(data.error || 'Failed to load history');
  return data.cards;
}

function cardTile(card) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'history-tile';
  const best = [card.psa_estimate, card.cgc_estimate, card.bgs_estimate, card.tag_estimate]
    .filter((v) => v != null);
  const avg = best.length ? (best.reduce((a, b) => a + b, 0) / best.length).toFixed(1) : '-';
  el.innerHTML = `
    <div class="history-tile__thumb-wrap">
      ${card.front_thumb_url ? `<img class="history-tile__thumb" src="${card.front_thumb_url}" alt="">` : '<div class="history-tile__thumb history-tile__thumb--placeholder"></div>'}
    </div>
    <div class="history-tile__body">
      <div class="history-tile__name">${card.card_name || 'Untitled card'}</div>
      <div class="history-tile__meta">${GAME_LABELS[card.game] || card.game} · ${new Date(card.created_at).toLocaleDateString()}</div>
      <div class="history-tile__grade">~${avg}</div>
    </div>
  `;
  el.addEventListener('click', () => openDetail(card.id));
  return el;
}

async function openDetail(id) {
  modal.classList.add('is-open');
  modalBody.innerHTML = '<p class="loading">Loading…</p>';
  try {
    const res = await fetch(`${API_BASE}/get-card?id=${encodeURIComponent(id)}`);
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error || 'Failed to load card');

    const header = document.createElement('div');
    header.className = 'detail-header';
    header.innerHTML = `
      <div class="detail-header__images">
        ${data.front_image_signed_url ? `<img src="${data.front_image_signed_url}" alt="front">` : ''}
        ${data.back_image_signed_url ? `<img src="${data.back_image_signed_url}" alt="back">` : ''}
      </div>
      <h2>${data.card_name || 'Untitled card'}</h2>
      <p class="detail-header__meta">${GAME_LABELS[data.game] || data.game}${data.set_name ? ' · ' + data.set_name : ''}${data.card_number ? ' · #' + data.card_number : ''}</p>
    `;

    const dashboard = document.createElement('div');
    renderResultsDashboard(dashboard, {
      centering: { score: data.centering_score, front_ratio: data.centering_front_ratio, back_ratio: data.centering_back_ratio },
      corners_score: data.corners_score,
      surface_score: data.surface_score,
      edges_score: data.edges_score,
      defects: data.defects || [],
      summary: '',
      companies: {
        psa: { estimate: data.psa_estimate, confidence: data.psa_confidence },
        cgc: { estimate: data.cgc_estimate, confidence: data.cgc_confidence },
        bgs: { estimate: data.bgs_estimate, confidence: data.bgs_confidence },
        tag: { estimate: data.tag_estimate, confidence: data.tag_confidence },
      },
    });

    modalBody.innerHTML = '';
    modalBody.appendChild(header);
    modalBody.appendChild(dashboard);
  } catch (err) {
    modalBody.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

modalClose.addEventListener('click', () => modal.classList.remove('is-open'));
modal.addEventListener('click', (evt) => { if (evt.target === modal) modal.classList.remove('is-open'); });

async function loadAndRender() {
  grid.innerHTML = '<p class="loading">Loading…</p>';
  try {
    const cards = await fetchCards(currentFilter);
    grid.innerHTML = '';
    if (!cards.length) {
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';
    cards.forEach((card) => grid.appendChild(cardTile(card)));
  } catch (err) {
    grid.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

filterButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    filterButtons.forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    currentFilter = btn.dataset.filter;
    loadAndRender();
  });
});

loadAndRender();
