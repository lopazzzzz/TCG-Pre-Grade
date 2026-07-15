import { COMPANY_LABELS, GAME_LABELS } from './config.js';
import { generateCornerCrops, cropZoneThumbnail } from './imageTools.js';
import { t } from './i18n.js';

const WIDTH = 1040;
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
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
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

function drawCenteringGuides(ctx, rect, borders) {
  if (!borders) return;
  const x1 = rect.x + borders.left * rect.w;
  const x2 = rect.x + borders.right * rect.w;
  const y1 = rect.y + borders.top * rect.h;
  const y2 = rect.y + borders.bottom * rect.h;
  ctx.save();
  ctx.strokeStyle = 'rgba(0,229,255,0.95)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  [x1, x2].forEach((x) => {
    ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.h); ctx.stroke();
  });
  [y1, y2].forEach((y) => {
    ctx.beginPath(); ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.w, y); ctx.stroke();
  });
  ctx.restore();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let curY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, curY);
      line = word;
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, curY);
  return curY + lineHeight;
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

// Shared geometry for a card-side section, derived from the canvas's own
// aspect ratio so the main image fills its column width instead of being
// height-constrained and letterboxed.
function sectionLayout(canvas) {
  const sectionW = WIDTH - PAD * 2;
  const labelH = 40;
  const gap = 10;
  const cornerColW = sectionW * 0.22;
  const mainColW = sectionW - cornerColW * 2 - gap * 2;
  const mainColH = mainColW * (canvas.height / canvas.width);
  const cornerCellH = (mainColH - gap) / 2;
  return { sectionW, labelH, gap, cornerColW, mainColW, mainColH, cornerCellH, totalH: labelH + mainColH };
}

// Draws one card-side section (FRONT or BACK): corner crops flanking the
// full image with centering guide lines overlaid, matching the layout of
// well-known pre-grade report generators but reusing our own crop/measure
// pipeline.
function drawCardSection(ctx, { label, y, canvas, borders }) {
  const { labelH, gap, cornerColW, mainColW, mainColH, cornerCellH } = sectionLayout(canvas);

  ctx.fillStyle = COLORS.border;
  ctx.font = 'bold 20px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, WIDTH / 2, y + labelH - 12);

  const contentY = y + labelH;
  const leftX = PAD;
  const mainX = leftX + cornerColW + gap;
  const rightX = mainX + mainColW + gap;

  const crops = generateCornerCrops(canvas);
  const byKey = Object.fromEntries(crops.map((c) => [c.key, c]));

  function drawCropCell(img, x, cy, label2) {
    roundRect(ctx, x, cy, cornerColW, cornerCellH, 6);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(x, cy, cornerColW, cornerCellH);
    drawImageContain(ctx, img, x, cy, cornerColW, cornerCellH);
    ctx.restore();
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    roundRect(ctx, x, cy, cornerColW, cornerCellH, 6);
    ctx.stroke();
    ctx.fillStyle = COLORS.muted;
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label2, x + cornerColW / 2, cy + cornerCellH + 13);
  }

  drawCropCell(byKey.tl.canvas, leftX, contentY, t('corner_tl'));
  drawCropCell(byKey.bl.canvas, leftX, contentY + cornerCellH + gap, t('corner_bl'));
  drawCropCell(byKey.tr.canvas, rightX, contentY, t('corner_tr'));
  drawCropCell(byKey.br.canvas, rightX, contentY + cornerCellH + gap, t('corner_br'));

  roundRect(ctx, mainX, contentY, mainColW, mainColH, 6);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#000';
  ctx.fillRect(mainX, contentY, mainColW, mainColH);
  const rect = drawImageContain(ctx, canvas, mainX, contentY, mainColW, mainColH);
  drawCenteringGuides(ctx, rect, borders);
  ctx.restore();
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  roundRect(ctx, mainX, contentY, mainColW, mainColH, 6);
  ctx.stroke();

  return contentY + mainColH + 24;
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
  centering, cornersScore, surfaceScore, edgesScore,
  companies, defects, timestamp,
}) {
  const logo = await loadImage('img/logo-white.png');

  // Pre-measure defect thumbnails (each is a small canvas render) so we know
  // total height before allocating the final canvas.
  const defectList = defects || [];
  const defCols = 2;
  const defRowH = 96;
  const defRows = Math.ceil(defectList.length / defCols);
  const defectsSectionH = defectList.length ? 50 + defRows * (defRowH + 10) + 10 : 0;

  const headerH = 190;
  const sectionGap = 24;
  const frontSectionH = sectionLayout(frontCanvas).totalH + sectionGap;
  const backSectionH = sectionLayout(backCanvas).totalH + sectionGap;
  const statsH = 140;
  const footerH = 100;

  const totalH = headerH + frontSectionH + backSectionH + statsH + defectsSectionH + footerH + PAD;

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
  const logoW = 220;
  const logoH = (logo.height / logo.width) * logoW;
  ctx.drawImage(logo, (WIDTH - logoW) / 2, 30, logoW, logoH);

  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.border;
  ctx.font = 'bold 20px -apple-system, sans-serif';
  ctx.fillText(t('report_title'), WIDTH / 2, 30 + logoH + 34);

  const idBits = [GAME_LABELS[game] || game, cardName, setName, cardNumber].filter(Boolean).join(' · ');
  ctx.fillStyle = COLORS.muted;
  ctx.font = '13px -apple-system, sans-serif';
  ctx.fillText(idBits, WIDTH / 2, 30 + logoH + 58);

  let y = headerH;

  // ---- Front / Back sections ----
  y = drawCardSection(ctx, { label: t('front').toUpperCase(), y, canvas: frontCanvas, borders: frontBorders });
  y = drawCardSection(ctx, { label: t('back').toUpperCase(), y, canvas: backCanvas, borders: backBorders });

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
      const thumbDataUrl = cropZoneThumbnail(source, d.zone);
      const thumbImg = await loadImage(thumbDataUrl);
      const thumbSize = defRowH - 16;
      ctx.save();
      roundRect(ctx, cx + 8, cy + 8, thumbSize, thumbSize, 6);
      ctx.clip();
      drawImageContain(ctx, thumbImg, cx + 8, cy + 8, thumbSize, thumbSize);
      ctx.restore();

      const textX = cx + 8 + thumbSize + 12;
      const textMaxW = cellW - thumbSize - 32;
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.border;
      ctx.font = 'bold 10px -apple-system, sans-serif';
      ctx.fillText(String(d.category || '').toUpperCase(), textX, cy + 20);
      ctx.fillStyle = COLORS.text;
      ctx.font = '12px -apple-system, sans-serif';
      wrapText(ctx, d.location || '', textX, cy + 36, textMaxW, 14);
      ctx.fillStyle = COLORS.muted;
      ctx.font = '11px -apple-system, sans-serif';
      wrapText(ctx, d.description || '', textX, cy + 64, textMaxW, 13);
    }
    y += defRows * (defRowH + 10) + 20;
  }

  // ---- Footer ----
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.muted;
  ctx.font = '11px -apple-system, sans-serif';
  wrapText(ctx, t('disclaimer'), WIDTH / 2 - 300, y, 600, 14);
  y += 34;
  ctx.fillStyle = COLORS.border;
  ctx.font = 'bold 12px -apple-system, sans-serif';
  ctx.fillText(t('generated_by')(timestamp), WIDTH / 2, y);

  return canvas;
}

export function downloadCanvasAsImage(canvas, filename) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
