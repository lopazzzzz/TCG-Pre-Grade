import { loadImageFromFile, toWorkingCanvas, canvasToDataUrl, generateCornerCrops, applyAdjustments, createCompareSlider } from './imageTools.js';
import { autoDetectBorders, computeRatios, attachBorderEditor } from './centering.js';
import { defaultCorners, attachCornerPicker, warpQuadToRect } from './perspective.js';
import { analyzeCard, renderResultsDashboard } from './grading.js';
import { generateReportImage, downloadCanvasAsImage } from './report.js';
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
function setupUpload(side, dropId, inputId, previewId) {
  const drop = document.getElementById(dropId);
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-dragover');
    if (e.dataTransfer.files[0]) handleFile(side, e.dataTransfer.files[0], preview);
  });
  input.addEventListener('change', () => {
    if (input.files[0]) handleFile(side, input.files[0], preview);
  });
}

async function handleFile(side, file, previewEl) {
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
}

setupUpload('front', 'front-drop', 'front-input', 'front-preview');
setupUpload('back', 'back-drop', 'back-input', 'back-preview');

// ---- Align (perspective correction) ----
function setupAlign(side, canvasId, resetBtnId) {
  const displayCanvas = document.getElementById(canvasId);
  const original = state[side].original;
  displayCanvas.width = original.width;
  displayCanvas.height = original.height;
  displayCanvas._sourceImage = original;

  const initial = defaultCorners(original.width, original.height);
  const editor = attachCornerPicker(displayCanvas, initial, () => {});
  state[side].alignEditor = editor;

  document.getElementById(resetBtnId).onclick = () => {
    editor.setCorners(defaultCorners(original.width, original.height));
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
    const frontCrops = generateCornerCrops(state.front.canvas);
    const backCrops = generateCornerCrops(state.back.canvas);

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
      },
    };

    const result = await analyzeCard(payload);
    state.lastResult = result;

    renderResultsDashboard(document.getElementById('results-container'), result, {
      front: state.front.canvas,
      back: state.back.canvas,
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
document.getElementById('save-image-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('save-status');
  if (!state.lastResult) return;

  const btn = document.getElementById('save-image-btn');
  btn.disabled = true;
  statusEl.textContent = t('saving_image');

  try {
    const now = new Date();
    const timestamp = now.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    const reportCanvas = await generateReportImage({
      game: state.game,
      cardName: document.getElementById('card-name').value.trim(),
      setName: document.getElementById('set-name').value.trim(),
      cardNumber: document.getElementById('card-number').value.trim(),
      frontCanvas: state.front.canvas,
      backCanvas: state.back.canvas,
      frontBorders: state.front.centeringEditor.getBorders(),
      backBorders: state.back.centeringEditor.getBorders(),
      centering: state.lastResult.centering,
      cornersScore: state.lastResult.corners_score,
      surfaceScore: state.lastResult.surface_score,
      edgesScore: state.lastResult.edges_score,
      companies: state.lastResult.companies,
      defects: state.lastResult.defects,
      timestamp,
    });

    const fileStamp = now.toISOString().replace(/[:.]/g, '-');
    downloadCanvasAsImage(reportCanvas, `cardify-pregrade-${fileStamp}.png`);
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
  });
});
