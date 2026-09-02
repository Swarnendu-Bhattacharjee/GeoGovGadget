#!/usr/bin/env python3
"""
Thin CLI wrapper around detect.py's SAM pipeline for the live web tool.

Why this exists: app/api/detect/route.js originally called
GeoGov/geo_gov_detector.py (classical OpenCV thresholding). That pipeline
has no learnable parameters — "training" it means hand-tuning fixed
thresholds — and no amount of tuning got it past a real ceiling on messy
real-world photos: it either merged unrelated regions into one blob
(global brightness thresholding can't separate touching same-brightness
objects) or, once switched to edge-based candidates, fragmented a single
building into many small window/texture-edge pieces. ml/building_detector's
SAM-based pipeline (detect.py) is what actually generated this repo's real
SRM dataset (data/outputs/*) for exactly this reason — it understands "this
is one object" semantically instead of by brightness/edges. This wrapper
just calls that pipeline and writes output in the same shape
GeoGov/geo_gov_detector.py used to, so the API route and frontend didn't
need to change.

Usage:
    python -m ml.building_detector.run_for_web \\
        --input path/to/image.jpg --output /tmp/out \\
        --checkpoint ml/models/sam_vit_b_01ec64.pth --model-type vit_b
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from ml.building_detector.detect import (
    FilterConfig,
    detect_building_masks,
    load_sam_mask_generator,
    masks_to_polygons,
    render_outputs,
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--model-type", default="vit_b", choices=["vit_b", "vit_l", "vit_h"])
    parser.add_argument("--device", default=None)
    args = parser.parse_args()

    image_path = Path(args.input)
    output_dir = Path(args.output)
    layouts_dir = output_dir / "layouts"
    layouts_dir.mkdir(parents=True, exist_ok=True)

    image_bgr = cv2.imread(str(image_path))
    if image_bgr is None:
        raise SystemExit(f"Could not read image: {image_path}")
    height, width = image_bgr.shape[:2]

    import torch

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    mask_generator = load_sam_mask_generator(args.checkpoint, args.model_type, device)

    masks = detect_building_masks(image_bgr, mask_generator, FilterConfig())
    polygons = masks_to_polygons(masks)
    overlay, _mask_img, _edges_bgr = render_outputs(image_bgr, masks, polygons)
    cv2.imwrite(str(layouts_dir / "annotated_result.png"), overlay)

    features = []
    for i, poly in enumerate(polygons):
        ring = poly.tolist()
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        poly_f32 = poly.astype(np.float32)
        area = float(cv2.contourArea(poly_f32))
        rect = cv2.minAreaRect(poly_f32)
        bbox = cv2.boundingRect(poly.astype(np.int32))
        features.append({
            "type": "Feature",
            "properties": {
                "lot_id": f"LOT_{i:04d}",
                "source_image": image_path.name,
                "area_pixels": int(area),
                "vertices": int(len(poly)),
                "rotation_angle": round(float(rect[2]), 2),
                "bbox": {"x": int(bbox[0]), "y": int(bbox[1]), "w": int(bbox[2]), "h": int(bbox[3])},
            },
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })
    features.sort(key=lambda f: f["properties"]["area_pixels"], reverse=True)

    geojson = {"type": "FeatureCollection", "features": features}
    (output_dir / "lot_layouts.geojson").write_text(json.dumps(geojson, indent=2))

    metadata = {
        "source_image": image_path.name,
        "image_dimensions": {"width": width, "height": height},
        "detection_type": "sam",
        "buildings_detected": len(features),
    }
    (output_dir / "metadata.json").write_text(json.dumps(metadata, indent=2))

    print(f"[DONE] {len(features)} footprints -> {output_dir}")


if __name__ == "__main__":
    main()
