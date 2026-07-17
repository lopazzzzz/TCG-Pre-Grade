import { COMPANY_LABELS, GAME_LABELS } from './config.js';
import { generateCornerCrops, cropZoneThumbnail } from './imageTools.js';
import { t } from './i18n.js';

// WIDTH is wide enough that stacking front+back side-by-side (rather than
// one above the other) plus the stat rows and an enlarged flaws section
// lands close to a 1:1 square overall, instead of the old single-column
// layout's tall, narrow rectangle. Exact squareness still varies with how
// many flaws are found (more flaws needs more height) — this targets
// "roughly square for a typical card," not a hard-cropped fixed size.
const WIDTH = 1400;
const PAD = 36;
const COLORS = {
  bg: '#12182b',
  panel: '#181f33',
  border: '#c99a2e',
  text: '#f2f3f6',
  muted: '#9aa0ae',
  great: '#3ecb7e',
  good: '#6fa4ff',
  fair: '#f0b429',
  poor: '#ef5b56',
  outer: '#00e5ff',
  inner: '#ff2ea6',
};

const FULL_BOUNDS = { left: 0, right: 1, top: 0, bottom: 1 };

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Resolves fractional card bounds into an absolute pixel box within a
// canvas/image of the given width/height.
function boundsToPx(bounds, width, height) {
  const b = bounds || FULL_BOUNDS;
  return {
    x: b.left * width,
    y: b.top * height,
    w: (b.right - b.left) * width,
    h: (b.bottom - b.top) * height,
  };
}

