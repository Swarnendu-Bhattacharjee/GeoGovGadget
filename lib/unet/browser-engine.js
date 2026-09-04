"use client";

// Runs the trained U-Net entirely in the browser via onnxruntime-web.
//
// This exists because /api/detect cannot work on Vercel: it shells out to
// ml/.venv/bin/python3 with torch and OpenCV, and Vercel's Node runtime has no
// Python (nor room for a torch install inside the function size limit). Rather
// than let the tool 500 in production, the same trained weights — exported by
// ml/building_detector/export_onnx.py and verified against torch to ~1e-6 —
// run client-side, with the pre/post-processing ported tile-for-tile from the
// Python engine so results agree with the /benchmark numbers.

import { predictFull, ortRuntime } from "./inference.js";
import { predictFull as predictFullYolo } from "@/lib/yolo/inference";
import { toGeoJSON, vectorize } from "./vectorize.js";
import { renderAnnotated, renderHeatmap, toPngDataUrl } from "./render.js";

const METRICS_URL = "/models/unet_parcel_metrics.json";
const MODEL_CACHE = "geogov-models-v2";

// Both trained detectors have a browser path, so the head-to-head the SIH
// judges asked for is demonstrable on the hosted app and not only on a laptop
// with the Python venv installed. SAM has no entry here: a 375MB checkpoint is
// not something to hand a browser.
const ENGINES = {
  unet: {
    url: "/models/unet_parcel.onnx",
    threshold: 0.5,
    predict: predictFull,
    label: "U-Net (ResNet18 encoder), trained on SRM KTR cadastral labels — in-browser (ONNX Runtime)",
  },
  yolo: {
    url: "/models/yolo_parcel.onnx",
    threshold: 0.25,
    predict: predictFullYolo,
    label: "YOLO11n-seg, trained on SRM KTR cadastral labels — in-browser (ONNX Runtime)",
  },
};

export const ENGINE_LABEL = ENGINES.unet.label;

const sessionPromises = {};

/**
 * Fetches the ONNX weights with byte-level progress and keeps them in the Cache
 * Storage API. The file is ~57MB, so a second visit must not pay for it again;
 * the cache name carries a version suffix so a re-exported model invalidates it.
 */
async function fetchModel(url, onProgress) {
  const cache = typeof caches !== "undefined" ? await caches.open(MODEL_CACHE).catch(() => null) : null;
  let response = cache ? await cache.match(url).catch(() => null) : null;
  let fromCache = Boolean(response);

  if (!response) {
    response = await fetch(url);
    if (!response.ok) throw new Error(`model download failed (HTTP ${response.status})`);
    if (cache) await cache.put(url, response.clone()).catch(() => {});
  }

  const total = Number(response.headers.get("content-length")) || 0;
  if (fromCache || !response.body) {
    onProgress?.(1);
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(total ? Math.min(1, received / total) : 0);
  }
  onProgress?.(1);

  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer.buffer;
}

async function getSession(engine, onProgress) {
  if (!sessionPromises[engine]) {
    sessionPromises[engine] = (async () => {
      const ort = await ortRuntime();
      const bytes = await fetchModel(ENGINES[engine].url, onProgress);
      const session = await ort.InferenceSession.create(bytes, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      return { session, device: "browser (wasm)" };
    })().catch((err) => {
      delete sessionPromises[engine]; // a failed load must not poison retries
      throw err;
    });
  }
  return sessionPromises[engine];
}

let metricsPromise = null;
function getValidationMetrics() {
  if (!metricsPromise) {
    metricsPromise = fetch(METRICS_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => m?.metrics?.mean ?? null)
      .catch(() => null);
  }
  return metricsPromise;
}

async function decodeImage(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { bitmap, rgba: data, width: bitmap.width, height: bitmap.height };
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Same result shape as POST /api/detect, so the page renders a browser result
 * and a server result through one code path.
 *
 * @param {File} file
 * @param {(stage: {phase: "model" | "inference" | "vectorising", progress: number}) => void} [onStage]
 */
export async function detectInBrowser(file, onStage, engine = "unet") {
  const config = ENGINES[engine] ? engine : "unet";
  const spec = ENGINES[config];
  const { session, device } = await getSession(config, (progress) =>
    onStage?.({ phase: "model", progress })
  );

  const [{ bitmap, rgba, width, height }, originalImageDataUrl, validationMetrics] =
    await Promise.all([decodeImage(file), readAsDataUrl(file), getValidationMetrics()]);

  const started = performance.now();
  const prob = await spec.predict(session, rgba, width, height, (done, total) =>
    onStage?.({ phase: "inference", progress: done / total })
  );

  onStage?.({ phase: "vectorising", progress: 1 });
  const { polygons } = vectorize(prob, width, height, spec.threshold);
  const elapsed = (performance.now() - started) / 1000;

  const geojson = toGeoJSON(polygons, file.name || "upload");
  const totalArea = geojson.features.reduce((sum, f) => sum + f.properties.area_pixels, 0);
  const meanConfidence = polygons.length
    ? polygons.reduce((sum, p) => sum + p.confidence, 0) / polygons.length
    : 0;

  const annotated = renderAnnotated(bitmap, width, height, polygons);
  const heatmap = renderHeatmap(prob, width, height);
  bitmap.close?.();

  return {
    engine: config,
    buildingsDetected: polygons.length,
    detectionType: config,
    engineLabel: spec.label,
    meanConfidence: Math.round(meanConfidence * 1e4) / 1e4,
    builtUpFraction: Math.round((totalArea / (width * height)) * 1e4) / 1e4,
    inferenceSeconds: Math.round(elapsed * 100) / 100,
    device,
    validationMetrics,
    imageWidth: width,
    imageHeight: height,
    geojson,
    annotatedImageDataUrl: toPngDataUrl(annotated),
    heatmapDataUrl: toPngDataUrl(heatmap),
    originalImageDataUrl,
  };
}
