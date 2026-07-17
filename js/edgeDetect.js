// Shared content-vs-background edge detection, used by both the initial
// card-bounding-box guess (perspective.js, step 3 — the raw photo may still
// have background margin and/or be skewed) and the outer/inner border
// detection (centering.js, step 4 — post-alignment, background margin is
// usually minimal or zero).
//
// Earlier versions of this detector looked for a single sharp brightness
// STEP (background vs. card is usually a big contrast jump). That broke
// down often in practice: holo/foil textures create bright-dark noise
// spikes that can outrank the real edge, and it only works if the
// background happens to be plainer than the card at that exact pixel row.
//
// This version instead scores local CONTENT DENSITY (variance of luminance
// in a small neighborhood) — a plain background (table, mousepad, sleeve)
// reads as low variance almost everywhere, while card art/text/borders read
// as high variance, regardless of which side is literally brighter. That
// assumption (background is visually "quieter" than the card) is far more
// often true than "background is a different average brightness."

function luminance(data, i) {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

// Builds a smoothed 1D "content density" profile along one axis (x if
// isHorizontalScan, else y), sampling a center strip perpendicular to the
// scan direction so a few stray pixels can't dominate the score.
export function buildDensityProfile(imageData, width, height, isHorizontalScan) {
  const scanLength = isHorizontalScan ? width : height;
  const stripDim = isHorizontalScan ? height : width;
  const stripStart = Math.floor(stripDim * 0.3);
  const stripEnd = Math.ceil(stripDim * 0.7);
  const step = Math.max(1, Math.floor((stripEnd - stripStart) / 40));

  const raw = new Float64Array(scanLength);
  for (let p = 0; p < scanLength; p++) {
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let s = stripStart; s < stripEnd; s += step) {
      const x = isHorizontalScan ? p : s;
      const y = isHorizontalScan ? s : p;
      const idx = (y * width + x) * 4;
      const l = luminance(imageData.data, idx);
      sum += l;
      sumSq += l * l;
      count++;
    }
    const mean = sum / count;
    raw[p] = sumSq / count - mean * mean;
  }

  const smoothRadius = Math.max(1, Math.round(scanLength * 0.01));
  const smoothed = new Float64Array(scanLength);
  for (let p = 0; p < scanLength; p++) {
    let sum = 0;
    let count = 0;
    for (let k = -smoothRadius; k <= smoothRadius; k++) {
      const pos = p + k;
      if (pos < 0 || pos >= scanLength) continue;
      sum += raw[pos];
      count++;
    }
    smoothed[p] = sum / count;
  }
  return smoothed;
}

// Finds the position where `profile` transitions from background-level
// (low, quiet) to content-level (high, detailed) density, searching within
// [searchLo, searchHi). `fromStart` scans low->high (near-start-of-range
// side is treated as "outside"/background); otherwise scans high->low.
// The threshold is calibrated per-image from the range's own background
// baseline and peak, and a transition must sustain for a short run (not
// just a one-off spike) to be accepted — both make this robust to holo
// noise and varying photo brightness/contrast.
export function findContentEdge(profile, fromStart, searchLo, searchHi) {
  const scanLength = profile.length;
  const lo = Math.max(0, Math.floor(searchLo));
  const hi = Math.min(scanLength, Math.ceil(searchHi));
  if (hi - lo < 4) return fromStart ? lo : Math.max(lo, hi - 1);

  const baselineLen = Math.max(3, Math.round((hi - lo) * 0.15));
  const baselineSamples = [];
  if (fromStart) {
    for (let p = lo; p < lo + baselineLen && p < hi; p++) baselineSamples.push(profile[p]);
  } else {
    for (let p = hi - 1; p >= hi - baselineLen && p >= lo; p--) baselineSamples.push(profile[p]);
  }
  baselineSamples.sort((a, b) => a - b);
  const baseline = baselineSamples[Math.floor(baselineSamples.length / 2)] || 0;

  let peak = 0;
  for (let p = lo; p < hi; p++) peak = Math.max(peak, profile[p]);
  // Midpoint-of-rise threshold rather than a low "any hint of content"
  // threshold — smoothing blurs the profile's rise across several pixels
  // around the true edge, and a low threshold triggers on the leading edge
  // of that blurred ramp, systematically detecting the edge too early
  // (making thin borders read thinner than they really are). The 50%
  // crossing point of a symmetric blur kernel lands much closer to the
  // true, unblurred step location.
  const threshold = baseline + Math.max((peak - baseline) * 0.5, 20);

  const sustainRun = Math.max(2, Math.round((hi - lo) * 0.015));
  let run = 0;
  if (fromStart) {
    for (let p = lo; p < hi; p++) {
      if (profile[p] >= threshold) {
        run++;
        if (run >= sustainRun) return p - run + 1;
      } else {
        run = 0;
      }
    }
    return lo;
  }
  for (let p = hi - 1; p >= lo; p--) {
    if (profile[p] >= threshold) {
      run++;
      if (run >= sustainRun) return p + run - 1;
    } else {
      run = 0;
    }
  }
  return hi - 1;
}

