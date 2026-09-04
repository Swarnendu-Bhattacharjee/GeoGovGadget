import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { access, mkdtemp, readFile, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

// Engine registry. `unet` is the default: it's the only one actually trained
// on cadastral labels, and it wins the head-to-head in public/benchmark.json
// on every axis that matters (IoU 0.53 vs SAM 0.22 vs classical 0.08, at 17x
// SAM's speed). The other two stay callable so the comparison the benchmark
// page claims can be reproduced live rather than taken on faith.
const ENGINES = {
  unet: {
    module: "ml.building_detector.infer_unet",
    checkpoint: (root) => join(root, "ml", "models", "unet_parcel.pt"),
    extraArgs: (root) => ["--checkpoint", ENGINES.unet.checkpoint(root)],
    timeout: 60000,
  },
  // Added after the SIH judges asked for YOLO in place of OpenCV. Note what
  // that actually swaps: OpenCV was never the detector, it vectorises masks.
  // This replaces the detector and keeps the same vectorisation, so /benchmark
  // compares models rather than post-processing.
  yolo: {
    module: "ml.building_detector.infer_yolo",
    checkpoint: (root) => join(root, "ml", "models", "yolo_parcel.pt"),
    extraArgs: (root) => ["--checkpoint", ENGINES.yolo.checkpoint(root)],
    timeout: 90000,
  },
  sam: {
    module: "ml.building_detector.run_for_web",
    checkpoint: (root) => join(root, "ml", "models", "sam_vit_b_01ec64.pth"),
    extraArgs: (root) => [
      "--checkpoint", ENGINES.sam.checkpoint(root),
      "--model-type", "vit_b",
    ],
    timeout: 120000,
  },
};

const pythonPath = () => join(process.cwd(), "ml", ".venv", "bin", "python3");

const exists = (path) => access(path).then(() => true, () => false);

// Whether this deployment can actually run a given engine server-side.
//
// It usually cannot. The venv is gitignored and a hosted Node runtime (Vercel,
// where this is deployed) has no Python interpreter to begin with, so the
// answer in production is "no" for both engines — the point of asking is to let
// the client pick the in-browser ONNX engine up front rather than discovering
// the failure through a 500 after the user has already waited on an upload.
async function engineAvailability() {
  const root = process.cwd();
  const python = await exists(pythonPath());
  const entries = await Promise.all(
    Object.entries(ENGINES).map(async ([name, config]) => [
      name,
      python && (await exists(config.checkpoint(root))),
    ])
  );
  return { python, engines: Object.fromEntries(entries) };
}

// GET /api/detect — capability probe, called by the tool page on mount.
export async function GET() {
  const { python, engines } = await engineAvailability();
  return NextResponse.json(
    { serverPython: python, engines },
    // Availability is a property of the deployment, not of the request, but it
    // must not be baked into a build-time static response either.
    { headers: { "Cache-Control": "no-store" } }
  );
}

// POST /api/detect
// Runs a real segmentation engine over an uploaded image and returns GeoJSON
// polygons in PIXEL coordinates plus the rendered overlay.
//
// Coordinates stay in pixel space because an arbitrary upload carries no
// geotransform — there's no honest way to place it on a basemap. The frontend
// therefore overlays polygons on the image itself. Known SRM sites do have
// real coordinates (data/srm_sites.js) and appear on the 3D map.
export async function POST(request) {
  const formData = await request.formData();
  const file = formData.get("image");
  const requested = String(formData.get("engine") || "unet");
  const engine = ENGINES[requested] ? requested : "unet";

  if (!file || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ error: "no image field in form data" }, { status: 400 });
  }

  const projectRoot = process.cwd();
  const python = pythonPath();
  const config = ENGINES[engine];

  // Fail fast and legibly when the Python side isn't installed, so the client
  // can fall back to the browser engine instead of showing a generic 500.
  if (!(await exists(python)) || !(await exists(config.checkpoint(projectRoot)))) {
    return NextResponse.json(
      {
        error: `The ${engine} engine is not available on this deployment.`,
        code: "server_engine_unavailable",
        details:
          "It runs from ml/.venv with torch + OpenCV, which a hosted Node runtime does not provide.",
      },
      { status: 503 }
    );
  }

  let workDir;
  try {
    workDir = await mkdtemp(join(tmpdir(), "geogov-"));
    const ext = file.name?.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : ".jpg";
    const inputPath = join(workDir, `input${ext}`);
    const outputDir = join(workDir, "out");

    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, bytes);

    await execFileAsync(
      python,
      [
        "-m", config.module,
        "--input", inputPath,
        "--output", outputDir,
        ...config.extraArgs(projectRoot),
      ],
      { cwd: projectRoot, timeout: config.timeout, maxBuffer: 10 * 1024 * 1024 }
    );

    const geojson = JSON.parse(await readFile(join(outputDir, "lot_layouts.geojson"), "utf-8"));
    const metadata = JSON.parse(await readFile(join(outputDir, "metadata.json"), "utf-8"));
    const annotated = await readFile(join(outputDir, "layouts", "annotated_result.png"));

    // The U-Net also emits a confidence heatmap; SAM has no equivalent, so
    // this is optional rather than part of the contract.
    let heatmapDataUrl = null;
    try {
      const heat = await readFile(join(outputDir, "layouts", "probability.png"));
      heatmapDataUrl = `data:image/png;base64,${heat.toString("base64")}`;
    } catch {}

    return NextResponse.json({
      engine,
      buildingsDetected: metadata.buildings_detected,
      detectionType: metadata.detection_type,
      engineLabel: metadata.engine || null,
      meanConfidence: metadata.mean_confidence ?? null,
      builtUpFraction: metadata.built_up_fraction ?? null,
      inferenceSeconds: metadata.inference_seconds ?? null,
      device: metadata.device ?? null,
      validationMetrics: metadata.validation_metrics ?? null,
      imageWidth: metadata.image_dimensions.width,
      imageHeight: metadata.image_dimensions.height,
      geojson,
      annotatedImageDataUrl: `data:image/png;base64,${annotated.toString("base64")}`,
      heatmapDataUrl,
      originalImageDataUrl: `data:${ext === ".png" ? "image/png" : "image/jpeg"};base64,${bytes.toString("base64")}`,
    });
  } catch (err) {
    console.error("Detection failed:", err);
    return NextResponse.json(
      {
        error:
          `The ${engine} engine failed. It runs server-side from ml/.venv; the trained ` +
          `checkpoint (ml/models/unet_parcel.pt) must be present.`,
        details: err.message,
      },
      { status: 500 }
    );
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
