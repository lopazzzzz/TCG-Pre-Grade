import { WORK_MAX_DIMENSION, CORNER_CROP_FRACTION } from './config.js';

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// Draws the image onto a canvas at a capped working resolution, preserving
// aspect ratio, and returns the canvas.
export function toWorkingCanvas(img, maxDim = WORK_MAX_DIMENSION) {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  canvas._sourceImage = img;
  return canvas;
}

export function canvasToDataUrl(canvas, quality = 0.88) {
  return canvas.toDataURL('image/jpeg', quality);
}

// Generates 4 zoomed corner crops (dataURLs) from a working canvas, each
// covering CORNER_CROP_FRACTION of width/height, upscaled ~2.5x so Claude
// gets genuine close-up detail rather than a shrunk full card.
export function generateCornerCrops(canvas) {
  const { width, height } = canvas;
  const cw = Math.round(width * CORNER_CROP_FRACTION);
  const ch = Math.round(height * CORNER_CROP_FRACTION);
  const upscale = 2.5;

  const corners = [
    { key: 'tl', sx: 0, sy: 0 },
    { key: 'tr', sx: width - cw, sy: 0 },
    { key: 'bl', sx: 0, sy: height - ch },
    { key: 'br', sx: width - cw, sy: height - ch },
  ];

  return corners.map(({ key, sx, sy }) => {
    const crop = document.createElement('canvas');
    crop.width = Math.round(cw * upscale);
    crop.height = Math.round(ch * upscale);
    const ctx = crop.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, sx, sy, cw, ch, 0, 0, crop.width, crop.height);
    return { key, dataUrl: canvasToDataUrl(crop) };
  });
}

// Applies brightness/contrast/exposure adjustments plus an optional
// high-contrast "surface enhance" pass (a rough stand-in for the raking-light
// X-ray view TAG uses) onto a fresh canvas, leaving the source untouched.
export function applyAdjustments(sourceCanvas, { brightness = 0, contrast = 0, exposure = 0, enhance = false }) {
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const ctx = out.getContext('2d');

  const brightnessPct = 100 + brightness;
  const contrastPct = 100 + contrast;
  const exposurePct = 100 + exposure * 1.5;

  const filters = [`brightness(${brightnessPct}%)`, `contrast(${contrastPct}%)`, `brightness(${exposurePct}%)`];
  if (enhance) {
    filters.push('grayscale(100%)', 'contrast(220%)', 'brightness(115%)');
  }
  ctx.filter = filters.join(' ');
  ctx.drawImage(sourceCanvas, 0, 0);
  return out;
}

// Before/after compare slider: `normalCanvas` sits underneath, `enhancedCanvas`
// is clipped by a draggable vertical divider so the user can slide to reveal
// the enhanced ("X-ray") view over the normal photo.
export function createCompareSlider(container, normalCanvas, enhancedCanvas) {
  container.innerHTML = '';
  container.classList.add('compare-slider');

  const wrap = document.createElement('div');
  wrap.className = 'compare-slider__wrap';
  wrap.style.aspectRatio = `${normalCanvas.width} / ${normalCanvas.height}`;

  const baseImg = document.createElement('img');
  baseImg.src = canvasToDataUrl(normalCanvas, 0.9);
  baseImg.className = 'compare-slider__img compare-slider__img--base';

  const overlay = document.createElement('div');
  overlay.className = 'compare-slider__overlay';
  const overlayImg = document.createElement('img');
  overlayImg.src = canvasToDataUrl(enhancedCanvas, 0.9);
  overlayImg.className = 'compare-slider__img';
  overlay.appendChild(overlayImg);

  const handle = document.createElement('div');
  handle.className = 'compare-slider__handle';

  wrap.appendChild(baseImg);
  wrap.appendChild(overlay);
  wrap.appendChild(handle);
  container.appendChild(wrap);

  function setPosition(fraction) {
    const pct = Math.min(100, Math.max(0, fraction * 100));
    overlay.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    handle.style.left = `${pct}%`;
  }
  setPosition(0.5);

  function fractionFromEvent(evt) {
    const rect = wrap.getBoundingClientRect();
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    return (clientX - rect.left) / rect.width;
  }

  let dragging = false;
  wrap.addEventListener('pointerdown', (evt) => { dragging = true; setPosition(fractionFromEvent(evt)); });
  window.addEventListener('pointermove', (evt) => { if (dragging) setPosition(fractionFromEvent(evt)); });
  window.addEventListener('pointerup', () => { dragging = false; });

  function updateImages(nextNormalCanvas, nextEnhancedCanvas) {
    baseImg.src = canvasToDataUrl(nextNormalCanvas, 0.9);
    overlayImg.src = canvasToDataUrl(nextEnhancedCanvas, 0.9);
  }

  return { setPosition, updateImages };
}
