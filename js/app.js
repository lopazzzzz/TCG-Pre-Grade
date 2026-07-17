import { loadImageFromFile, toWorkingCanvas, canvasToDataUrl, makeThumbnailDataUrl, generateCornerCrops, applyAdjustments, createCompareSlider } from './imageTools.js';
import { autoDetectBorders, computeRatios, attachBorderEditor } from './centering.js';
import { autoDetectCorners, attachCornerPicker, warpQuadToRect } from './perspective.js';
import { analyzeCard, renderResultsDashboard } from './grading.js';
import { generateReportImage } from './report.js';
import { initThemeToggle } from './theme.js';
import { initDonateCopyButton } from './donate.js';
import { initLangToggle, t } from './i18n.js';

initThemeToggle();
initDonateCopyButton();
initLangToggle();

// The app always works on an array of "cards" (a batch of size 1 in the
// common case), each holding its own upload/align/centering/result state —
// this is what lets "Grade New Card" and "Bulk Pre-Grade" share one
// implementation: adding a card is the same operation either way, the only
// difference is whether the user does it once (grading cards one at a
// time) or several times up front before analyzing everything together.
const MAX_CARDS = 10;
let cardSeq = 0;

function makeBlankCard() {
  cardSeq += 1;
  return {
    seq: cardSeq,
    game: 'pokemon',
    cardName: '', setName: '', cardNumber: '',
    front: null, // { original, canvas, corners, ratios, borders, alignEditor, centeringEditor }
    back: null,
    aligned: false,
    xraySide: 'front',
    lastResult: null,
    analyzeError: null,
  };
}

let cards = [makeBlankCard()];
let activeIndex = 0;
function activeCard() { return cards[activeIndex]; }

// The X-ray compare-slider's DOM lives in one shared container across all
// cards, so its instance can't be cached per-card the way editors are —
// switching cards (or re-confirming alignment) always rebuilds it fresh.
let currentCompareSlider = null;

// ---- Card tabs ----
const cardTabsEl = document.getElementById('card-tabs');

function renderCardTabs() {
  cardTabsEl.innerHTML = '';
  cards.forEach((card, i) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `card-tab${i === activeIndex ? ' is-active' : ''}`;
    tab.innerHTML = `
      ${card.tabThumb ? `<img class="card-tab__thumb" src="${card.tabThumb}" alt="">` : '<div class="card-tab__thumb card-tab__thumb--empty"></div>'}
      <span>${t('card_tab_label')(i + 1)}</span>
      <span class="card-tab__status">${card.lastResult ? '✓' : card.analyzeError ? '!' : ''}</span>
      ${cards.length > 1 ? '<span class="card-tab__remove" data-action="remove">&times;</span>' : ''}
    `;
    tab.addEventListener('click', (evt) => {
      if (evt.target.dataset.action === 'remove') {
        evt.stopPropagation();
        removeCard(i);
        return;
      }
      switchToCard(i);
    });
    cardTabsEl.appendChild(tab);
  });

  if (cards.length < MAX_CARDS) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'card-tab card-tab--add';
    addBtn.textContent = '+';
    addBtn.title = t('add_card_tooltip');
    addBtn.addEventListener('click', () => addCard());
    cardTabsEl.appendChild(addBtn);
  }
}

function addCard() {
  if (cards.length >= MAX_CARDS) return;
  cards.push(makeBlankCard());
  switchToCard(cards.length - 1);
}

function removeCard(i) {
  if (cards.length <= 1) return;
  if (!confirm(t('remove_card_confirm'))) return;
  cards.splice(i, 1);
  if (activeIndex >= cards.length) activeIndex = cards.length - 1;
  else if (activeIndex > i) activeIndex -= 1;
  renderActiveCard();
}

function switchToCard(i) {
  activeIndex = i;
  renderActiveCard();
}

