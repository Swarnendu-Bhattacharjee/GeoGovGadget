import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, writeFile, rm } from "fs/promises";
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
    extraArgs: (root) => ["--checkpoint", join(root, "ml", "models", "unet_parcel.pt")],
    timeout: 60000,
  },
  sam: {
    module: "ml.building_detector.run_for_web",
    extraArgs: (root) => [
      "--checkpoint", join(root, "ml", "models", "sam_vit_b_01ec64.pth"),
      "--model-type", "vit_b",
    ],
    timeout: 120000,
  },
};

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
  const python = join(projectRoot, "ml", ".venv", "bin", "python3");
  const config = ENGINES[engine];

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
