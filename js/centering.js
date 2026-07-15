// Geometric centering measurement.
//
// Real centering is the position of the INNER printed border (the frame
// around the artwork) relative to the card's own OUTER physical edge — not
// relative to the photo frame. Many real-world photos leave some background
// visible around the card, so we detect both edges in two stages:
//   1. OUTER: the card-vs-background edge, searched near the photo's own
//      boundary (a strong, usually high-contrast transition).
//   2. INNER: the border-to-artwork edge, searched only within the outer
//      card region found in stage 1 (so it can't accidentally lock onto the
//      outer edge itself, or onto some contrasty spot deep in the artwork).
// Both lines are drawn and are independently draggable, so a user can
// correct either one if the auto-detection gets confused (glare, holo
// pattern, full-art card with no solid border, etc).

import { createLoupe } from './loupe.js';

function luminance(data, i) {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

// Detects a brightness transition for `side` within the absolute pixel
// window [loPx, hiPx). Scans from the edge nearest to that window's outer
// boundary inward (so "first strong transition encountered" means "nearest
// to the outside"), using a windowed gradient (average of a few samples
// ahead vs. behind) rather than a single-pixel diff, since holo/foil
// textures and print noise create single-pixel spikes a naive diff would
// mistake for a real edge. Returns a fraction of the full dimension (0-1).
function detectTransition(imageData, width, height, side, loPx, hiPx) {
  const isHorizontalScan = side === 'left' || side === 'right';
  const scanLength = isHorizontalScan ? width : height;
  const stripStart = isHorizontalScan ? Math.floor(height * 0.4) : Math.floor(width * 0.4);
  const stripEnd = isHorizontalScan ? Math.ceil(height * 0.6) : Math.ceil(width * 0.6);

  const profile = new Float64Array(scanLength);
  for (let p = 0; p < scanLength; p++) {
    let sum = 0;
    let count = 0;
    for (let s = stripStart; s < stripEnd; s++) {
      const x = isHorizontalScan ? p : s;
      const y = isHorizontalScan ? s : p;
      const idx = (y * width + x) * 4;
      sum += luminance(imageData.data, idx);
      count++;
    }
    profile[p] = sum / count;
  }

  const WINDOW = 3;
  function windowedGradient(pos) {
    let before = 0, beforeN = 0, after = 0, afterN = 0;
    for (let k = 1; k <= WINDOW; k++) {
      if (pos - k >= 0) { before += profile[pos - k]; beforeN++; }
      if (pos + k < scanLength) { after += profile[pos + k]; afterN++; }
    }
    if (!beforeN || !afterN) return 0;
    return Math.abs(after / afterN - before / beforeN);
  }

  const from = side === 'right' || side === 'bottom'; // near edge is the "hi" side
  const lo = Math.max(0, Math.floor(loPx));
  const hi = Math.min(scanLength, Math.ceil(hiPx));
  const STRONG_GRADIENT = 22;

  let bestPos = from ? Math.max(lo, hi - 1) : lo;
  let bestGrad = -1;
  let firstStrongPos = null;

  if (from) {
    for (let pos = hi - 1; pos >= lo; pos--) {
      const grad = windowedGradient(pos);
      if (grad > bestGrad) { bestGrad = grad; bestPos = pos; }
      if (firstStrongPos === null && grad >= STRONG_GRADIENT) firstStrongPos = pos;
    }
  } else {
    for (let pos = lo; pos < hi; pos++) {
      const grad = windowedGradient(pos);
      if (grad > bestGrad) { bestGrad = grad; bestPos = pos; }
      if (firstStrongPos === null && grad >= STRONG_GRADIENT) firstStrongPos = pos;
    }
  }

  return (firstStrongPos !== null ? firstStrongPos : bestPos) / scanLength;
}

export function autoDetectBorders(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);

  // Stage 1 — outer card edge vs. background, searched near the photo edge.
  const outer = {
    left: detectTransition(imageData, width, height, 'left', width * 0.01, width * 0.45),
    right: detectTransition(imageData, width, height, 'right', width * 0.55, width * 0.99),
    top: detectTransition(imageData, width, height, 'top', height * 0.01, height * 0.45),
    bottom: detectTransition(imageData, width, height, 'bottom', height * 0.55, height * 0.99),
  };

  // Stage 2 — inner printed border, searched only within the outer card
  // region (as a fraction of the CARD's own width/height, not the photo's).
  const cardWPx = (outer.right - outer.left) * width;
  const cardHPx = (outer.bottom - outer.top) * height;
  const inner = {
    left: detectTransition(imageData, width, height, 'left', outer.left * width + cardWPx * 0.01, outer.left * width + cardWPx * 0.32),
    right: detectTransition(imageData, width, height, 'right', outer.right * width - cardWPx * 0.32, outer.right * width - cardWPx * 0.01),
    top: detectTransition(imageData, width, height, 'top', outer.top * height + cardHPx * 0.01, outer.top * height + cardHPx * 0.32),
    bottom: detectTransition(imageData, width, height, 'bottom', outer.bottom * height - cardHPx * 0.32, outer.bottom * height - cardHPx * 0.01),
  };

  return { outer, inner };
}