function drawImageContain(ctx, img, dx, dy, dw, dh) {
  const scale = Math.min(dw / img.width, dh / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = dx + (dw - w) / 2;
  const y = dy + (dh - h) / 2;
  ctx.drawImage(img, x, y, w, h);
  return { x, y, w, h };
}

// Same as drawImageContain but draws only a source sub-rectangle (the
// detected card region) rather than the whole source image — a photo often
// has background margin around the card, and using the whole canvas here
// would show the card small in a sea of background instead of filling the
// frame.
function drawImageRegionContain(ctx, img, srcBox, dx, dy, dw, dh) {
  const scale = Math.min(dw / srcBox.w, dh / srcBox.h);
  const w = srcBox.w * scale;
  const h = srcBox.h * scale;
  const x = dx + (dw - w) / 2;
  const y = dy + (dh - h) / 2;
  ctx.drawImage(img, srcBox.x, srcBox.y, srcBox.w, srcBox.h, x, y, w, h);
  return { x, y, w, h };
}

// Draws the outer + inner centering guide lines, remapped from full-image
// fractions into the coordinate space of the (possibly cropped-to-card)
// drawn rect.
function drawCenteringGuides(ctx, rect, borders, cardBounds) {
  if (!borders) return;
  const cb = cardBounds || FULL_BOUNDS;
  const mapX = (frac) => rect.x + ((frac - cb.left) / (cb.right - cb.left)) * rect.w;
  const mapY = (frac) => rect.y + ((frac - cb.top) / (cb.bottom - cb.top)) * rect.h;

  function drawSet(b, color, lineWidth) {
    const x1 = mapX(b.left), x2 = mapX(b.right);
    const y1 = mapY(b.top), y2 = mapY(b.bottom);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(x1, rect.y); ctx.lineTo(x1, rect.y + rect.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, rect.y); ctx.lineTo(x2, rect.y + rect.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rect.x, y1); ctx.lineTo(rect.x + rect.w, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rect.x, y2); ctx.lineTo(rect.x + rect.w, y2); ctx.stroke();
    ctx.restore();
  }

  if (borders.outer) drawSet(borders.outer, 'rgba(0,229,255,0.9)', 2);
  if (borders.inner) drawSet(borders.inner, 'rgba(255,46,166,0.95)', 3);
}

function wrapLines(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const lines = wrapLines(ctx, text, maxWidth);
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  return y + lines.length * lineHeight;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function scoreColor(score) {
  if (score >= 9) return COLORS.great;
  if (score >= 7.5) return COLORS.good;
  if (score >= 6) return COLORS.fair;
  return COLORS.poor;
}

// Shared geometry for a card-side section, derived from the CARD region's
// own aspect ratio (not the full canvas, which may include background
// margin) so the main image fills its column width instead of being
// letterboxed by extra background. `sectionW` is passed explicitly (rather
// than assumed to be the full canvas width) since front/back sections now
// sit side-by-side, each occupying half the width.
function sectionLayout(canvas, cardBounds, sectionW) {
  const box = boundsToPx(cardBounds, canvas.width, canvas.height);
  const labelH = 34;
  const gap = 8;
  const cornerColW = sectionW * 0.24;
  const mainColW = sectionW - cornerColW * 2 - gap * 2;
  const mainColH = mainColW * (box.h / box.w);
  const cornerCellH = (mainColH - gap) / 2;
  return { sectionW, labelH, gap, cornerColW, mainColW, mainColH, cornerCellH, totalH: labelH + mainColH, box };
}

// Draws one card-side section (FRONT or BACK) at horizontal offset `x`:
// corner crops flanking the full image with centering guide lines
// overlaid, matching the layout of well-known pre-grade report generators
// but reusing our own crop/measure pipeline. Everything is cropped
// relative to the detected card bounds so a photo with background margin
// doesn't end up mostly showing background.
function drawCardSection(ctx, { label, x, y, sectionW, canvas, borders, cardBounds }) {
  const { labelH, gap, cornerColW, mainColW, mainColH, cornerCellH, box } = sectionLayout(canvas, cardBounds, sectionW);

  ctx.fillStyle = COLORS.border;
  ctx.font = 'bold 17px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + sectionW / 2, y + labelH - 10);

  const contentY = y + labelH;
  const leftX = x;
  const mainX = leftX + cornerColW + gap;
  const rightX = mainX + mainColW + gap;

  const crops = generateCornerCrops(canvas, cardBounds);
  const byKey = Object.fromEntries(crops.map((c) => [c.key, c]));

  function drawCropCell(img, cx, cy, captionKey) {
    roundRect(ctx, cx, cy, cornerColW, cornerCellH, 6);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(cx, cy, cornerColW, cornerCellH);
    drawImageContain(ctx, img, cx, cy, cornerColW, cornerCellH);
    // Caption drawn as an overlay strip INSIDE the cell (not below it) so it
    // can never be clipped/overlapped by the next cell's border.
    const stripH = 15;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(cx, cy + cornerCellH - stripH, cornerColW, stripH);
    ctx.fillStyle = '#fff';
    ctx.font = '8px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t(captionKey), cx + cornerColW / 2, cy + cornerCellH - stripH / 2 + 3);
    ctx.restore();
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    roundRect(ctx, cx, cy, cornerColW, cornerCellH, 6);
    ctx.stroke();
  }

  drawCropCell(byKey.tl.canvas, leftX, contentY, 'corner_tl');
  drawCropCell(byKey.bl.canvas, leftX, contentY + cornerCellH + gap, 'corner_bl');
  drawCropCell(byKey.tr.canvas, rightX, contentY, 'corner_tr');
  drawCropCell(byKey.br.canvas, rightX, contentY + cornerCellH + gap, 'corner_br');

  roundRect(ctx, mainX, contentY, mainColW, mainColH, 6);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#000';
  ctx.fillRect(mainX, contentY, mainColW, mainColH);
  const rect = drawImageRegionContain(ctx, canvas, box, mainX, contentY, mainColW, mainColH);
  drawCenteringGuides(ctx, rect, borders, cardBounds);
  ctx.restore();
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  roundRect(ctx, mainX, contentY, mainColW, mainColH, 6);
  ctx.stroke();
}

function drawStatBox(ctx, x, y, w, h, label, value, valueColor, sub) {
  roundRect(ctx, x, y, w, h, 8);
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = COLORS.muted;
  ctx.font = '12px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + 22);
  ctx.fillStyle = valueColor || COLORS.text;
  ctx.font = 'bold 26px -apple-system, sans-serif';
  ctx.fillText(value, x + w / 2, y + 52);
  if (sub) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText(sub, x + w / 2, y + 70);
  }
}

export async function generateReportImage({
  game, cardName, setName, cardNumber,
  frontCanvas, backCanvas,
  frontBorders, backBorders,
  frontCardBounds, backCardBounds,
  centering, cornersScore, surfaceScore, edgesScore,
  companies, defects, timestamp,
}) {
  const logo = await loadImage('img/logo-white.png');

  // Pre-measure text that can vary in wrapped line count (length differs a
  // lot between languages) so the canvas is allocated tall enough — sizing
  // this from a fixed guess previously clipped the footer off the bottom.
  const measureCtx = document.createElement('canvas').getContext('2d');
  const footerTextMaxW = WIDTH - PAD * 2 - 40;
  measureCtx.font = '11px -apple-system, sans-serif';
  const disclaimerLines = wrapLines(measureCtx, t('disclaimer'), footerTextMaxW);

  const defectList = defects || [];
  const defCols = 2;
  const defRowH = 210; // was 140 — flaw thumbnails were too small to read
  const defRows = Math.ceil(defectList.length / defCols);
  const defectsSectionH = defectList.length ? 54 + defRows * (defRowH + 10) + 10 : 0;

  const headerH = 160;
  const sectionGap = 24;
  const midGap = 24;
  const halfSectionW = (WIDTH - PAD * 2 - midGap) / 2;
  const frontLayout = sectionLayout(frontCanvas, frontCardBounds, halfSectionW);
  const backLayout = sectionLayout(backCanvas, backCardBounds, halfSectionW);
  const cardsRowH = Math.max(frontLayout.totalH, backLayout.totalH) + sectionGap;
  const statsH = 140;
  // Generous slack beyond the wrapped disclaimer lines themselves — the
  // "generated by" line plus its own bottom margin previously sat close
  // enough to the outer frame that it could visually touch/overlap it.
  const footerH = disclaimerLines.length * 15 + 90;

  const totalH = headerH + cardsRowH + statsH + defectsSectionH + footerH + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, WIDTH, totalH);

  // Outer border
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 2;
  roundRect(ctx, 10, 10, WIDTH - 20, totalH - 20, 14);
  ctx.stroke();

  // ---- Header ----
  const logoW = 170;
  const logoH = (logo.height / logo.width) * logoW;
  ctx.drawImage(logo, (WIDTH - logoW) / 2, 22, logoW, logoH);

  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.border;
  ctx.font = 'bold 19px -apple-system, sans-serif';
  ctx.fillText(t('report_title'), WIDTH / 2, 22 + logoH + 26);

  const idBits = [GAME_LABELS[game] || game, cardName, setName, cardNumber].filter(Boolean).join(' · ');
  ctx.fillStyle = COLORS.muted;
  ctx.font = '13px -apple-system, sans-serif';
  ctx.fillText(idBits, WIDTH / 2, 22 + logoH + 47);

  let y = headerH;

  // ---- Front / Back sections, side by side ----
  drawCardSection(ctx, { label: t('front').toUpperCase(), x: PAD, y, sectionW: halfSectionW, canvas: frontCanvas, borders: frontBorders, cardBounds: frontCardBounds });
  drawCardSection(ctx, { label: t('back').toUpperCase(), x: PAD + halfSectionW + midGap, y, sectionW: halfSectionW, canvas: backCanvas, borders: backBorders, cardBounds: backCardBounds });
  y += cardsRowH;

  // ---- Sub-score row ----
  const subLabels = [
    [t('centering').toUpperCase(), centering.score, `${centering.front_ratio} F · ${centering.back_ratio} B`],
    [t('corners').toUpperCase(), cornersScore, null],
    [t('surface').toUpperCase(), surfaceScore, null],
    [t('edges').toUpperCase(), edgesScore, null],
  ];
  const boxGap = 12;
  const boxW = (WIDTH - PAD * 2 - boxGap * 3) / 4;
  subLabels.forEach(([label, score, sub], i) => {
    const x = PAD + i * (boxW + boxGap);
    drawStatBox(ctx, x, y, boxW, 84, label, score.toFixed(1), scoreColor(score), sub);
  });
  y += 84 + 20;

  // ---- Company grades row ----
  const companyKeys = ['psa', 'cgc', 'bgs', 'tag'];
  companyKeys.forEach((key, i) => {
    const x = PAD + i * (boxW + boxGap);
    const c = companies[key];
    drawStatBox(ctx, x, y, boxW, 84, COMPANY_LABELS[key], Number(c.estimate).toFixed(1), COLORS.text, `${Math.round(c.confidence)}% ${t('confidence_suffix')}`);
  });
  y += 84 + 30;

  // ---- Defects ----
  if (defectList.length) {
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 16px -apple-system, sans-serif';
    ctx.fillText(t('flaws_detected')(defectList.length), PAD, y);
    y += 20;

    const cellW = (WIDTH - PAD * 2 - 10) / defCols;
    for (let i = 0; i < defectList.length; i++) {
      const d = defectList[i];
      const col = i % defCols;
      const row = Math.floor(i / defCols);
      const cx = PAD + col * (cellW + 10);
      const cy = y + row * (defRowH + 10);

      roundRect(ctx, cx, cy, cellW, defRowH, 8);
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 1;
      ctx.stroke();

      const source = d.side === 'back' ? backCanvas : frontCanvas;
      const sourceBounds = d.side === 'back' ? backCardBounds : frontCardBounds;
      const thumbDataUrl = cropZoneThumbnail(source, d.zone, sourceBounds);
      const thumbImg = await loadImage(thumbDataUrl);
      const thumbSize = defRowH - 20;
      ctx.save();
      roundRect(ctx, cx + 10, cy + 10, thumbSize, thumbSize, 8);
      ctx.clip();
      drawImageContain(ctx, thumbImg, cx + 10, cy + 10, thumbSize, thumbSize);
      ctx.restore();

      const textX = cx + 10 + thumbSize + 18;
      const textMaxW = cellW - thumbSize - 46;
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.border;
      ctx.font = 'bold 14px -apple-system, sans-serif';
      ctx.fillText(String(d.category || '').toUpperCase(), textX, cy + 32);
      ctx.fillStyle = COLORS.text;
      ctx.font = '16px -apple-system, sans-serif';
      let ty = wrapText(ctx, d.location || '', textX, cy + 56, textMaxW, 20);
      ctx.fillStyle = COLORS.muted;
      ctx.font = '14px -apple-system, sans-serif';
      wrapText(ctx, d.description || '', textX, ty + 8, textMaxW, 18);
    }
    y += defRows * (defRowH + 10) + 20;
  }

  // ---- Footer ----
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.muted;
  ctx.font = '11px -apple-system, sans-serif';
  y = wrapText(ctx, t('disclaimer'), WIDTH / 2, y, footerTextMaxW, 14);
  y += 20;
  ctx.fillStyle = COLORS.border;
  ctx.font = 'bold 12px -apple-system, sans-serif';
  ctx.fillText(t('generated_by')(timestamp), WIDTH / 2, y);

  return canvas;
}
