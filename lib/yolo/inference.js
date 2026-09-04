// Browser port of ml/building_detector/infer_yolo.py.
//
// Same reason the U-Net has one: /api/detect shells out to Python, and the
// hosted deployment has no Python runtime — so on Vercel the engine picker
// could offer only the U-Net and the YOLO comparison the judges asked for was
// undemonstrable. This runs the exported YOLO11n-seg weights client-side.
//
// The decode is the part ultralytics normally hides: the ONNX graph stops at
// raw head outputs, so boxes, NMS, and mask assembly from prototypes all have
// to happen here.
//
//   output0  [1, 37, 8400]   4 box (cx,cy,w,h) + 1 class score + 32 mask coeffs
//   output1  [1, 32, 160, 160]  mask prototypes
//
// A detection's mask is sigmoid(coeffs · prototypes), cropped to its own box.

import { ortRuntime } from "@/lib/unet/inference";

export const TILE = 512;
export const OVERLAP = 128;
const IMGSZ = 640;
const PROTO = 160;
const NUM_ANCHORS = 8400;
const NUM_COEFFS = 32;

/** Matches _tile_starts() in infer_yolo.py, including the clamped final tile. */
function tileStarts(extent, tile, step) {
  const starts = [];
  for (let v = 0; v < Math.max(1, extent - tile + 1); v += step) starts.push(v);
  if (starts[starts.length - 1] + tile < extent) starts.push(Math.max(0, extent - tile));
  return starts;
}

/** Axis-aligned IoU on [x1, y1, x2, y2] boxes. */
function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter);
}

// Ultralytics caps candidates before NMS (max_nms/max_det). Without that cap
// this is O(n^2) over every anchor that clears the confidence bar, which on a
// dense cadastral tile is thousands — enough to wedge the tab rather than
// merely run slowly.
const MAX_NMS = 300;
const MAX_DET = 100;

function nms(dets, threshold) {
  const sorted = dets.sort((p, q) => q.score - p.score).slice(0, MAX_NMS);
  const kept = [];
  for (const d of sorted) {
    let overlaps = false;
    for (const k of kept) {
      if (iou(d.box, k.box) >= threshold) { overlaps = true; break; }
    }
    if (!overlaps) {
      kept.push(d);
      if (kept.length >= MAX_DET) break;
    }
  }
  return kept;
}

/**
 * Decode one tile's raw head output into detections, each carrying its mask at
 * *prototype* resolution (160x160).
 *
 * Keeping the mask at 160 is the whole performance story. The mask is a 32-term
 * dot product per pixel; evaluating that at tile resolution costs ~8M
 * multiply-adds for one large parcel, and billions across an image — which is
 * what made the first version of this hang rather than return. Ultralytics
 * builds masks at 160 and upsamples, and so does this.
 */
function decodeTile(out0, protos, conf, nmsThreshold) {
  const dets = [];
  for (let i = 0; i < NUM_ANCHORS; i++) {
    const score = out0[4 * NUM_ANCHORS + i];
    if (score < conf) continue;
    const cx = out0[i];
    const cy = out0[NUM_ANCHORS + i];
    const w = out0[2 * NUM_ANCHORS + i];
    const h = out0[3 * NUM_ANCHORS + i];
    const coeffs = new Float32Array(NUM_COEFFS);
    for (let c = 0; c < NUM_COEFFS; c++) coeffs[c] = out0[(5 + c) * NUM_ANCHORS + i];
    dets.push({ score, box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], coeffs });
  }
  if (!dets.length) return [];

  const S = IMGSZ / PROTO; // model px per prototype px
  return nms(dets, nmsThreshold).map((d) => {
    // The detection's box, in prototype cells, clamped to the grid.
    const px1 = Math.max(0, Math.floor(d.box[0] / S));
    const py1 = Math.max(0, Math.floor(d.box[1] / S));
    const px2 = Math.min(PROTO, Math.ceil(d.box[2] / S));
    const py2 = Math.min(PROTO, Math.ceil(d.box[3] / S));
    const mw = Math.max(0, px2 - px1);
    const mh = Math.max(0, py2 - py1);
    const mask = new Uint8Array(mw * mh);

    for (let my = 0; my < mh; my++) {
      const rowBase = (py1 + my) * PROTO + px1;
      for (let mx = 0; mx < mw; mx++) {
        let sum = 0;
        const base = rowBase + mx;
        for (let c = 0; c < NUM_COEFFS; c++) {
          sum += d.coeffs[c] * protos[c * PROTO * PROTO + base];
        }
        // sigmoid(sum) > 0.5 is exactly sum > 0, without paying for exp().
        mask[my * mw + mx] = sum > 0 ? 1 : 0;
      }
    }
    return { score: d.score, box: d.box, px1, py1, mw, mh, mask };
  });
}