function ratioFromMargins(marginA, marginB) {
  const total = marginA + marginB;
  if (total <= 0) return { a: 50, b: 50 };
  const a = Math.round((marginA / total) * 100);
  return { a, b: 100 - a };
}

// borders: { outer, inner }, each fractional {left, right, top, bottom}
// positions (0-1) within the full image. Centering is the inner border's
// position relative to the OUTER card edges, not the raw photo edges.
export function computeRatios(borders) {
  const { outer, inner } = borders;
  const leftMargin = inner.left - outer.left;
  const rightMargin = outer.right - inner.right;
  const topMargin = inner.top - outer.top;
  const bottomMargin = outer.bottom - inner.bottom;

  const lr = ratioFromMargins(leftMargin, rightMargin);
  const tb = ratioFromMargins(topMargin, bottomMargin);

  const lrMetric = Math.max(lr.a, lr.b);
  const tbMetric = Math.max(tb.a, tb.b);
  const worse = lrMetric >= tbMetric ? { text: `${lr.a}/${lr.b}`, metric: lrMetric, axis: 'lr' } : { text: `${tb.a}/${tb.b}`, metric: tbMetric, axis: 'tb' };

  return {
    lrText: `${lr.a}/${lr.b}`,
    tbText: `${tb.a}/${tb.b}`,
    scoringText: worse.text,
    scoringAxis: worse.axis,
  };
}

const OUTER_COLOR = '#00e5ff';
const INNER_COLOR = '#ff2ea6';

// Interactive dual 4-line overlay (outer card edge + inner printed border)
// over a canvas. `getBorders`/`setBorders` use fractional coordinates (0-1)
// so it's resolution independent.
export function attachBorderEditor(canvas, initialBorders, onChange) {
  let borders = {
    outer: { ...initialBorders.outer },
    inner: { ...initialBorders.inner },
  };
  const HIT_PX = 16;

  function drawSet(ctx, b, color, lineWidth, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dash);
    const x1 = b.left * canvas.width;
    const x2 = b.right * canvas.width;
    const y1 = b.top * canvas.height;
    const y2 = b.bottom * canvas.height;
    ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(canvas.width, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y2); ctx.lineTo(canvas.width, y2); ctx.stroke();
    ctx.restore();
  }

  function draw() {
    const ctx = canvas.getContext('2d');
    const img = canvas._sourceImage;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    drawSet(ctx, borders.outer, OUTER_COLOR, 2, [6, 4]);
    drawSet(ctx, borders.inner, INNER_COLOR, 3, [3, 3]);
  }

  function nearestLine(px, py) {
    const candidates = [];
    for (const set of ['outer', 'inner']) {
      const b = borders[set];
      const x1 = b.left * canvas.width, x2 = b.right * canvas.width;
      const y1 = b.top * canvas.height, y2 = b.bottom * canvas.height;
      candidates.push({ set, key: 'left', dist: Math.abs(px - x1) });
      candidates.push({ set, key: 'right', dist: Math.abs(px - x2) });
      candidates.push({ set, key: 'top', dist: Math.abs(py - y1) });
      candidates.push({ set, key: 'bottom', dist: Math.abs(py - y2) });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    return candidates[0].dist <= HIT_PX ? candidates[0] : null;
  }

  let dragging = null;
  const loupe = createLoupe();

  function pointerPos(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (canvas.width / rect.width),
      y: (evt.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  canvas.addEventListener('pointerdown', (evt) => {
    const { x, y } = pointerPos(evt);
    dragging = nearestLine(x, y);
    if (dragging) {
      canvas.setPointerCapture(evt.pointerId);
      loupe.show(evt.clientX, evt.clientY, canvas, x, y);
    }
  });

  canvas.addEventListener('pointermove', (evt) => {
    if (!dragging) return;
    const { x, y } = pointerPos(evt);
    // Each line's own fraction tracks the pointer directly (clamped only to
    // stay a hair inside the canvas edge and not cross its opposite line) —
    // previously right/bottom reused the left/top fraction mirrored via
    // `1 - fx`, which both capped how close the line could get to the true
    // edge and made it drag backwards relative to the pointer.
    const fx = x / canvas.width;
    const fy = y / canvas.height;
    const b = borders[dragging.set];
    if (dragging.key === 'left') b.left = Math.min(Math.max(fx, 0.01), b.right - 0.02);
    if (dragging.key === 'right') b.right = Math.max(Math.min(fx, 0.99), b.left + 0.02);
    if (dragging.key === 'top') b.top = Math.min(Math.max(fy, 0.01), b.bottom - 0.02);
    if (dragging.key === 'bottom') b.bottom = Math.max(Math.min(fy, 0.99), b.top + 0.02);
    draw();
    onChange(borders);
    loupe.show(evt.clientX, evt.clientY, canvas, x, y);
  });

  ['pointerup', 'pointercancel'].forEach((evtName) => {
    canvas.addEventListener(evtName, () => { dragging = null; loupe.hide(); });
  });

  draw();

  return {
    getBorders: () => ({ outer: { ...borders.outer }, inner: { ...borders.inner } }),
    setBorders: (next) => {
      borders = { outer: { ...next.outer }, inner: { ...next.inner } };
      draw();
      onChange(borders);
    },
    redraw: draw,
  };
}
