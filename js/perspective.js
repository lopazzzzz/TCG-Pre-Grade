// 4-corner perspective correction.
//
// A rotated photo is a simple in-plane rotation, but a photo taken from any
// angle other than straight overhead makes the card look like a trapezoid,
// not just a tilted rectangle — a plain "straighten" slider cannot fix that.
// This lets the user drag the 4 corners onto the card's actual corners in
// the photo (however skewed) and warps that quadrilateral back into a clean
// rectangle before any measurement happens.
//
// Implementation: canvas 2D only supports affine transforms (no true
// perspective divide), so the source quad is subdivided into a fine grid via
// bilinear interpolation of its 4 corners, and each small grid cell is drawn
// as 2 triangles using a closed-form 3-point affine transform per triangle.
// For the mild, smooth distortion of a hand-photographed flat card this is
// visually indistinguishable from a true homography.

import { createLoupe } from './loupe.js';
import { detectContentBoundingBox } from './edgeDetect.js';

function solve3x3(A, bVec) {
  const M = A.map((row, i) => [...row, bVec[i]]);
  for (let col = 0; col < 3; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
    const pivotVal = M[col][col];
    for (let k = col; k < 4; k++) M[col][k] /= pivotVal;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let k = col; k < 4; k++) M[r][k] -= factor * M[col][k];
    }
  }
  return [M[0][3], M[1][3], M[2][3]];
}

// Solves X = a*x + b*y + c, Y = d*x + e*y + f from 3 point correspondences.
function affineFromPoints(src, dst) {
  const A = src.map((p) => [p.x, p.y, 1]);
  const [a, b, c] = solve3x3(A, dst.map((p) => p.x));
  const [d, e, f] = solve3x3(A, dst.map((p) => p.y));
  return { a, b, c, d, e, f };
}

function drawTriangle(ctx, source, srcTri, dstTri) {
  const { a, b, c, d, e, f } = affineFromPoints(srcTri, dstTri);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dstTri[0].x, dstTri[0].y);
  ctx.lineTo(dstTri[1].x, dstTri[1].y);
  ctx.lineTo(dstTri[2].x, dstTri[2].y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, d, b, e, c, f);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}

function dist(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

// corners: { tl, tr, bl, br }, each {x, y} in source pixel coordinates.
// Output size is derived from the quad's own average edge lengths so the
// corrected image keeps the proportions the user actually framed.
export function warpQuadToRect(source, corners, gridSize = 12) {
  const { tl, tr, bl, br } = corners;
  const outWidth = Math.round((dist(tl, tr) + dist(bl, br)) / 2);
  const outHeight = Math.round((dist(tl, bl) + dist(tr, br)) / 2);

  const out = document.createElement('canvas');
  out.width = Math.max(1, outWidth);
  out.height = Math.max(1, outHeight);
  const ctx = out.getContext('2d');

  function bilinear(u, v) {
    const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u };
    const bottom = { x: bl.x + (br.x - bl.x) * u, y: bl.y + (br.y - bl.y) * u };
    return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
  }

  for (let j = 0; j < gridSize; j++) {
    for (let i = 0; i < gridSize; i++) {
      const u0 = i / gridSize, u1 = (i + 1) / gridSize;
      const v0 = j / gridSize, v1 = (j + 1) / gridSize;

      const srcTL = bilinear(u0, v0), srcTR = bilinear(u1, v0);
      const srcBL = bilinear(u0, v1), srcBR = bilinear(u1, v1);

      const dstTL = { x: u0 * out.width, y: v0 * out.height };
      const dstTR = { x: u1 * out.width, y: v0 * out.height };
      const dstBL = { x: u0 * out.width, y: v1 * out.height };
      const dstBR = { x: u1 * out.width, y: v1 * out.height };

      drawTriangle(ctx, source, [srcTL, srcTR, srcBL], [dstTL, dstTR, dstBL]);
      drawTriangle(ctx, source, [srcTR, srcBR, srcBL], [dstTR, dstBR, dstBL]);
    }
  }

  return out;
}

export function defaultCorners(width, height) {
  const insetX = width * 0.04;
  const insetY = height * 0.04;
  return {
    tl: { x: insetX, y: insetY },
    tr: { x: width - insetX, y: insetY },
    bl: { x: insetX, y: height - insetY },
    br: { x: width - insetX, y: height - insetY },
  };
}