// Re-renders every panel from the active card's own saved state — called on
// every card switch/add/remove, and after any action that changes the
// active card's data (upload, confirm alignment, analyze).
function renderActiveCard() {
  const card = activeCard();
  renderCardTabs();

  document.querySelectorAll('.game-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.game === card.game));
  document.getElementById('card-name').value = card.cardName;
  document.getElementById('set-name').value = card.setName;
  document.getElementById('card-number').value = card.cardNumber;

  setPreview('front', card.front);
  setPreview('back', card.back);

  const panelAlign = document.getElementById('panel-align');
  const panelCentering = document.getElementById('panel-centering');
  const panelXray = document.getElementById('panel-xray');
  const panelAnalyze = document.getElementById('panel-analyze');

  if (card.front && card.back) {
    panelAlign.hidden = false;
    setupAlign('front', 'front-align-canvas', 'front-align-reset-btn');
    setupAlign('back', 'back-align-canvas', 'back-align-reset-btn');
  } else {
    panelAlign.hidden = true;
  }

  if (card.aligned) {
    panelCentering.hidden = false;
    panelXray.hidden = false;
    setupCentering('front', 'front-centering-canvas', 'front-ratio-lr', 'front-ratio-tb', 'front-reset-btn');
    setupCentering('back', 'back-centering-canvas', 'back-ratio-lr', 'back-ratio-tb', 'back-reset-btn');
    resetXraySliders();
    setupXray();
  } else {
    panelCentering.hidden = true;
    panelXray.hidden = true;
  }
  // The analyze section's visibility is batch-wide (any card ready), not
  // tied to the currently-viewed card specifically — otherwise switching to
  // a freshly-added, not-yet-aligned card would hide the "Analyze All"
  // button even though earlier cards in the batch already finished.
  panelAnalyze.hidden = !anyCardReady();

  updateAnalyzeButtonLabel();

  document.getElementById('analyze-error').hidden = true;
  const resultsContainer = document.getElementById('results-container');
  const saveSection = document.getElementById('save-section');
  if (card.lastResult) {
    renderResultsDashboard(resultsContainer, card.lastResult, {
      front: card.front.canvas,
      back: card.back.canvas,
      frontBounds: card.front.centeringEditor.getBorders().outer,
      backBounds: card.back.centeringEditor.getBorders().outer,
    });
    saveSection.hidden = false;
    document.getElementById('save-status').textContent = '';
  } else {
    resultsContainer.innerHTML = '';
    saveSection.hidden = true;
  }
}

function setPreview(side, sideState) {
  const previewEl = document.getElementById(`${side}-preview`);
  const errorEl = document.getElementById(`${side}-upload-error`);
  errorEl.hidden = true;
  errorEl.textContent = '';
  if (sideState) {
    previewEl.src = canvasToDataUrl(sideState.original, 0.85);
    previewEl.hidden = false;
  } else {
    previewEl.hidden = true;
    previewEl.removeAttribute('src');
  }
}

function updateAnalyzeButtonLabel() {
  document.getElementById('analyze-btn').textContent = t('analyze_all_btn')(cards.length);
}

function anyCardReady() {
  return cards.some((c) => c.front && c.back && c.aligned);
}

// ---- Game selector ----
document.querySelectorAll('.game-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.game-btn').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    activeCard().game = btn.dataset.game;
  });
});

// ---- Card detail fields ----
const FIELD_KEYS = { 'card-name': 'cardName', 'set-name': 'setName', 'card-number': 'cardNumber' };
Object.keys(FIELD_KEYS).forEach((id) => {
  document.getElementById(id).addEventListener('input', (evt) => {
    activeCard()[FIELD_KEYS[id]] = evt.target.value;
  });
});

// ---- Upload handling ----
function setupUpload(side, dropId, inputId, previewId, errorId) {
  const drop = document.getElementById(dropId);
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  const errorEl = document.getElementById(errorId);

  // No explicit click-to-open-picker handler needed here: `drop` is a
  // <label> directly wrapping `input`, so tapping/clicking it already
  // natively opens the file picker. An earlier version also called
  // input.click() manually on top of that native behavior, double-triggering
  // the picker on every tap — harmless on desktop, but on iOS the native
  // photo-picker session is fragile enough that the second trigger could
  // silently discard the selection just made, so `change` never fired with
  // a file (matches "the picker opens fine, but nothing happens after").
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-dragover');
    if (e.dataTransfer.files[0]) handleFile(side, e.dataTransfer.files[0], preview, errorEl);
  });
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    // Reset only after the read settles (not synchronously) — clearing the
    // input's value while a read is still in flight on some mobile browsers
    // risked interfering with that in-flight read.
    handleFile(side, file, preview, errorEl).finally(() => { input.value = ''; });
  });
}

