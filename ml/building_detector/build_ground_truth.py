#!/usr/bin/env python3
"""
Builds a pixel-aligned (satellite image -> building mask) ground-truth dataset.

Where the labels come from
--------------------------
`data/pranav images/.../satellite plotted building/` holds, for each of the 10
SRM KTR sites, the same satellite view as `data/IMAGES/RAW/` but with every
building footprint outlined (and often filled) in red. Those red polygons are
hand-drawn ground truth — the only real labels this project has.

They are not framed identically to the RAW captures (different scale, slight
rotation, wider crop), so they can't be used as labels directly. But unlike
the RAW-vs-PLOTTED schematic pairing — which an earlier attempt correctly
rejected at 8/200 ORB inliers, because a photo and a flat map render share no
texture — these are *the same photograph*, so SIFT+RANSAC registers them
cleanly at 1500-3100 inliers. That homography is what makes the labels usable.

What it writes, per site, into data/ground_truth/<site>/:
    image.jpg    the RAW satellite capture (model input)
    mask.png     binary building mask, warped into that image's pixel space
    overlay.jpg  mask drawn on the image, for eyeballing the alignment
    meta.json    pairing + registration diagnostics (inliers, matched label file)

Usage:
    python -m ml.building_detector.build_ground_truth \\
        --annotated "data/pranav images/satellite plotted building" \\
        --raw data/IMAGES/RAW \\
        --output data/ground_truth
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}

# The annotation red is a saturated pure red; wraps around both ends of the
# OpenCV hue circle, so it takes two ranges.
RED_RANGES = [((0, 90, 70), (12, 255, 255)), ((168, 90, 70), (180, 255, 255))]

MIN_INLIERS = 40
MIN_BLOB_AREA = 250


def list_images(folder: Path) -> list[Path]:
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTS)


def red_annotation_mask(annotated_bgr: np.ndarray) -> np.ndarray:
    """Binary mask of the hand-drawn red building polygons (outline or fill)."""
    hsv = cv2.cvtColor(annotated_bgr, cv2.COLOR_BGR2HSV)
    red = np.zeros(hsv.shape[:2], dtype=np.uint8)
    for lo, hi in RED_RANGES:
        red |= cv2.inRange(hsv, lo, hi)

    # Bridge dashes / anti-aliasing gaps so each outline is a closed loop.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    red = cv2.morphologyEx(red, cv2.MORPH_CLOSE, kernel, iterations=2)

    # Fill each loop. Handles both annotation styles the labels use:
    # outline-only (fill the enclosed area) and translucent-fill (already
    # solid, so filling is a no-op).
    filled = np.zeros_like(red)
    contours, _ = cv2.findContours(red, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in contours:
        if cv2.contourArea(c) >= MIN_BLOB_AREA:
            cv2.drawContours(filled, [c], -1, 255, thickness=cv2.FILLED)

    return cv2.morphologyEx(filled, cv2.MORPH_OPEN, kernel, iterations=1)


def register(annotated_gray: np.ndarray, raw_gray: np.ndarray, sift, matcher):
    """Homography mapping annotated-image pixels -> raw-image pixels."""
    ka, da = sift.detectAndCompute(annotated_gray, None)
    kr, dr = sift.detectAndCompute(raw_gray, None)
    if da is None or dr is None:
        return None, 0

    good = [m for m, n in matcher.knnMatch(da, dr, k=2) if m.distance < 0.75 * n.distance]
    if len(good) < 12:
        return None, 0

    src = np.float32([ka[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kr[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    H, inlier_mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
    if H is None:
        return None, 0
    return H, int(inlier_mask.sum())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--annotated", required=True)
    parser.add_argument("--raw", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    annotated_paths = list_images(Path(args.annotated))
    raw_paths = list_images(Path(args.raw))
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    sift = cv2.SIFT_create(nfeatures=8000)
    matcher = cv2.BFMatcher()

    raws = []
    for p in raw_paths:
        img = cv2.imread(str(p))
        if img is not None:
            raws.append((p, img, cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)))

    summary = []
    for ann_path in annotated_paths:
        ann = cv2.imread(str(ann_path))
        if ann is None:
            continue
        ann_gray = cv2.cvtColor(ann, cv2.COLOR_BGR2GRAY)

        # Each label is matched to whichever RAW capture it registers to best,
        # so the pairing doesn't depend on filenames (the label files are named
        # by content hash, and the two folders name sites differently anyway).
        best = (0, None, None, None)
        for raw_path, raw_img, raw_gray in raws:
            H, inliers = register(ann_gray, raw_gray, sift, matcher)
            if H is not None and inliers > best[0]:
                best = (inliers, raw_path, raw_img, H)

        inliers, raw_path, raw_img, H = best
        if inliers < MIN_INLIERS:
            print(f"[SKIP] {ann_path.name}: no confident match (best {inliers} inliers)")
            continue

        mask = red_annotation_mask(ann)
        h, w = raw_img.shape[:2]
        warped = cv2.warpPerspective(mask, H, (w, h), flags=cv2.INTER_NEAREST)

        site = raw_path.stem
        site_dir = output_dir / site
        site_dir.mkdir(parents=True, exist_ok=True)

        overlay = raw_img.copy()
        tint = np.zeros_like(raw_img)
        tint[warped > 0] = (0, 200, 255)
        overlay = cv2.addWeighted(overlay, 1.0, tint, 0.45, 0)
        contours, _ = cv2.findContours(warped, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(overlay, contours, -1, (0, 80, 255), 2)

        cv2.imwrite(str(site_dir / "image.jpg"), raw_img)
        cv2.imwrite(str(site_dir / "mask.png"), warped)
        cv2.imwrite(str(site_dir / "overlay.jpg"), overlay)

        coverage = float((warped > 0).sum()) / (h * w)
        meta = {
            "site": site,
            "raw_image": raw_path.name,
            "annotation_image": ann_path.name,
            "registration_inliers": inliers,
            "building_polygons": len(contours),
            "mask_coverage_frac": round(coverage, 4),
            "image_size": {"width": w, "height": h},
        }
        (site_dir / "meta.json").write_text(json.dumps(meta, indent=2))
        summary.append(meta)
        print(f"[OK] {site:32s} inliers={inliers:5d}  polygons={len(contours):3d}  coverage={coverage:.1%}")

    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    print(f"\n{len(summary)} sites written to {output_dir}")


if __name__ == "__main__":
    main()
