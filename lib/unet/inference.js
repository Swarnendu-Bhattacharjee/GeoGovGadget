// Port of predict_full() from ml/building_detector/train_unet.py: sliding
// window over a full-resolution image, averaging the overlapping tiles into a
// single probability map.
//
// The tile geometry is copied exactly (512px tiles, 128px overlap, reflect
// padding to a multiple of 32) because changing it changes the output — the
// seams between tiles are precisely where a different stride would show.

import { reflectIndex } from "./raster.js";

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

export const TILE = 512;
export const OVERLAP = 128;

/** Tile origins for one axis, matching Python's `range(0, max(1, n - tile + 1), step)`. */
function tileStarts(extent, tile, step) {
  const starts = [];
  for (let v = 0; v < Math.max(1, extent - tile + 1); v += step) starts.push(v);
  return starts;
}

/**
 * @param {Uint8ClampedArray} rgba source pixels, canvas order
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<Float32Array>} probability map, one value per source pixel
 */
export async function predictFull(session, rgba, width, height, onProgress) {
  const padH = (32 - (height % 32)) % 32;
  const padW = (32 - (width % 32)) % 32;
  const ph = height + padH;
  const pw = width + padW;

  const prob = new Float32Array(pw * ph);
  const count = new Float32Array(pw * ph);
  const step = Math.max(32, TILE - OVERLAP);

  const ys = tileStarts(ph, TILE, step);
  const xs = tileStarts(pw, TILE, step);
  const total = ys.length * xs.length;
  let done = 0;

  // Reflect-padding is applied by index remapping rather than by building a
  // padded copy of the image, which would double peak memory on large uploads.
  const srcRow = new Int32Array(ph);
  for (let y = 0; y < ph; y++) srcRow[y] = reflectIndex(y, height);
  const srcCol = new Int32Array(pw);
  for (let x = 0; x < pw; x++) srcCol[x] = reflectIndex(x, width);

  for (const y of ys) {
    for (const x of xs) {
      const y2 = Math.min(y + TILE, ph);
      const x2 = Math.min(x + TILE, pw);
      const th = y2 - y;
      const tw = x2 - x;

      const input = new Float32Array(3 * th * tw);
      const plane = th * tw;
      for (let ty = 0; ty < th; ty++) {
        const sy = srcRow[y + ty];
        for (let tx = 0; tx < tw; tx++) {
          const si = (sy * width + srcCol[x + tx]) * 4;
          const di = ty * tw + tx;
          for (let c = 0; c < 3; c++) {
            input[c * plane + di] = (rgba[si + c] / 255 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
          }
        }
      }

      const { Tensor } = await ortRuntime();
      const output = await session.run({
        input: new Tensor("float32", input, [1, 3, th, tw]),
      });
      const out = output.prob.data;

      for (let ty = 0; ty < th; ty++) {
        const row = (y + ty) * pw + x;
        for (let tx = 0; tx < tw; tx++) {
          prob[row + tx] += out[ty * tw + tx];
          count[row + tx] += 1;
        }
      }

      done++;
      onProgress?.(done, total);
      // Hand the frame back so the progress readout actually repaints between
      // tiles; without this the whole run looks like one long freeze.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const cropped = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * pw + x;
      cropped[y * width + x] = prob[i] / (count[i] || 1);
    }
  }
  return cropped;
}

// Resolved lazily and cached: onnxruntime-web is ~2MB of JS that nothing but
// this engine needs, so it must not sit in the page's initial bundle.
let ortPromise = null;
export function ortRuntime() {
  if (!ortPromise) {
    // Loaded straight from /ort at runtime, deliberately outside the webpack
    // graph (`webpackIgnore`). Bundling onnxruntime-web instead breaks the
    // build: the root export resolves to its *Node* distribution under
    // webpack's conditions, and its .mjs bundles get emitted as assets and then
    // fed to Terser as non-module code, which fails to parse. Serving the
    // prebuilt bundle from public/ — the same thing this app already does for
    // the maplibre workers — sidesteps all of it, and keeps ~2MB of runtime out
    // of the page's initial JS. `npm run sync:ort` copies it out of
    // node_modules; prebuild runs that, so Vercel produces it on deploy.
    ortPromise = import(/* webpackIgnore: true */ "/ort/ort.wasm.bundle.min.mjs").then((ort) => {
      // Served from public/ort (see `npm run sync:ort`) instead of the default
      // CDN, so the tool keeps working offline and behind a proxy.
      ort.env.wasm.wasmPaths = "/ort/";
      // The wasm-only build, not the WebGPU one: WebGPU drags in the asyncify
      // backend (+54MB of static assets against wasm's 14MB) and measured
      // *slower* than plain wasm wherever the GPU path isn't actually taken.
      // Multi-threading needs SharedArrayBuffer, which needs COOP/COEP headers
      // this app does not set (they would break the third-party basemap tiles
      // the other pages load). Single-threaded is the honest default.
      ort.env.wasm.numThreads = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated
        ? Math.min(4, navigator.hardwareConcurrency || 1)
        : 1;
      return ort;
    });
  }
  return ortPromise;
}
