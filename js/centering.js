// Geometric centering measurement.
//
// Real centering is the position of the INNER printed border (the frame
// around the artwork) relative to the card's own OUTER physical edge.
// The outer line defaults to the canvas boundary itself (0/1) rather than
// being auto-detected from image content: Step 3's alignment warps the
// user-chosen corners to fill the output canvas exactly, so by
// construction the card's physical edge already IS the canvas edge here
// (barring an imprecise Step 3 drag). There is no reliable way to tell
// "leftover background margin" apart from "the card's own uniform border
// design" from image content alone — both read as equally low detail
// density — so rather than guess wrong, this trusts the alignment step.
// The outer line stays fully manually draggable as a safety net for the
// rare case Step 3 left real residual margin.
//
// The inner (border-to-artwork) line IS auto-detected, searched as a
// fraction of the card's own width/height from each edge inward, since
// that transition (uniform border -> detailed artwork) is a much more
// reliable signal than "is there background here at all."

import { createLoupe } from './loupe.js';
import { buildDensityProfile, findContentEdge } from './edgeDetect.js';

export function autoDetectBorders(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const profileX = buildDensityProfile(imageData, width, height, true);
  const profileY = buildDensityProfile(imageData, width, height, false);

  const outer = { left: 0, right: 1, top: 0, bottom: 1 };

  const inner = {
    left: findContentEdge(profileX, true, width * 0.01, width * 0.32) / width,
    right: findContentEdge(profileX, false, width * 0.68, width * 0.99) / width,
    top: findContentEdge(profileY, true, height * 0.01, height * 0.32) / height,
    bottom: findContentEdge(profileY, false, height * 0.68, height * 0.99) / height,
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
  // Expressed in target CSS px, converted to the canvas's internal pixel
  // space at use time — a fixed internal-pixel tolerance/line-width shrinks
  // to a much smaller, harder-to-tap target on phones, where the canvas is
  // displayed at a fraction of its internal resolution.
  const HIT_CSS_PX = 30;

  function cssToInternalScale() {
    const rect = canvas.getBoundingClientRect();
    return rect.width ? canvas.width / rect.width : 1;
  }

  // Thin lines rather than thick ones — bulky lines were hard to read
  // against the card art underneath. A small solid "grip" dot at each
  // line's midpoint gives a clear, deliberate grab target instead, while
  // the actual hit-test tolerance (see nearestLine) stays generous along
  // the whole line, not just at the dot.
  function drawSet(ctx, b, color, lineWidthCssPx, dash, scale) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidthCssPx * scale;
    ctx.setLineDash(dash.map((v) => v * scale));
    const x1 = b.left * canvas.width;
    const x2 = b.right * canvas.width;
    const y1 = b.top * canvas.height;
    const y2 = b.bottom * canvas.height;
    ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(canvas.width, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y2); ctx.lineTo(canvas.width, y2); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1 * scale;
    const dotR = 5 * scale;
    const midY = canvas.height * 0.5;
    const midX = canvas.width * 0.5;
    [[x1, midY], [x2, midY], [midX, y1], [midX, y2]].forEach(([dx, dy]) => {
      ctx.beginPath();
      ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  }

  function draw() {
    const ctx = canvas.getContext('2d');
    const img = canvas._sourceImage;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const scale = cssToInternalScale();
    drawSet(ctx, borders.outer, OUTER_COLOR, 1.25, [6, 4], scale);
    drawSet(ctx, borders.inner, INNER_COLOR, 1.5, [3, 3], scale);
  }

  function nearestLine(px, py) {
    const hitPx = HIT_CSS_PX * cssToInternalScale();
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
    return candidates[0].dist <= hitPx ? candidates[0] : null;
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
    // Each line's own fraction tracks the pointer directly, bounded only by
    // its opposite line (never fully 0-width) — previously right/bottom
    // reused the left/top fraction mirrored via `1 - fx`, which both made it
    // drag backwards relative to the pointer AND, separately, the bound was
    // clamped to [0.01, 0.99] on all 4 lines. That 1% margin looked harmless
    // but after Step 3's alignment the card fills the canvas edge-to-edge
    // (zero background margin), so the true outer edge sits right at 0/1 —
    // the old margin made it permanently impossible to drag a line there.
    const fx = x / canvas.width;
    const fy = y / canvas.height;
    const b = borders[dragging.set];
    if (dragging.key === 'left') b.left = Math.min(Math.max(fx, 0), b.right - 0.02);
    if (dragging.key === 'right') b.right = Math.max(Math.min(fx, 1), b.left + 0.02);
    if (dragging.key === 'top') b.top = Math.min(Math.max(fy, 0), b.bottom - 0.02);
    if (dragging.key === 'bottom') b.bottom = Math.max(Math.min(fy, 1), b.top + 0.02);
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
