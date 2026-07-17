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

const state = {
  game: 'pokemon',
  front: null, // { original, canvas, ratios, alignEditor, centeringEditor }
  back: null,
  xraySide: 'front',
  compareSlider: null,
  lastResult: null,
};

// ---- Game selector ----
document.querySelectorAll('.game-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.game-btn').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.game = btn.dataset.game;
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
    state[side] = { original: canvas, canvas, ratios: null, alignEditor: null, centeringEditor: null };

    previewEl.src = canvasToDataUrl(canvas, 0.85);
    previewEl.hidden = false;

    if (state.front && state.back) {
      document.getElementById('panel-align').hidden = false;
      setupAlign('front', 'front-align-canvas', 'front-align-reset-btn');
      setupAlign('back', 'back-align-canvas', 'back-align-reset-btn');
    }
  } catch (err) {
    errorEl.textContent = t('upload_read_error');
    errorEl.hidden = false;
  }
}

setupUpload('front', 'front-drop', 'front-input', 'front-preview', 'front-upload-error');
setupUpload('back', 'back-drop', 'back-input', 'back-preview', 'back-upload-error');

// ---- Align (perspective correction) ----
function setupAlign(side, canvasId, resetBtnId) {
  const displayCanvas = document.getElementById(canvasId);
  const original = state[side].original;
  displayCanvas.width = original.width;
  displayCanvas.height = original.height;
  displayCanvas._sourceImage = original;

  const initial = autoDetectCorners(original);
  const editor = attachCornerPicker(displayCanvas, initial, () => {});
  state[side].alignEditor = editor;

  document.getElementById(resetBtnId).onclick = () => {
    editor.setCorners(autoDetectCorners(original));
  };
}

document.getElementById('confirm-align-btn').addEventListener('click', () => {
  ['front', 'back'].forEach((side) => {
    const corners = state[side].alignEditor.getCorners();
    state[side].canvas = warpQuadToRect(state[side].original, corners);
  });

  document.getElementById('panel-centering').hidden = false;
  document.getElementById('panel-xray').hidden = false;
  document.getElementById('panel-analyze').hidden = false;

  setupCentering('front', 'front-centering-canvas', 'front-ratio-lr', 'front-ratio-tb', 'front-reset-btn');
  setupCentering('back', 'back-centering-canvas', 'back-ratio-lr', 'back-ratio-tb', 'back-reset-btn');
  setupXray();
});

// ---- Centering ----
function setupCentering(side, canvasId, lrId, tbId, resetBtnId) {
  const displayCanvas = document.getElementById(canvasId);
  const workingCanvas = state[side].canvas;
  displayCanvas.width = workingCanvas.width;
  displayCanvas.height = workingCanvas.height;
  displayCanvas._sourceImage = workingCanvas;

  const lrEl = document.getElementById(lrId);
  const tbEl = document.getElementById(tbId);

  function updateRatioDisplay(borders) {
    const ratios = computeRatios(borders);
    state[side].ratios = ratios;
    lrEl.textContent = ratios.lrText;
    tbEl.textContent = ratios.tbText;
  }

  const initialBorders = autoDetectBorders(workingCanvas);
  const editor = attachBorderEditor(displayCanvas, initialBorders, updateRatioDisplay);
  state[side].centeringEditor = editor;
  updateRatioDisplay(initialBorders);

  document.getElementById(resetBtnId).onclick = () => {
    editor.setBorders(autoDetectBorders(workingCanvas));
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
  const canvas = state[state.xraySide]?.canvas;
  if (!canvas) return;
  const vals = currentSliderValues();
  const normal = applyAdjustments(canvas, { ...vals, enhance: false });
  const enhanced = applyAdjustments(canvas, { ...vals, enhance: true });

  if (!state.compareSlider) {
    state.compareSlider = createCompareSlider(document.getElementById('compare-container'), normal, enhanced);
  } else {
    state.compareSlider.updateImages(normal, enhanced);
  }
}

function setupXray() {
  refreshXray();
}

document.querySelectorAll('.xray-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.xray-btn').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.xraySide = btn.dataset.side;
    refreshXray();
  });
});

['brightness-slider', 'contrast-slider', 'exposure-slider'].forEach((id) => {
  document.getElementById(id).addEventListener('input', refreshXray);
});

// ---- Analyze ----
document.getElementById('analyze-btn').addEventListener('click', async () => {
  const errorEl = document.getElementById('analyze-error');
  const loadingEl = document.getElementById('analyze-loading');
  errorEl.hidden = true;
  errorEl.textContent = '';

  if (!state.front || !state.back) {
    errorEl.textContent = t('upload_both_error');
    errorEl.hidden = false;
    return;
  }

  loadingEl.hidden = false;
  document.getElementById('analyze-btn').disabled = true;

  try {
    const frontOuter = state.front.centeringEditor.getBorders().outer;
    const backOuter = state.back.centeringEditor.getBorders().outer;
    const frontCrops = generateCornerCrops(state.front.canvas, frontOuter);
    const backCrops = generateCornerCrops(state.back.canvas, backOuter);

    const payload = {
      game: state.game,
      cardName: document.getElementById('card-name').value.trim(),
      setName: document.getElementById('set-name').value.trim(),
      cardNumber: document.getElementById('card-number').value.trim(),
      centeringFrontRatio: state.front.ratios.scoringText,
      centeringBackRatio: state.back.ratios.scoringText,
      images: {
        frontFull: canvasToDataUrl(state.front.canvas),
        backFull: canvasToDataUrl(state.back.canvas),
        frontCorners: frontCrops.map((c) => c.dataUrl),
        backCorners: backCrops.map((c) => c.dataUrl),
        frontThumb: makeThumbnailDataUrl(state.front.canvas),
      },
    };

    const result = await analyzeCard(payload);
    state.lastResult = result;

    renderResultsDashboard(document.getElementById('results-container'), result, {
      front: state.front.canvas,
      back: state.back.canvas,
      frontBounds: frontOuter,
      backBounds: backOuter,
    });
    document.getElementById('save-section').hidden = false;
    document.getElementById('save-status').textContent = '';
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  } finally {
    loadingEl.hidden = true;
    document.getElementById('analyze-btn').disabled = false;
  }
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
  if (!state.lastResult) return;

  const btn = document.getElementById('save-image-btn');
  btn.disabled = true;
  statusEl.textContent = t('saving_image');

  try {
    const now = new Date();
    const timestamp = now.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    const frontBorders = state.front.centeringEditor.getBorders();
    const backBorders = state.back.centeringEditor.getBorders();

    const reportCanvas = await generateReportImage({
      game: state.game,
      cardName: document.getElementById('card-name').value.trim(),
      setName: document.getElementById('set-name').value.trim(),
      cardNumber: document.getElementById('card-number').value.trim(),
      frontCanvas: state.front.canvas,
      backCanvas: state.back.canvas,
      frontBorders,
      backBorders,
      frontCardBounds: frontBorders.outer,
      backCardBounds: backBorders.outer,
      centering: state.lastResult.centering,
      cornersScore: state.lastResult.corners_score,
      surfaceScore: state.lastResult.surface_score,
      edgesScore: state.lastResult.edges_score,
      companies: state.lastResult.companies,
      defects: state.lastResult.defects,
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
  if (!state.lastResult) return;
  renderResultsDashboard(document.getElementById('results-container'), state.lastResult, {
    front: state.front.canvas,
    back: state.back.canvas,
    frontBounds: state.front.centeringEditor.getBorders().outer,
    backBounds: state.back.centeringEditor.getBorders().outer,
  });
});
