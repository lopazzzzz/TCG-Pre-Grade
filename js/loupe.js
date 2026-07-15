// Floating magnifier shown while dragging a corner/line handle, so a precise
// tap/drag target (a card corner, a thin border line) isn't hidden under the
// user's own finger or cursor. Zooms the same canvas being dragged on (photo
// + guide overlay together) so the magnified view matches what's on screen.
const SIZE = 132; // on-screen diameter, CSS px
const ZOOM = 3;
const DPR = Math.max(1, window.devicePixelRatio || 1);

export function createLoupe() {
  const el = document.createElement('canvas');
  el.width = SIZE * DPR;
  el.height = SIZE * DPR;
  el.style.cssText = `position:fixed;width:${SIZE}px;height:${SIZE}px;border-radius:50%;`
    + `border:3px solid #ffce45;box-shadow:0 6px 18px rgba(0,0,0,0.45);`
    + `pointer-events:none;z-index:9999;display:none;background:#111;`;
  document.body.appendChild(el);
  const ctx = el.getContext('2d');

  // clientX/clientY: pointer position in viewport coords (for placement).
  // sourceCanvas: the canvas to zoom into.
  // sx/sy: the point to center the zoom on, in sourceCanvas's own internal
  // pixel coordinates (same space as its width/height, not CSS size).
  function show(clientX, clientY, sourceCanvas, sx, sy) {
    el.style.display = 'block';
    el.style.left = `${clientX - SIZE / 2}px`;
    el.style.top = `${clientY - SIZE - 28}px`; // float above the finger/cursor

    const rect = sourceCanvas.getBoundingClientRect();
    const cssToInternal = sourceCanvas.width / rect.width;
    const cropPx = (SIZE / ZOOM) * cssToInternal;

    ctx.clearRect(0, 0, el.width, el.height);
    ctx.save();
    ctx.beginPath();
    ctx.arc(el.width / 2, el.height / 2, el.width / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
      sourceCanvas,
      sx - cropPx / 2, sy - cropPx / 2, cropPx, cropPx,
      0, 0, el.width, el.height,
    );
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5 * DPR;
    const cx = el.width / 2, cy = el.height / 2, r = 10 * DPR;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.stroke();
    ctx.restore();
  }

  function hide() {
    el.style.display = 'none';
  }

  return { show, hide };
}
