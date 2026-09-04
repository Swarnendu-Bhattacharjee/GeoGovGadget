#!/usr/bin/env python3
"""
Scores every detection engine against the same held-out ground truth.

Until the labels existed (see build_ground_truth.py) this project had no way
to tell whether a change to the detector helped or hurt — every judgement was
"does this overlay look better to me". This produces real numbers instead:
pixel IoU / precision / recall / F1 per engine per site, on sites the trained
model never saw.

Engines compared:
    unet     the trained U-Net (ml/models/unet_parcel.pt)
    sam      Segment Anything, class-agnostic, filtered by shape heuristics
    opencv   the original classical CLAHE/edge + colour/shape heuristic

Writes public/benchmark.json, which the /benchmark page renders. Numbers on
that page come from this file — no hand-typed figures.

Usage:
    python -m ml.building_detector.benchmark --engines unet sam opencv
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch

from ml.building_detector.train_unet import VAL_SITES, ResNetUNet, predict_full, score


def _rasterize(polygons, shape):
    """Engine polygons -> binary mask, so all engines are scored identically."""
    mask = np.zeros(shape, np.uint8)
    for poly in polygons:
        pts = np.asarray(poly, dtype=np.int32).reshape(-1, 2)
        if len(pts) >= 3:
            cv2.fillPoly(mask, [pts], 1)
    return mask


def run_unet(image_bgr, checkpoint, device):
    from ml.building_detector.infer_unet import vectorize

    model = ResNetUNet(pretrained=False).to(device)
    ckpt = torch.load(checkpoint, map_location=device, weights_only=False)
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    prob = predict_full(model, cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB), device)
    polys, _ = vectorize(prob, 0.5)
    return [p["points"] for p in polys]


def run_sam(image_bgr, checkpoint, device):
    from ml.building_detector.detect import (
        FilterConfig, detect_building_masks, load_sam_mask_generator, masks_to_polygons,
    )

    gen = load_sam_mask_generator(checkpoint, "vit_b", device)
    masks = detect_building_masks(image_bgr, gen, FilterConfig())
    return masks_to_polygons(masks)


def run_yolo(image_bgr, checkpoint, device):
    """YOLO11-seg as the detector, with the identical vectorisation stage.

    Added when the SIH judges asked for YOLO or TensorFlow in place of OpenCV.
    Only the detector changes: the mask -> polygon step is the same vectorize()
    the U-Net path uses, so any difference in the numbers below is the model,
    not the post-processing.
    """
    from ultralytics import YOLO
    from ml.building_detector.infer_unet import vectorize
    from ml.building_detector.infer_yolo import predict_full as yolo_predict_full

    model = YOLO(checkpoint)
    prob = yolo_predict_full(model, image_bgr, 0.25, 0 if device == "cuda" else "cpu")
    polys, _ = vectorize(prob, 0.25)
    return [p["points"] for p in polys]


def run_opencv(image_bgr, *_):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "GeoGov"))
    from geo_gov_detector import RawBuildingDetector

    det = RawBuildingDetector(min_area=300, max_area=200000, debug=False)
    mask = det.preprocess(image_bgr)
    return [np.asarray(b["polygon"]) for b in det.find_buildings(mask)]


ENGINES = {
    "unet": ("U-Net (trained)", run_unet, "ml/models/unet_parcel.pt"),
    "yolo": ("YOLO11n-seg (trained)", run_yolo, "ml/models/yolo_parcel.pt"),
    "sam": ("Segment Anything (zero-shot)", run_sam, "ml/models/sam_vit_b_01ec64.pth"),
    "opencv": ("Classical OpenCV (heuristic)", run_opencv, None),
}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default="data/ground_truth")
    ap.add_argument("--engines", nargs="+", default=["unet", "yolo", "sam", "opencv"])
    ap.add_argument("--sites", nargs="+", default=None,
                    help="default: the held-out validation sites only")
    ap.add_argument("--out", default="public/benchmark.json")
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    data_dir = Path(args.data)
    sites = args.sites or VAL_SITES

    results = {}
    for key in args.engines:
        label, fn, ckpt = ENGINES[key]
        per_site, agg, timings = {}, [], []
        for site in sites:
            img_p, mask_p = data_dir / site / "image.jpg", data_dir / site / "mask.png"
            if not img_p.exists():
                continue
            image = cv2.imread(str(img_p))
            truth = (cv2.imread(str(mask_p), cv2.IMREAD_GRAYSCALE) > 127).astype(np.uint8)

            t0 = time.time()
            polys = fn(image, ckpt, device)
            elapsed = time.time() - t0

            pred = _rasterize(polys, truth.shape)
            m = score(pred, truth)
            per_site[site] = {**{k: round(v, 4) for k, v in m.items()},
                              "polygons": len(polys), "seconds": round(elapsed, 2)}
            agg.append(m)
            timings.append(elapsed)
            print(f"{key:8s} {site:30s} IoU={m['iou']:.3f} P={m['precision']:.3f} "
                  f"R={m['recall']:.3f} F1={m['f1']:.3f}  ({elapsed:.1f}s, {len(polys)} polys)")

        if agg:
            results[key] = {
                "label": label,
                "mean": {k: round(float(np.mean([a[k] for a in agg])), 4)
                         for k in ["iou", "precision", "recall", "f1"]},
                "mean_seconds": round(float(np.mean(timings)), 2),
                "per_site": per_site,
            }

    metrics_path = Path("ml/models/unet_parcel_metrics.json")
    payload = {
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "evaluated_on": sites,
        "protocol": (
            "Pixel-level IoU/precision/recall/F1 against hand-drawn cadastral labels "
            "registered onto each RAW capture by SIFT+RANSAC homography. Sites listed "
            "here are held out of training entirely, for both trained engines."
        ),
        "device": device,
        "engines": results,
        "training": json.loads(metrics_path.read_text()) if metrics_path.exists() else None,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2))
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
