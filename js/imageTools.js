import { WORK_MAX_DIMENSION, CORNER_CROP_FRACTION } from './config.js';

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('image decode timed out')), ms)),
  ]);
}

// Reads via FileReader -> data URL rather than URL.createObjectURL — blob
// URLs backing an <img> src have a history of WebKit-specific bugs for Files
// sourced from a native photo/camera picker (the load silently never fires,
// neither onload nor onerror), whereas readAsDataURL is one of the oldest,
// most consistently-supported File API paths across mobile browsers.
function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) resolve(img);
        else reject(new Error('unreadable image file (zero dimensions)'));
      };
      img.onerror = () => reject(new Error('unreadable image file'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('could not read file'));
    reader.readAsDataURL(file);
  });
}

// Tries createImageBitmap first — it goes through the browser's native image
// decoder more directly, which some mobile browsers handle more reliably for
// certain formats. Falls back to the classic <img>-via-FileReader approach
// for browsers/formats where that isn't available. Some browsers don't
// reject createImageBitmap for a format they can't actually decode — they
// resolve with a degenerate (0x0) bitmap instead, or in rare cases never
// settle the promise at all — so a zero-dimension result and a hang are both
// treated the same as a thrown error and fall through to the <img> path.
export async function loadImageFromFile(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await withTimeout(createImageBitmap(file), 4000);
      if (bitmap.width > 0 && bitmap.height > 0) return bitmap;
    } catch {
      // fall through
    }
  }
  return withTimeout(loadImageElement(file), 8000);
}

// Draws the image onto a canvas at a capped working resolution, preserving
// aspect ratio, and returns the canvas. `img` may be an HTMLImageElement or
// an ImageBitmap (from loadImageFromFile above) — they expose the source
// size under different property names.
export function toWorkingCanvas(img, maxDim = WORK_MAX_DIMENSION) {
  const srcWidth = img.naturalWidth || img.width;
  const srcHeight = img.naturalHeight || img.height;
  const scale = Math.min(1, maxDim / Math.max(srcWidth, srcHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(srcWidth * scale);
  canvas.height = Math.round(srcHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  canvas._sourceImage = img;
  return canvas;
}

export function canvasToDataUrl(canvas, quality = 0.88) {
  return canvas.toDataURL('image/jpeg', quality);
}

// Small preview image (e.g. for the admin scan-log list) — resized down so
// embedding it directly in the log's metadata stays cheap.
export function makeThumbnailDataUrl(canvas, maxWidth = 160) {
  const scale = Math.min(1, maxWidth / canvas.width);
  const thumb = document.createElement('canvas');
  thumb.width = Math.round(canvas.width * scale);
  thumb.height = Math.round(canvas.height * scale);
  thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return canvasToDataUrl(thumb, 0.75);
}

const FULL_BOUNDS = { left: 0, right: 1, top: 0, bottom: 1 };

// Resolves fractional card bounds (as measured by centering.js's outer-edge
// detection) into an absolute pixel box within `canvas`. Defaults to the
// whole canvas when no bounds are given, so callers that don't have a
// measured card region (e.g. admin log playback) still work.
function cardBoxPx(canvas, bounds) {
  const b = bounds || FULL_BOUNDS;
  const x = b.left * canvas.width;
  const y = b.top * canvas.height;
  return { x, y, w: (b.right - b.left) * canvas.width, h: (b.bottom - b.top) * canvas.height };
}

// Generates 4 zoomed corner crops (dataURLs) from a working canvas, each
// covering CORNER_CROP_FRACTION of the CARD's own width/height (not the
// full canvas — a photo often has some background margin around the card,
// and cropping relative to the canvas edges in that case would grab mostly
// background instead of the card's actual corner), upscaled ~2.5x so the AI
// gets genuine close-up detail rather than a shrunk full card.
export function generateCornerCrops(canvas, cardBounds) {
  const box = cardBoxPx(canvas, cardBounds);
  const cw = Math.round(box.w * CORNER_CROP_FRACTION);
  const ch = Math.round(box.h * CORNER_CROP_FRACTION);
  const upscale = 2.5;

  const corners = [
    { key: 'tl', sx: box.x, sy: box.y },
    { key: 'tr', sx: box.x + box.w - cw, sy: box.y },
    { key: 'bl', sx: box.x, sy: box.y + box.h - ch },
    { key: 'br', sx: box.x + box.w - cw, sy: box.y + box.h - ch },
  ];

  return corners.map(({ key, sx, sy }) => {
    const crop = document.createElement('canvas');
    crop.width = Math.round(cw * upscale);
    crop.height = Math.round(ch * upscale);
    const ctx = crop.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, sx, sy, cw, ch, 0, 0, crop.width, crop.height);
    return { key, canvas: crop, dataUrl: canvasToDataUrl(crop) };
  });
}

// Applies brightness/contrast/exposure adjustments plus an optional
// high-contrast "surface enhance" pass (a rough stand-in for the raking-light
// X-ray view TAG uses) onto a fresh canvas, leaving the source untouched.
function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// Applies brightness/contrast (as multiplicative %, matching CSS filter
// semantics: 100% = unchanged) directly on the pixel buffer rather than via
// the canvas `filter` property — Safari/WebKit has a long history of
// unreliable or unsupported ctx.filter behavior on canvas (silently drawing
// the image unmodified), which would make the "enhanced" pass look
// identical to the normal one. Manual ImageData math has no such gap.
function applyPercentAdjustments(imageData, { brightnessPct, contrastPct, exposurePct, enhance }) {
  const d = imageData.data;
  const bF = brightnessPct / 100;
  const cF = contrastPct / 100;
  const eF = exposurePct / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * bF, g = d[i + 1] * bF, b = d[i + 2] * bF;
    r = (r - 128) * cF + 128; g = (g - 128) * cF + 128; b = (b - 128) * cF + 128;
    r *= eF; g *= eF; b *= eF;
    if (enhance) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = gray;
      r = (r - 128) * 2.2 + 128; g = (g - 128) * 2.2 + 128; b = (b - 128) * 2.2 + 128;
      r *= 1.15; g *= 1.15; b *= 1.15;
    }
    d[i] = clamp255(r); d[i + 1] = clamp255(g); d[i + 2] = clamp255(b);
  }
}

