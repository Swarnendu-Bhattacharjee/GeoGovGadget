// Raster primitives ported from the OpenCV calls in
// ml/building_detector/infer_unet.py, so the browser engine produces the same
// polygons as the Python engine rather than merely similar ones.
//
// Only what that script actually uses is implemented here: reflect padding for
// sliding-window inference, a 5x5 elliptical open/close, external contour
// tracing, and scanline polygon fill for the per-parcel confidence readout.

// cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)) — hardcoded rather than
// derived, because the derivation is OpenCV-internal and a near-miss kernel
// would silently shift every boundary by a pixel.
//   0 0 1 0 0
//   1 1 1 1 1
//   1 1 1 1 1
//   1 1 1 1 1
//   0 0 1 0 0
const ELLIPSE_5 = [
  [0, -2], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1],
  [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0],
  [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [0, 2],
];

/** cv2.BORDER_REFLECT index mapping: `fedcba|abcdefgh|hgfedcb`. */
export function reflectIndex(i, n) {
  if (n === 1) return 0;
  let v = i;
  while (v < 0 || v >= n) {
    if (v < 0) v = -v - 1;
    if (v >= n) v = 2 * n - 1 - v;
  }
  return v;
}

/**
 * Erosion / dilation with the 5x5 ellipse.
 *
 * OpenCV's morphology border value is +inf for erode and -inf for dilate, so
 * off-image neighbours count as foreground when eroding and background when
 * dilating — that is what stops a shape touching the frame edge from being
 * eaten away. `outside` encodes that.
 */
function morph(src, w, h, erode) {
  const out = new Uint8Array(w * h);
  const outside = erode ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = erode ? 1 : 0;
      for (let k = 0; k < ELLIPSE_5.length; k++) {
        const nx = x + ELLIPSE_5[k][0];
        const ny = y + ELLIPSE_5[k][1];
        const v =
          nx < 0 || ny < 0 || nx >= w || ny >= h ? outside : src[ny * w + nx];
        if (erode) {
          if (!v) { acc = 0; break; }
        } else if (v) { acc = 1; break; }
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

const erode = (s, w, h) => morph(s, w, h, true);
const dilate = (s, w, h) => morph(s, w, h, false);

/**
 * cv2.morphologyEx(MORPH_OPEN/MORPH_CLOSE, iterations=n).
 *
 * OpenCV applies the whole erode-run before the whole dilate-run (n erosions
 * then n dilations), not n alternating open/close passes — the two differ once
 * n > 1, which is exactly the case for the CLOSE step in infer_unet.py.
 */
export function morphologyEx(src, w, h, op, iterations = 1) {
  const first = op === "open" ? erode : dilate;
  const second = op === "open" ? dilate : erode;
  let cur = src;
  for (let i = 0; i < iterations; i++) cur = first(cur, w, h);
  for (let i = 0; i < iterations; i++) cur = second(cur, w, h);
  return cur;
}

/**
 * External contours of a binary mask, one per 8-connected component —
 * cv2.findContours(..., RETR_EXTERNAL, CHAIN_APPROX_SIMPLE).
 *
 * Components are labelled first and each one's outer boundary is then traced,
 * which gives RETR_EXTERNAL's "outermost boundary only, holes ignored"
 * semantics directly. CHAIN_APPROX_SIMPLE's straight-run compression is not
 * reproduced because the very next step is Douglas-Peucker, which discards
 * collinear points anyway.
 */
export function findExternalContours(mask, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const contours = [];
  const stack = new Int32Array(w * h);

  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const start = sy * w + sx;
      if (!mask[start] || labels[start] !== -1) continue;

      // Flood-fill the component (8-connected, matching OpenCV's foreground
      // connectivity) so the trace below cannot wander into a neighbour.
      const label = contours.length;
      let top = 0;
      stack[top++] = start;
      labels[start] = label;
      while (top > 0) {
        const p = stack[--top];
        const px = p % w;
        const py = (p / w) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            const ny = py + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const n = ny * w + nx;
            if (mask[n] && labels[n] === -1) {
              labels[n] = label;
              stack[top++] = n;
            }
          }
        }
      }
      contours.push(traceBoundary(labels, w, h, label, sx, sy));
    }
  }
  return contours;
}

// Moore-neighbour tracing with Jacob's stopping criterion. (sx, sy) is the
// component's topmost-then-leftmost pixel, so the search starts from the
// neighbour just left of it, which is guaranteed to be outside the component.
const MOORE = [
  [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1],
];

function traceBoundary(labels, w, h, label, sx, sy) {
  const inside = (x, y) =>
    x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === label;

  const points = [sx, sy];
  let cx = sx;
  let cy = sy;
  let dir = 0; // index into MOORE of the backtrack direction (west of start)

  for (let guard = 0; guard < 8 * w * h; guard++) {
    let found = false;
    // Sweep clockwise from just past the backtrack cell.
    for (let k = 1; k <= 8; k++) {
      const d = (dir + k) % 8;
      const nx = cx + MOORE[d][0];
      const ny = cy + MOORE[d][1];
      if (!inside(nx, ny)) continue;
      // The new backtrack direction is where we came from.
      dir = (d + 4) % 8;
      cx = nx;
      cy = ny;
      found = true;
      break;
    }
    if (!found) break; // isolated pixel
    if (cx === sx && cy === sy) break; // closed the loop
    points.push(cx, cy);
  }
  return points;
}

/**
 * Mean of `values` over the interior of a polygon — the JS stand-in for
 * drawContours(FILLED) followed by prob[region > 0].mean().
 *
 * Uses the same even-odd scanline rule OpenCV's filler does, sampling at pixel
 * centres, and falls back to the polygon's vertices if the shape is so thin
 * that no pixel centre lands inside it (OpenCV would still mark its outline).
 */
export function meanInsidePolygon(points, values, w, h) {
  const n = points.length / 2;
  if (n < 3) return 0;

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = points[i * 2 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const y0 = Math.max(0, Math.ceil(minY));
  const y1 = Math.min(h - 1, Math.floor(maxY));

  let sum = 0;
  let count = 0;
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = points[i * 2 + 1];
      const yj = points[j * 2 + 1];
      if (yi > y === yj > y) continue;
      const xi = points[i * 2];
      const xj = points[j * 2];
      xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.ceil(xs[i]));
      const xb = Math.min(w - 1, Math.floor(xs[i + 1]));
      for (let x = xa; x <= xb; x++) {
        sum += values[y * w + x];
        count++;
      }
    }
  }

  if (count === 0) {
    for (let i = 0; i < n; i++) {
      const x = Math.min(w - 1, Math.max(0, Math.round(points[i * 2])));
      const y = Math.min(h - 1, Math.max(0, Math.round(points[i * 2 + 1])));
      sum += values[y * w + x];
      count++;
    }
  }
  return count ? sum / count : 0;
}