async function handleFile(side, file, previewEl, errorEl) {
  errorEl.hidden = true;
  errorEl.textContent = '';
  try {
    const img = await loadImageFromFile(file);
    const canvas = toWorkingCanvas(img);
    const card = activeCard();
    card[side] = { original: canvas, canvas, corners: null, ratios: null, borders: null, alignEditor: null, centeringEditor: null };
    // A changed photo invalidates any alignment/result already recorded.
    card.aligned = false;
    card.lastResult = null;
    card.analyzeError = null;
    if (side === 'front') card.tabThumb = makeThumbnailDataUrl(canvas, 60);

    previewEl.src = canvasToDataUrl(canvas, 0.85);
    previewEl.hidden = false;

    document.getElementById('panel-centering').hidden = true;
    document.getElementById('panel-xray').hidden = true;
    document.getElementById('panel-analyze').hidden = true;
    document.getElementById('results-container').innerHTML = '';
    document.getElementById('save-section').hidden = true;

    if (card.front && card.back) {
      document.getElementById('panel-align').hidden = false;
      setupAlign('front', 'front-align-canvas', 'front-align-reset-btn');
      setupAlign('back', 'back-align-canvas', 'back-align-reset-btn');
    }
    renderCardTabs();
  } catch (err) {
    errorEl.textContent = t('upload_read_error');
    errorEl.hidden = false;
  }
}

setupUpload('front', 'front-drop', 'front-input', 'front-preview', 'front-upload-error');
setupUpload('back', 'back-drop', 'back-input', 'back-preview', 'back-upload-error');

// ---- Align (perspective correction) ----
function setupAlign(side, canvasId, resetBtnId) {
  const card = activeCard();
  const displayCanvas = document.getElementById(canvasId);
  const original = card[side].original;
  displayCanvas.width = original.width;
  displayCanvas.height = original.height;
  displayCanvas._sourceImage = original;

  const initial = card[side].corners || autoDetectCorners(original);
  card[side].corners = initial;
  const editor = attachCornerPicker(displayCanvas, initial, (corners) => { card[side].corners = corners; });
  card[side].alignEditor = editor;

  document.getElementById(resetBtnId).onclick = () => {
    const fresh = autoDetectCorners(original);
    card[side].corners = fresh;
    editor.setCorners(fresh);
  };
}

document.getElementById('confirm-align-btn').addEventListener('click', () => {
  const card = activeCard();
  ['front', 'back'].forEach((side) => {
    const corners = card[side].alignEditor.getCorners();
    card[side].corners = corners;
    card[side].canvas = warpQuadToRect(card[side].original, corners);
    // The aligned canvas is new pixel content — any previously recorded
    // border position no longer applies, so force a fresh auto-detect.
    card[side].borders = null;
  });
  card.aligned = true;
  card.lastResult = null;
  card.analyzeError = null;

  document.getElementById('panel-centering').hidden = false;
  document.getElementById('panel-xray').hidden = false;
  document.getElementById('panel-analyze').hidden = false;
  document.getElementById('results-container').innerHTML = '';
  document.getElementById('save-section').hidden = true;

  setupCentering('front', 'front-centering-canvas', 'front-ratio-lr', 'front-ratio-tb', 'front-reset-btn');
  setupCentering('back', 'back-centering-canvas', 'back-ratio-lr', 'back-ratio-tb', 'back-reset-btn');
  resetXraySliders();
  setupXray();
  renderCardTabs();
});