export function applyAdjustments(sourceCanvas, { brightness = 0, contrast = 0, exposure = 0, enhance = false }) {
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);

  const brightnessPct = 100 + brightness;
  const contrastPct = 100 + contrast;
  const exposurePct = 100 + exposure * 1.5;

  const imageData = ctx.getImageData(0, 0, out.width, out.height);
  applyPercentAdjustments(imageData, { brightnessPct, contrastPct, exposurePct, enhance });
  ctx.putImageData(imageData, 0, 0);
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
    const clipValue = `inset(0 ${100 - pct}% 0 0)`;
    overlay.style.clipPath = clipValue;
    overlay.style.webkitClipPath = clipValue;
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

const ZONE_CENTERS = {
  'top-left': [0.167, 0.167], 'top-center': [0.5, 0.167], 'top-right': [0.833, 0.167],
  'middle-left': [0.167, 0.5], 'center': [0.5, 0.5], 'middle-right': [0.833, 0.5],
  'bottom-left': [0.167, 0.833], 'bottom-center': [0.5, 0.833], 'bottom-right': [0.833, 0.833],
};

// Crops a zoomed-in region of `source` (a canvas or a loaded <img>) around
// the named 3x3-grid zone (measured relative to the card's own bounds, not
// the full source image, for the same reason as generateCornerCrops above)
// and draws a bold circle roughly marking the flagged spot. This is a
// zone-level approximation, not a pixel-precise defect locator — the AI
// names the nearest ninth of the card, not exact coordinates, so the circle
// is captioned as approximate.
export function cropZoneThumbnail(source, zone, cardBounds) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const box = cardBoxPx({ width: sw, height: sh }, cardBounds);
  const [zx, zy] = ZONE_CENTERS[zone] || ZONE_CENTERS.center;
  const cx = box.x + zx * box.w;
  const cy = box.y + zy * box.h;

  const cropFrac = 0.45;
  const cropW = box.w * cropFrac;
  const cropH = box.h * cropFrac;
  const sx = Math.min(Math.max(cx - cropW / 2, 0), sw - cropW);
  const sy = Math.min(Math.max(cy - cropH / 2, 0), sh - cropH);

  const upscale = 3;
  const out = document.createElement('canvas');
  out.width = Math.round(cropW * upscale);
  out.height = Math.round(cropH * upscale);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, cropW, cropH, 0, 0, out.width, out.height);

  // Two-tone ring (dark halo + bright core) so the marker stays visible
  // against any card art color/pattern, not just plain backgrounds — a thin
  // single-color dashed line was getting lost against busy holo/foil art.
  ctx.save();
  const rx = out.width * 0.32;
  const ry = out.height * 0.32;
  ctx.beginPath();
  ctx.ellipse(out.width / 2, out.height / 2, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = Math.max(11, out.width * 0.05);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(out.width / 2, out.height / 2, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#ff3b3b';
  ctx.lineWidth = Math.max(6, out.width * 0.028);
  ctx.stroke();
  ctx.restore();

  return canvasToDataUrl(out, 0.9);
}
