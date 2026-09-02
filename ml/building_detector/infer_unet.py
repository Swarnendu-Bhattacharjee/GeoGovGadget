#!/usr/bin/env python3
"""
Runs the trained U-Net on one image and emits GIS-ready vector output.

This is the engine app/api/detect/route.js calls by default. Unlike the SAM
path (~20s/image, class-agnostic) this is a purpose-trained cadastral model:
one forward pass, sub-second on GPU, and it only fires on what it was taught
counts as a built-up parcel — so it doesn't outline sports fields, water or
map labels the way class-agnostic segmentation does.

Pipeline: sliding-window inference -> probability map -> threshold ->
morphological cleanup -> contours -> Douglas-Peucker simplification ->
polygons, with per-polygon area and mean confidence carried through.

Writes the same file shapes as the other engines so the API route stays
engine-agnostic:
    lot_layouts.geojson   polygons in pixel coords, with properties
    metadata.json         counts, image size, engine name, timing
    layouts/annotated_result.png
    layouts/probability.png   the raw model confidence heatmap

Usage:
    python -m ml.building_detector.infer_unet \\
        --input img.jpg --output /tmp/out --checkpoint ml/models/unet_parcel.pt
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np
import torch

from ml.building_detector.train_unet import ResNetUNet, predict_full

# A parcel smaller than this fraction of the frame is noise at any zoom;
# expressed as a fraction (not fixed pixels) so it holds whether the upload
# is a tight building crop or a whole-campus overview.
MIN_AREA_FRAC = 0.0004
SIMPLIFY_FRAC = 0.012  # Douglas-Peucker epsilon as a fraction of perimeter


def load_model(checkpoint: str, device: str):
    model = ResNetUNet(pretrained=False).to(device)
    ckpt = torch.load(checkpoint, map_location=device, weights_only=False)
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    return model, ckpt.get("val", {})


def vectorize(prob: np.ndarray, threshold: float, min_area_frac: float = MIN_AREA_FRAC):
    """Probability map -> simplified polygons with confidence + area."""
    h, w = prob.shape
    binary = (prob > threshold).astype(np.uint8) * 255

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=1)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = max(60.0, min_area_frac * h * w)

    polygons = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area:
            continue
        approx = cv2.approxPolyDP(cnt, SIMPLIFY_FRAC * cv2.arcLength(cnt, True), True)
        if len(approx) < 3:
            continue

        # Mean model confidence inside this polygon — surfaced in the UI so a
        # verifier can triage low-confidence parcels first instead of
        # reviewing every shape equally.
        region = np.zeros((h, w), np.uint8)
        cv2.drawContours(region, [approx], -1, 255, cv2.FILLED)
        confidence = float(prob[region > 0].mean()) if (region > 0).any() else 0.0

        polygons.append({
            "points": approx.reshape(-1, 2),
            "area": float(cv2.contourArea(approx)),
            "confidence": confidence,
            "bbox": cv2.boundingRect(approx),
            "rect": cv2.minAreaRect(approx),
        })

    polygons.sort(key=lambda p: p["area"], reverse=True)
    return polygons, binary


def to_geojson(polygons, image_name: str):
    features = []
    for i, p in enumerate(polygons):
        ring = p["points"].tolist()
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        x, y, bw, bh = p["bbox"]
        features.append({
            "type": "Feature",
            "properties": {
                "lot_id": f"LOT_{i:04d}",
                "class": "parcel_boundary",
                "source_image": image_name,
                "area_pixels": int(p["area"]),
                "confidence": round(p["confidence"], 4),
                "vertices": int(len(p["points"])),
                "rotation_angle": round(float(p["rect"][2]), 2),
                "bbox": {"x": int(x), "y": int(y), "w": int(bw), "h": int(bh)},
            },
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })
    return {
        "type": "FeatureCollection",
        "crs_note": "pixel coordinates (col, row) — not geo-referenced",
        "source_image": image_name,
        "features": features,
    }


def render(image_bgr: np.ndarray, polygons, prob: np.ndarray):
    overlay = image_bgr.copy()
    fill = np.zeros_like(image_bgr)
    for p in polygons:
        cv2.drawContours(fill, [p["points"]], -1, (255, 190, 60), cv2.FILLED)
    overlay = cv2.addWeighted(overlay, 1.0, fill, 0.32, 0)
    for p in polygons:
        cv2.drawContours(overlay, [p["points"]], -1, (255, 210, 90), 2)

    heat = cv2.applyColorMap((prob * 255).astype(np.uint8), cv2.COLORMAP_INFERNO)
    return overlay, heat


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--checkpoint", default="ml/models/unet_parcel.pt")
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--device", default=None)
    args = ap.parse_args()

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    image_path = Path(args.input)
    output_dir = Path(args.output)
    (output_dir / "layouts").mkdir(parents=True, exist_ok=True)

    image_bgr = cv2.imread(str(image_path))
    if image_bgr is None:
        raise SystemExit(f"Could not read image: {image_path}")
    height, width = image_bgr.shape[:2]

    started = time.time()
    model, val_metrics = load_model(args.checkpoint, device)
    prob = predict_full(model, cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB), device)
    polygons, _ = vectorize(prob, args.threshold)
    elapsed = time.time() - started

    overlay, heat = render(image_bgr, polygons, prob)
    cv2.imwrite(str(output_dir / "layouts" / "annotated_result.png"), overlay)
    cv2.imwrite(str(output_dir / "layouts" / "probability.png"), heat)

    geojson = to_geojson(polygons, image_path.name)
    (output_dir / "lot_layouts.geojson").write_text(json.dumps(geojson, indent=2))

    total_area = sum(f["properties"]["area_pixels"] for f in geojson["features"])
    metadata = {
        "source_image": image_path.name,
        "image_dimensions": {"width": width, "height": height},
        "detection_type": "unet",
        "engine": "U-Net (ResNet18 encoder), trained on SRM KTR cadastral labels",
        "buildings_detected": len(polygons),
        "mean_confidence": round(
            float(np.mean([p["confidence"] for p in polygons])) if polygons else 0.0, 4
        ),
        "built_up_fraction": round(total_area / float(width * height), 4),
        "inference_seconds": round(elapsed, 2),
        "device": device,
        "validation_metrics": val_metrics.get("mean", {}),
    }
    (output_dir / "metadata.json").write_text(json.dumps(metadata, indent=2))
    print(f"[DONE] {len(polygons)} parcels in {elapsed:.2f}s ({device}) -> {output_dir}")


if __name__ == "__main__":
    main()
