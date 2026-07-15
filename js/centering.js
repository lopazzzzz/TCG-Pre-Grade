// Geometric centering measurement.
//
// Assumption (stated to the user in the UI): the uploaded photo is a
// reasonably tight, frame-filling shot of the card, front-on, not at an
// angle — the same assumption every centering-measurement tool (including
// Rawlity, referenced by the user) relies on. Under that assumption, the
// card's own outer edge is approximately the image's outer edge, so we only
// need to find the INNER printed border line (the transition from the
// solid-color border frame to the artwork) on each of the 4 sides — that's
// a real, detectable contrast edge, unlike trying to segment the physical
// card from an arbitrary background.
//
// Auto-detection is a starting point, not the final word: the UI overlays 4
// draggable lines so the user can correct any side the algorithm gets wrong
// (glare, holo pattern, full-art card with no solid border, etc).

function luminance(data, i) {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

// Scans a band near one edge and returns the fractional position (0-1) of
// the strongest brightness transition, restricted to a plausible border
// width range so it doesn't just find the card's own outer edge.
function detectEdgeFraction(imageData, width, height, side) {
  const searchMin = 0.02; // skip the first ~2% (anti-alias/photo edge noise)
  const searchMax = 0.30; // borders are essentially never more than ~30% of the dimension

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

  const from = side === 'right' || side === 'bottom';
  let bestPos = Math.floor(scanLength * searchMin);
  let bestGrad = -1;

  // A real border-to-artwork transition is almost always the FIRST strong
  // edge encountered scanning inward from the physical edge — an internal
  // artwork element farther in can have a bigger raw contrast jump (e.g. a
  // bright illustration detail) but that's not the border. So take the
  // first transition that clears a confident threshold, and only fall back
  // to the single strongest transition in range if nothing clears it (e.g.
  // a low-contrast/pastel border).
  const STRONG_GRADIENT = 18; // luminance units between adjacent sample positions
  let firstStrongPos = null;

  const lo = Math.floor(scanLength * searchMin);
  const hi = Math.floor(scanLength * searchMax);
  for (let p = lo + 1; p < hi; p++) {
    const pos = from ? scanLength - 1 - p : p;
    const prev = from ? pos + 1 : pos - 1;
    if (prev < 0 || prev >= scanLength) continue;
    const grad = Math.abs(profile[pos] - profile[prev]);
    if (grad > bestGrad) {
      bestGrad = grad;
      bestPos = pos;
    }
    if (firstStrongPos === null && grad >= STRONG_GRADIENT) {
      firstStrongPos = pos;
    }
  }

  return (firstStrongPos !== null ? firstStrongPos : bestPos) / scanLength;
}

export function autoDetectBorders(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);

  return {
    // detectEdgeFraction already returns an absolute position (0=left/top
    // edge of the image), regardless of which direction it scanned from —
    // do not re-invert the right/bottom results here.
    left: detectEdgeFraction(imageData, width, height, 'left'),
    right: detectEdgeFraction(imageData, width, height, 'right'),
    top: detectEdgeFraction(imageData, width, height, 'top'),
    bottom: detectEdgeFraction(imageData, width, height, 'bottom'),
  };
}

function ratioFromMargins(marginA, marginB) {
  const total = marginA + marginB;
  if (total <= 0) return { a: 50, b: 50 };
  const a = Math.round((marginA / total) * 100);
  return { a, b: 100 - a };
}

// borders: fractional {left, right, top, bottom} positions (0-1) of the
// inner border lines within the image.
export function computeRatios(borders) {
  const leftMargin = borders.left;
  const rightMargin = 1 - borders.right;
  const topMargin = borders.top;
  const bottomMargin = 1 - borders.bottom;

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

// Interactive 4-line overlay over a canvas. `getBorders`/`setBorders` use
// fractional coordinates (0-1) so it's resolution independent.
export function attachBorderEditor(canvas, initialBorders, onChange) {
  let borders = { ...initialBorders };
  const HIT_PX = 14;

  function draw() {
    const ctx = canvas.getContext('2d');
    const img = canvas._sourceImage;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.strokeStyle = '#ffce45';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);

    const x1 = borders.left * canvas.width;
    const x2 = borders.right * canvas.width;
    const y1 = borders.top * canvas.height;
    const y2 = borders.bottom * canvas.height;

    ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(canvas.width, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y2); ctx.lineTo(canvas.width, y2); ctx.stroke();
    ctx.restore();
  }

  function nearestLine(px, py) {
    const x1 = borders.left * canvas.width;
    const x2 = borders.right * canvas.width;
    const y1 = borders.top * canvas.height;
    const y2 = borders.bottom * canvas.height;
    const candidates = [
      { key: 'left', dist: Math.abs(px - x1) },
      { key: 'right', dist: Math.abs(px - x2) },
      { key: 'top', dist: Math.abs(py - y1) },
      { key: 'bottom', dist: Math.abs(py - y2) },
    ];
    candidates.sort((a, b) => a.dist - b.dist);
    return candidates[0].dist <= HIT_PX ? candidates[0].key : null;
  }

  let dragging = null;

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
    if (dragging) canvas.setPointerCapture(evt.pointerId);
  });

  canvas.addEventListener('pointermove', (evt) => {
    if (!dragging) return;
    const { x, y } = pointerPos(evt);
    const fx = Math.min(0.49, Math.max(0.01, x / canvas.width));
    const fy = Math.min(0.49, Math.max(0.01, y / canvas.height));
    if (dragging === 'left') borders.left = Math.min(fx, borders.right - 0.02);
    if (dragging === 'right') borders.right = Math.max(1 - fx, borders.left + 0.02);
    if (dragging === 'top') borders.top = Math.min(fy, borders.bottom - 0.02);
    if (dragging === 'bottom') borders.bottom = Math.max(1 - fy, borders.top + 0.02);
    draw();
    onChange(borders);
  });

  ['pointerup', 'pointercancel'].forEach((evtName) => {
    canvas.addEventListener(evtName, () => { dragging = null; });
  });

  draw();

  return {
    getBorders: () => ({ ...borders }),
    setBorders: (next) => { borders = { ...next }; draw(); onChange(borders); },
    redraw: draw,
  };
}