// Auto-detects the card's rough axis-aligned bounding box in the raw
// (un-aligned, possibly skewed) photo so the initial 4 corner points start
// on the card's actual edges instead of a generic 4%-inset guess. This is
// still axis-aligned — it doesn't detect rotation/perspective — so a
// skewed photo still needs the corners dragged into place manually, but a
// roughly straight-on photo (the common case) needs no manual adjustment
// at all now. Falls back to the generic inset if detection looks
// degenerate (e.g. a card that fills the whole frame with no margin, or a
// background too busy to tell apart from the card).
export function autoDetectCorners(canvas) {
  const box = detectContentBoundingBox(canvas);
  const width = canvas.width;
  const height = canvas.height;
  const looksValid = box.right - box.left > 0.1 && box.bottom - box.top > 0.1
    && box.left < box.right && box.top < box.bottom;
  if (!looksValid) return defaultCorners(width, height);

  return {
    tl: { x: box.left * width, y: box.top * height },
    tr: { x: box.right * width, y: box.top * height },
    bl: { x: box.left * width, y: box.bottom * height },
    br: { x: box.right * width, y: box.bottom * height },
  };
}

// Interactive 4-point draggable overlay for picking the card's corners on
// `canvas` (which must have canvas._sourceImage set to the image/canvas to
// display and warp).
export function attachCornerPicker(canvas, initialCorners, onChange) {
  let corners = {
    tl: { ...initialCorners.tl }, tr: { ...initialCorners.tr },
    bl: { ...initialCorners.bl }, br: { ...initialCorners.br },
  };
  // Hit tolerance and dot radius are expressed in target CSS px and
  // converted to the canvas's internal pixel space at use time — a fixed
  // internal-pixel radius shrinks to a much smaller, harder-to-tap target
  // on phones, where the canvas is displayed at a fraction of its internal
  // resolution (touch needs a comfortably large target; a mouse cursor
  // doesn't need nearly as much).
  const HIT_CSS_PX = 34;
  const DOT_CSS_PX = 15;

  function cssToInternalScale() {
    const rect = canvas.getBoundingClientRect();
    return rect.width ? canvas.width / rect.width : 1;
  }

  function draw() {
    const ctx = canvas.getContext('2d');
    const img = canvas._sourceImage;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const scale = cssToInternalScale();
    ctx.save();
    ctx.strokeStyle = '#ffce45';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(corners.tl.x, corners.tl.y);
    ctx.lineTo(corners.tr.x, corners.tr.y);
    ctx.lineTo(corners.br.x, corners.br.y);
    ctx.lineTo(corners.bl.x, corners.bl.y);
    ctx.closePath();
    ctx.stroke();

    // Translucent fill + outline ring rather than a solid disc — the hit
    // target needs to stay big for touch, but a big solid circle hides the
    // exact card corner underneath it while dragging, right when precision
    // matters most. A small solid center dot keeps the exact anchor point
    // visible even through the translucent ring.
    Object.values(corners).forEach((p) => {
      const r = DOT_CSS_PX * scale;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 206, 69, 0.25)';
      ctx.fill();
      ctx.strokeStyle = '#ffce45';
      ctx.lineWidth = 2 * scale;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, r * 0.12), 0, Math.PI * 2);
      ctx.fillStyle = '#ffce45';
      ctx.fill();
    });
    ctx.restore();
  }

  function nearestCorner(px, py) {
    const hitPx = HIT_CSS_PX * cssToInternalScale();
    let best = null;
    let bestDist = Infinity;
    for (const key of ['tl', 'tr', 'bl', 'br']) {
      const d = dist(corners[key], { x: px, y: py });
      if (d < bestDist) { bestDist = d; best = key; }
    }
    return bestDist <= hitPx ? best : null;
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
    dragging = nearestCorner(x, y);
    if (dragging) {
      canvas.setPointerCapture(evt.pointerId);
      loupe.show(evt.clientX, evt.clientY, canvas, x, y);
    }
  });

  canvas.addEventListener('pointermove', (evt) => {
    if (!dragging) return;
    const { x, y } = pointerPos(evt);
    corners[dragging] = {
      x: Math.min(canvas.width, Math.max(0, x)),
      y: Math.min(canvas.height, Math.max(0, y)),
    };
    draw();
    onChange(corners);
    loupe.show(evt.clientX, evt.clientY, canvas, corners[dragging].x, corners[dragging].y);
  });

  ['pointerup', 'pointercancel'].forEach((evtName) => {
    canvas.addEventListener(evtName, () => { dragging = null; loupe.hide(); });
  });

  draw();

  return {
    getCorners: () => ({ ...corners }),
    setCorners: (next) => {
      corners = { tl: { ...next.tl }, tr: { ...next.tr }, bl: { ...next.bl }, br: { ...next.br } };
      draw();
      onChange(corners);
    },
  };
}