/**
 * Sliding-window YOLO over a full image -> one confidence canvas, then handed
 * to the same vectorize() the U-Net path uses. Instances are max-merged where
 * tiles overlap, matching predict_full() in infer_yolo.py: a parcel seen twice
 * keeps its best score rather than summing into false certainty.
 *
 * @returns {Promise<Float32Array>} confidence per source pixel
 */
export async function predictFull(session, rgba, width, height, onProgress, conf = 0.25) {
  const ort = await ortRuntime();
  const canvas = new Float32Array(width * height);
  const step = Math.max(32, TILE - OVERLAP);
  const ys = tileStarts(height, TILE, step);
  const xs = tileStarts(width, TILE, step);
  const total = ys.length * xs.length;
  let done = 0;

  // One scratch canvas reused for every tile's 512 -> 640 resize.
  const scratch = document.createElement("canvas");
  scratch.width = scratch.height = IMGSZ;
  const sctx = scratch.getContext("2d", { willReadFrequently: true });

  // The source pixels, as an ImageBitmap-able canvas we can draw sub-rects of.
  const src = document.createElement("canvas");
  src.width = width;
  src.height = height;
  src.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);

  const input = new Float32Array(3 * IMGSZ * IMGSZ);
  const plane = IMGSZ * IMGSZ;

  for (const y of ys) {
    for (const x of xs) {
      const tw = Math.min(TILE, width - x);
      const th = Math.min(TILE, height - y);
      sctx.clearRect(0, 0, IMGSZ, IMGSZ);
      sctx.drawImage(src, x, y, tw, th, 0, 0, IMGSZ, IMGSZ);
      const pixels = sctx.getImageData(0, 0, IMGSZ, IMGSZ).data;

      // YOLO wants plain 0..1 RGB — no ImageNet normalisation.
      for (let p = 0; p < plane; p++) {
        input[p] = pixels[p * 4] / 255;
        input[plane + p] = pixels[p * 4 + 1] / 255;
        input[2 * plane + p] = pixels[p * 4 + 2] / 255;
      }

      const out = await session.run({
        images: new ort.Tensor("float32", input, [1, 3, IMGSZ, IMGSZ]),
      });
      const out0 = out.output0.data;
      const protos = out.output1.data;

      // The source rect (tw x th) was stretched to fill 640x640, so a source
      // pixel maps to model space by 640/tw, and to prototype cells by a
      // further 1/4. Iterating over source pixels keeps the mask aligned to
      // the image even when the edge tile is not a full 512.
      const toModelX = IMGSZ / tw;
      const toModelY = IMGSZ / th;
      const S = IMGSZ / PROTO;
      for (const d of decodeTile(out0, protos, conf, 0.45)) {
        const sx1 = Math.max(0, Math.floor((d.box[0] / toModelX)));
        const sy1 = Math.max(0, Math.floor((d.box[1] / toModelY)));
        const sx2 = Math.min(tw, Math.ceil((d.box[2] / toModelX)));
        const sy2 = Math.min(th, Math.ceil((d.box[3] / toModelY)));
        for (let ly = sy1; ly < sy2; ly++) {
          const cy = y + ly;
          if (cy < 0 || cy >= height) continue;
          const py = Math.round((ly * toModelY) / S) - d.py1;
          if (py < 0 || py >= d.mh) continue;
          const maskRow = py * d.mw;
          const canvasRow = cy * width;
          for (let lx = sx1; lx < sx2; lx++) {
            const px = Math.round((lx * toModelX) / S) - d.px1;
            if (px < 0 || px >= d.mw) continue;
            if (!d.mask[maskRow + px]) continue;
            const cx = x + lx;
            if (cx < 0 || cx >= width) continue;
            const idx = canvasRow + cx;
            if (d.score > canvas[idx]) canvas[idx] = d.score;
          }
        }
      }

      done++;
      onProgress?.(done, total);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return canvas;
}