// ---- Centering ----
function setupCentering(side, canvasId, lrId, tbId, resetBtnId) {
  const card = activeCard();
  const displayCanvas = document.getElementById(canvasId);
  const workingCanvas = card[side].canvas;
  displayCanvas.width = workingCanvas.width;
  displayCanvas.height = workingCanvas.height;
  displayCanvas._sourceImage = workingCanvas;

  const lrEl = document.getElementById(lrId);
  const tbEl = document.getElementById(tbId);

  function updateRatioDisplay(borders) {
    const ratios = computeRatios(borders);
    card[side].ratios = ratios;
    card[side].borders = borders;
    lrEl.textContent = ratios.lrText;
    tbEl.textContent = ratios.tbText;
  }

  const initialBorders = card[side].borders || autoDetectBorders(workingCanvas);
  const editor = attachBorderEditor(displayCanvas, initialBorders, updateRatioDisplay);
  card[side].centeringEditor = editor;
  updateRatioDisplay(initialBorders);

  document.getElementById(resetBtnId).onclick = () => {
    const fresh = autoDetectBorders(workingCanvas);
    editor.setBorders(fresh);
  };
}

// ---- X-ray / light adjustment tool ----
function currentSliderValues() {
  return {
    brightness: Number(document.getElementById('brightness-slider').value),
    contrast: Number(document.getElementById('contrast-slider').value),
    exposure: Number(document.getElementById('exposure-slider').value),
  };
}

function refreshXray() {
  const card = activeCard();
  const canvas = card[card.xraySide]?.canvas;
  if (!canvas) return;
  const vals = currentSliderValues();
  const normal = applyAdjustments(canvas, { ...vals, enhance: false });
  const enhanced = applyAdjustments(canvas, { ...vals, enhance: true });

  if (!currentCompareSlider) {
    currentCompareSlider = createCompareSlider(document.getElementById('compare-container'), normal, enhanced);
  } else {
    currentCompareSlider.updateImages(normal, enhanced);
  }
}

function resetXraySliders() {
  ['brightness-slider', 'contrast-slider', 'exposure-slider'].forEach((id) => { document.getElementById(id).value = 0; });
  document.querySelectorAll('.xray-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.side === 'front'));
  activeCard().xraySide = 'front';
  currentCompareSlider = null;
}

function setupXray() {
  currentCompareSlider = null;
  refreshXray();
}

document.querySelectorAll('.xray-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.xray-btn').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    activeCard().xraySide = btn.dataset.side;
    refreshXray();
  });
});

['brightness-slider', 'contrast-slider', 'exposure-slider'].forEach((id) => {
  document.getElementById(id).addEventListener('input', refreshXray);
});

// ---- Analyze All ----
document.getElementById('analyze-btn').addEventListener('click', async () => {
  const errorEl = document.getElementById('analyze-error');
  const loadingEl = document.getElementById('analyze-loading');
  errorEl.hidden = true;
  errorEl.textContent = '';

  const readyCards = cards.filter((c) => c.front && c.back && c.aligned);
  if (!readyCards.length) {
    errorEl.textContent = cards.length > 1 ? t('analyze_all_error') : t('upload_both_error');
    errorEl.hidden = false;
    return;
  }

  loadingEl.hidden = false;
  document.getElementById('analyze-btn').disabled = true;

  try {
    for (const card of readyCards) {
      if (card.lastResult) continue; // already analyzed — don't re-spend an API call
      let quotaPaused = false;
      try {
        const frontOuter = card.front.centeringEditor.getBorders().outer;
        const backOuter = card.back.centeringEditor.getBorders().outer;
        const frontCrops = generateCornerCrops(card.front.canvas, frontOuter);
        const backCrops = generateCornerCrops(card.back.canvas, backOuter);

        const payload = {
          game: card.game,
          cardName: card.cardName.trim(),
          setName: card.setName.trim(),
          cardNumber: card.cardNumber.trim(),
          centeringFrontRatio: card.front.ratios.scoringText,
          centeringBackRatio: card.back.ratios.scoringText,
          images: {
            frontFull: canvasToDataUrl(card.front.canvas),
            backFull: canvasToDataUrl(card.back.canvas),
            frontCorners: frontCrops.map((c) => c.dataUrl),
            backCorners: backCrops.map((c) => c.dataUrl),
            frontThumb: makeThumbnailDataUrl(card.front.canvas),
          },
        };

        card.lastResult = await analyzeCard(payload);
        card.analyzeError = null;
      } catch (err) {
        quotaPaused = err.code === 'quota_paused';
        card.analyzeError = quotaPaused && err.resetAt
          ? `${err.message} (resumes ${new Date(err.resetAt).toLocaleString()})`
          : (err.message || 'Analyze failed');
      }
      renderCardTabs();
      // The daily safety cap blocks every remaining card identically — stop
      // immediately instead of burning a request per card to rediscover the
      // same "paused" result each time.
      if (quotaPaused) break;
    }

    renderActiveCard();
    const failedCount = readyCards.filter((c) => c.analyzeError).length;
    if (failedCount) {
      errorEl.textContent = activeCard().analyzeError || `${failedCount} card(s) failed — check each card's tab.`;
      errorEl.hidden = false;
    }
  } finally {
    loadingEl.hidden = true;
    document.getElementById('analyze-btn').disabled = false;
  }
});

