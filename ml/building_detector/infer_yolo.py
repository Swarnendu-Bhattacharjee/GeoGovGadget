#!/usr/bin/env python3
"""
Runs the trained YOLO segmentation model over one image and emits the same
GIS-ready vector output as the U-Net engine.

Added because the SIH judges asked for YOLO or TensorFlow in place of OpenCV.
Worth being precise about what that swaps: OpenCV was never the detector here
— it turns predicted masks into polygons. This replaces the *detector* (U-Net
-> YOLO11-seg) and keeps the identical vectorisation stage, which is the only
way the two engines can be compared fairly.

YOLO predicts instances, not a probability field, so the tiles are merged by
painting each instance mask into one full-resolution confidence canvas, taking
the max where tiles overlap. That canvas then goes through exactly the same
vectorize() the U-Net path uses.

Writes the same file shapes as the other engines:
    lot_layouts.geojson   polygons in pixel coords, with properties
    metadata.json         counts, image size, engine name, timing
    layouts/annotated_result.png
    layouts/probability.png

Usage:
    python -m ml.building_detector.infer_yolo \
        --input img.jpg --output /tmp/out --checkpoint ml/models/yolo_parcel.pt
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np

from ml.building_detector.infer_unet import render, to_geojson, vectorize

TILE = 512
OVERLAP = 128


def _tile_starts(extent: int, tile: int, step: int):
    starts = list(range(0, max(1, extent - tile + 1), step))
    if starts[-1] + tile < extent:
        starts.append(max(0, extent - tile))
    return starts


def predict_full(model, image_bgr: np.ndarray, conf: float, device) -> np.ndarray:
    """Sliding-window YOLO inference -> one confidence canvas for the frame."""
    h, w = image_bgr.shape[:2]
    canvas = np.zeros((h, w), np.float32)
    step = max(32, TILE - OVERLAP)

    for y in _tile_starts(h, TILE, step):
        for x in _tile_starts(w, TILE, step):
            y2, x2 = min(y + TILE, h), min(x + TILE, w)
            patch = image_bgr[y:y2, x:x2]
            res = model.predict(patch, conf=conf, imgsz=640, device=device,
                                verbose=False, retina_masks=True)[0]
            if res.masks is None:
                continue
            confs = res.boxes.conf.cpu().numpy()
            masks = res.masks.data.cpu().numpy()
            for m, c in zip(masks, confs):
                if m.shape != patch.shape[:2]:
                    m = cv2.resize(m, (patch.shape[1], patch.shape[0]),
                                   interpolation=cv2.INTER_LINEAR)
                region = canvas[y:y2, x:x2]
                # Max-merge: an instance seen in two tiles keeps its best score
                # rather than summing into a false certainty.
                np.maximum(region, (m > 0.5).astype(np.float32) * float(c), out=region)
    return canvas


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--checkpoint", default="ml/models/yolo_parcel.pt")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--threshold", type=float, default=0.25)
    ap.add_argument("--device", default=None)
    args = ap.parse_args()

    import torch
    from ultralytics import YOLO

    device = args.device or (0 if torch.cuda.is_available() else "cpu")
    image_path = Path(args.input)
    output_dir = Path(args.output)
    (output_dir / "layouts").mkdir(parents=True, exist_ok=True)

    image_bgr = cv2.imread(str(image_path))
    if image_bgr is None:
        raise SystemExit(f"Could not read image: {image_path}")
    height, width = image_bgr.shape[:2]

    started = time.time()
    model = YOLO(args.checkpoint)
    prob = predict_full(model, image_bgr, args.conf, device)
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
        "detection_type": "yolo",
        "engine": "YOLO11n-seg, trained on SRM KTR cadastral labels",
        "buildings_detected": len(polygons),
        "mean_confidence": round(
            float(np.mean([p["confidence"] for p in polygons])) if polygons else 0.0, 4
        ),
        "built_up_fraction": round(total_area / float(width * height), 4),
        "inference_seconds": round(elapsed, 2),
        "device": str(device),
        "validation_metrics": {},
    }
    (output_dir / "metadata.json").write_text(json.dumps(metadata, indent=2))
    print(f"[DONE] {len(polygons)} parcels in {elapsed:.2f}s ({device}) -> {output_dir}")


if __name__ == "__main__":
    main()
