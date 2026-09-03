// Polygon geometry ported from the OpenCV calls in infer_unet.py.
// Points are flat [x0, y0, x1, y1, ...] arrays throughout, matching the shape
// findExternalContours() emits.

/** cv2.contourArea — Green's theorem over the point sequence. */
export function contourArea(pts) {
  const n = pts.length / 2;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    sum += pts[j * 2] * pts[i * 2 + 1] - pts[i * 2] * pts[j * 2 + 1];
  }
  return Math.abs(sum) / 2;
}

/** cv2.arcLength(closed=True). */
export function arcLength(pts) {
  const n = pts.length / 2;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    sum += Math.hypot(pts[i * 2] - pts[j * 2], pts[i * 2 + 1] - pts[j * 2 + 1]);
  }
  return sum;
}

/** cv2.boundingRect -> {x, y, w, h}. */
export function boundingRect(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < minX) minX = pts[i];
    if (pts[i] > maxX) maxX = pts[i];
    if (pts[i + 1] < minY) minY = pts[i + 1];
    if (pts[i + 1] > maxY) maxY = pts[i + 1];
  }
  return {
    x: Math.floor(minX),
    y: Math.floor(minY),
    w: Math.floor(maxX) - Math.floor(minX) + 1,
    h: Math.floor(maxY) - Math.floor(minY) + 1,
  };
}

function perpDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(px - ax, py - ay);
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
}

function dpChain(pts, from, to, eps, keep) {
  let worst = -1;
  let worstIdx = -1;
  const ax = pts[from * 2], ay = pts[from * 2 + 1];
  const bx = pts[to * 2], by = pts[to * 2 + 1];
  for (let i = from + 1; i < to; i++) {
    const d = perpDistance(pts[i * 2], pts[i * 2 + 1], ax, ay, bx, by);
    if (d > worst) { worst = d; worstIdx = i; }
  }
  if (worst > eps) {
    dpChain(pts, from, worstIdx, eps, keep);
    keep[worstIdx] = 1;
    dpChain(pts, worstIdx, to, eps, keep);
  }
}

/**
 * cv2.approxPolyDP(closed=True).
 *
 * A closed curve has no natural endpoints, so — as OpenCV does — the two
 * mutually-farthest points are found first and the ring is split into two open
 * chains that Douglas-Peucker can then simplify independently. Anchoring on an
 * arbitrary start vertex instead would make the result depend on where the
 * contour tracer happened to begin.
 */
export function approxPolyDP(pts, eps) {
  const n = pts.length / 2;
  if (n < 3) return Array.from(pts);

  let far = 0;
  let best = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(pts[i * 2] - pts[0], pts[i * 2 + 1] - pts[1]);
    if (d > best) { best = d; far = i; }
  }
  let opposite = 0;
  best = -1;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(pts[i * 2] - pts[far * 2], pts[i * 2 + 1] - pts[far * 2 + 1]);
    if (d > best) { best = d; opposite = i; }
  }

  const lo = Math.min(far, opposite);
  const hi = Math.max(far, opposite);
  const keep = new Uint8Array(n);
  keep[lo] = 1;
  keep[hi] = 1;
  dpChain(pts, lo, hi, eps, keep);

  // Second chain wraps past the end of the array; walk it on a rotated copy.
  const tailLen = n - hi + lo + 1;
  const tail = new Float64Array(tailLen * 2);
  for (let i = 0; i < tailLen; i++) {
    const src = (hi + i) % n;
    tail[i * 2] = pts[src * 2];
    tail[i * 2 + 1] = pts[src * 2 + 1];
  }
  const tailKeep = new Uint8Array(tailLen);
  dpChain(tail, 0, tailLen - 1, eps, tailKeep);
  for (let i = 1; i < tailLen - 1; i++) {
    if (tailKeep[i]) keep[(hi + i) % n] = 1;
  }

  const out = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  }
  return out;
}

/** Monotone-chain convex hull, counter-clockwise in image coordinates. */
export function convexHull(pts) {
  const n = pts.length / 2;
  const idx = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => pts[a * 2] - pts[b * 2] || pts[a * 2 + 1] - pts[b * 2 + 1]
  );
  const cross = (o, a, b) =>
    (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1]) -
    (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);

  const build = (order) => {
    const stack = [];
    for (const i of order) {
      while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], i) <= 0) {
        stack.pop();
      }
      stack.push(i);
    }
    stack.pop();
    return stack;
  };
  const hull = [...build(idx), ...build([...idx].reverse())];

  const out = [];
  for (const i of hull) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

/**
 * cv2.minAreaRect -> {width, height, angle}, rotating calipers over the hull.
 *
 * Only the angle reaches the UI (the "rotation" row in the parcel inspector).
 * It is normalised to [-90, 0) to match what the OpenCV build behind the Python
 * engine returns, so the same parcel does not read as 40.85 in the browser and
 * -49.15 on the server.
 */
export function minAreaRect(pts) {
  const hull = convexHull(pts);
  const n = hull.length / 2;
  if (n < 2) return { width: 0, height: 0, angle: -90 };

  let bestArea = Infinity;
  let best = { width: 0, height: 0, angle: 90 };
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ex = hull[i * 2] - hull[j * 2];
    const ey = hull[i * 2 + 1] - hull[j * 2 + 1];
    const len = Math.hypot(ex, ey);
    if (len === 0) continue;
    const ux = ex / len;
    const uy = ey / len;

    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let k = 0; k < n; k++) {
      const u = hull[k * 2] * ux + hull[k * 2 + 1] * uy;
      const v = -hull[k * 2] * uy + hull[k * 2 + 1] * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;
    if (area < bestArea) {
      bestArea = area;
      let angle = (Math.atan2(uy, ux) * 180) / Math.PI;
      angle = (((angle % 90) + 90) % 90) - 90;
      best = { width: w, height: h, angle };
    }
  }
  return best;
}