// Builds a smoothed 1D mean-luminance profile (not variance) — a second,
// independent signal for the raw-photo bounding box: most real cards have
// their own uniform-colored printed border strip around the edge, and that
// border reads as equally "quiet" (low variance) as a plain background, so
// buildDensityProfile/findContentEdge alone would skip straight past the
// true outer card edge and land on the border-to-artwork transition
// instead. A background and a card border are still usually a visibly
// different average brightness/color even when both are individually
// uniform, which this profile can catch instead.
function buildMeanProfile(imageData, width, height, isHorizontalScan) {
  const scanLength = isHorizontalScan ? width : height;
  const stripDim = isHorizontalScan ? height : width;
  const stripStart = Math.floor(stripDim * 0.3);
  const stripEnd = Math.ceil(stripDim * 0.7);
  const step = Math.max(1, Math.floor((stripEnd - stripStart) / 40));

  const raw = new Float64Array(scanLength);
  for (let p = 0; p < scanLength; p++) {
    let sum = 0;
    let count = 0;
    for (let s = stripStart; s < stripEnd; s += step) {
      const x = isHorizontalScan ? p : s;
      const y = isHorizontalScan ? s : p;
      const idx = (y * width + x) * 4;
      sum += luminance(imageData.data, idx);
      count++;
    }
    raw[p] = sum / count;
  }

  const smoothRadius = Math.max(1, Math.round(scanLength * 0.006));
  const smoothed = new Float64Array(scanLength);
  for (let p = 0; p < scanLength; p++) {
    let sum = 0;
    let count = 0;
    for (let k = -smoothRadius; k <= smoothRadius; k++) {
      const pos = p + k;
      if (pos < 0 || pos >= scanLength) continue;
      sum += raw[pos];
      count++;
    }
    smoothed[p] = sum / count;
  }
  return smoothed;
}

// Finds a sustained brightness STEP in `profile` — same shape as
// findContentEdge, but the transition test is "does the average level
// change" rather than "does detail density change". Used alongside
// findContentEdge for the raw-photo bounding box so a background-vs-border
// transition can be caught even when neither side has any texture at all.
function findMeanStepEdge(profile, fromStart, searchLo, searchHi) {
  const scanLength = profile.length;
  const lo = Math.max(0, Math.floor(searchLo));
  const hi = Math.min(scanLength, Math.ceil(searchHi));
  if (hi - lo < 4) return fromStart ? lo : Math.max(lo, hi - 1);

  const baselineLen = Math.max(3, Math.round((hi - lo) * 0.1));
  const baselineSamples = [];
  if (fromStart) {
    for (let p = lo; p < lo + baselineLen && p < hi; p++) baselineSamples.push(profile[p]);
  } else {
    for (let p = hi - 1; p >= hi - baselineLen && p >= lo; p--) baselineSamples.push(profile[p]);
  }
  baselineSamples.sort((a, b) => a - b);
  const baseline = baselineSamples[Math.floor(baselineSamples.length / 2)] || 0;
  const MIN_STEP = 18; // luminance levels (0-255) — below this, treat as "no real color/brightness change"

  const sustainRun = Math.max(2, Math.round((hi - lo) * 0.015));
  let run = 0;
  if (fromStart) {
    for (let p = lo; p < hi; p++) {
      if (Math.abs(profile[p] - baseline) >= MIN_STEP) {
        run++;
        if (run >= sustainRun) return p - run + 1;
      } else {
        run = 0;
      }
    }
    return null;
  }
  for (let p = hi - 1; p >= lo; p--) {
    if (Math.abs(profile[p] - baseline) >= MIN_STEP) {
      run++;
      if (run >= sustainRun) return p + run - 1;
    } else {
      run = 0;
    }
  }
  return null;
}

// Detects the card's rough axis-aligned bounding box within `canvas` —
// used as a starting guess before any alignment/warping has happened, so
// the search range spans nearly the whole image (background margin could
// be large, small, or on only one side) rather than assuming the card is
// already close to the frame edges.
//
// Combines two independent signals per edge and takes whichever candidate
// sits CLOSER to the true photo edge (i.e. further out): content-density
// (catches a background-to-detailed-card-art transition) and a plain
// brightness step (catches a background-to-uniform-card-border
// transition, which content density alone can't see since both sides are
// equally "quiet"). Taking the outermost of the two avoids systematically
// landing on the card's inner artwork boundary instead of its true edge
// whenever the card has its own solid-color border strip.
export function detectContentBoundingBox(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const densityX = buildDensityProfile(imageData, width, height, true);
  const densityY = buildDensityProfile(imageData, width, height, false);
  const meanX = buildMeanProfile(imageData, width, height, true);
  const meanY = buildMeanProfile(imageData, width, height, false);

  function outerEdge(densityProfile, meanProfile, fromStart, lo, hi) {
    const densityEdge = findContentEdge(densityProfile, fromStart, lo, hi);
    const meanEdge = findMeanStepEdge(meanProfile, fromStart, lo, hi);
    if (meanEdge === null) return densityEdge;
    return fromStart ? Math.min(densityEdge, meanEdge) : Math.max(densityEdge, meanEdge);
  }

  return {
    left: outerEdge(densityX, meanX, true, width * 0.005, width * 0.5) / width,
    right: outerEdge(densityX, meanX, false, width * 0.5, width * 0.995) / width,
    top: outerEdge(densityY, meanY, true, height * 0.005, height * 0.5) / height,
    bottom: outerEdge(densityY, meanY, false, height * 0.5, height * 0.995) / height,
  };
}