// ---- Grade New Card ----
document.getElementById('grade-new-card-btn').addEventListener('click', () => {
  addCard();
  document.getElementById('panel-info').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---- Save as Image ----
// Shows the generated report as a full-size <img> in a modal rather than
// relying on an <a download> click — iOS Safari/WebKit has never reliably
// honored the `download` attribute for saving to Photos (it typically just
// opens the image, or does nothing at all), whereas the plain <img>'s
// native "Save Image"/"Save to Photos" context menu (long-press on mobile,
// right-click on desktop) works universally without needing that attribute.
function openReportModal(canvas) {
  document.getElementById('report-modal-img').src = canvas.toDataURL('image/png');
  document.getElementById('report-modal').classList.add('is-open');
}

const reportModal = document.getElementById('report-modal');
document.getElementById('report-modal-close').addEventListener('click', () => reportModal.classList.remove('is-open'));
reportModal.addEventListener('click', (evt) => { if (evt.target === reportModal) reportModal.classList.remove('is-open'); });

document.getElementById('save-image-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('save-status');
  const card = activeCard();
  if (!card.lastResult) return;

  const btn = document.getElementById('save-image-btn');
  btn.disabled = true;
  statusEl.textContent = t('saving_image');

  try {
    const now = new Date();
    const timestamp = now.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    const frontBorders = card.front.centeringEditor.getBorders();
    const backBorders = card.back.centeringEditor.getBorders();

    const reportCanvas = await generateReportImage({
      game: card.game,
      cardName: card.cardName.trim(),
      setName: card.setName.trim(),
      cardNumber: card.cardNumber.trim(),
      frontCanvas: card.front.canvas,
      backCanvas: card.back.canvas,
      frontBorders,
      backBorders,
      frontCardBounds: frontBorders.outer,
      backCardBounds: backBorders.outer,
      centering: card.lastResult.centering,
      cornersScore: card.lastResult.corners_score,
      surfaceScore: card.lastResult.surface_score,
      edgesScore: card.lastResult.edges_score,
      companies: card.lastResult.companies,
      defects: card.lastResult.defects,
      timestamp,
    });

    openReportModal(reportCanvas);
    statusEl.textContent = t('saved_image');
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

// Re-render the results dashboard (built with translated strings baked in)
// when the language is switched after an analysis already ran.
document.addEventListener('cardify:langchange', () => {
  updateAnalyzeButtonLabel();
  renderCardTabs();
  const card = activeCard();
  if (!card.lastResult) return;
  renderResultsDashboard(document.getElementById('results-container'), card.lastResult, {
    front: card.front.canvas,
    back: card.back.canvas,
    frontBounds: card.front.centeringEditor.getBorders().outer,
    backBounds: card.back.centeringEditor.getBorders().outer,
  });
});

renderActiveCard();
