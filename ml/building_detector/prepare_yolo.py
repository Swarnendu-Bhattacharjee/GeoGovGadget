#!/usr/bin/env python3
"""
Turns the cadastral ground truth into a YOLO segmentation dataset.

The judges asked for YOLO or TensorFlow in place of OpenCV. This builds the
dataset for that comparison honestly: the same eight training sites and the
same two held-out sites the U-Net used (train_unet.VAL_SITES), so the two
detectors are scored on identical, unseen ground.

Ten labelled sites is far too little for YOLO to see whole parcels at native
resolution, so each site is cut into overlapping tiles and each connected
component of the mask becomes one polygon instance.

Usage:
    python -m ml.building_detector.prepare_yolo --out data/yolo_parcels
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import cv2
import numpy as np

from ml.building_detector.train_unet import VAL_SITES

TILE = 512
STRIDE = 160
MIN_AREA = 400          # px² in tile space; below this a blob is noise
SIMPLIFY_FRAC = 0.008   # Douglas-Peucker epsilon as a fraction of perimeter


def polygons_from_mask(mask: np.ndarray):
    """Mask crop -> normalised YOLO polygons, one per connected component."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h, w = mask.shape
    out = []
    for cnt in contours:
        if cv2.contourArea(cnt) < MIN_AREA:
            continue
        approx = cv2.approxPolyDP(cnt, SIMPLIFY_FRAC * cv2.arcLength(cnt, True), True)
        if len(approx) < 3:
            continue
        pts = approx.reshape(-1, 2).astype(np.float64)
        pts[:, 0] = np.clip(pts[:, 0] / w, 0, 1)
        pts[:, 1] = np.clip(pts[:, 1] / h, 0, 1)
        out.append(pts)
    return out


def tile_site(img, mask, split_dir: Path, stem: str, stride: int):
    h, w = mask.shape
    written = 0
    ys = list(range(0, max(1, h - TILE + 1), stride)) or [0]
    xs = list(range(0, max(1, w - TILE + 1), stride)) or [0]
    # Always include the far edges, or the right/bottom strips never train.
    if ys[-1] + TILE < h:
        ys.append(h - TILE)
    if xs[-1] + TILE < w:
        xs.append(w - TILE)

    for y in ys:
        for x in xs:
            y2, x2 = min(y + TILE, h), min(x + TILE, w)
            im_c = img[y:y2, x:x2]
            mk_c = mask[y:y2, x:x2]
            if im_c.shape[0] < 64 or im_c.shape[1] < 64:
                continue
            polys = polygons_from_mask(mk_c)
            if not polys:
                continue  # an all-background tile teaches YOLO nothing here
            name = f"{stem}_{y:05d}_{x:05d}"
            cv2.imwrite(str(split_dir / "images" / f"{name}.jpg"), im_c,
                        [cv2.IMWRITE_JPEG_QUALITY, 95])
            lines = []
            for p in polys:
                coords = " ".join(f"{v:.6f}" for v in p.reshape(-1))
                lines.append(f"0 {coords}")
            (split_dir / "labels" / f"{name}.txt").write_text("\n".join(lines))
            written += 1
    return written


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default="data/ground_truth")
    ap.add_argument("--out", default="data/yolo_parcels")
    ap.add_argument("--stride", type=int, default=STRIDE)
    args = ap.parse_args()

    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    for split in ("train", "val"):
        (out / split / "images").mkdir(parents=True)
        (out / split / "labels").mkdir(parents=True)

    totals = {"train": 0, "val": 0}
    for site_dir in sorted(p for p in Path(args.data).iterdir() if p.is_dir()):
        img_p, mask_p = site_dir / "image.jpg", site_dir / "mask.png"
        if not (img_p.exists() and mask_p.exists()):
            continue
        img = cv2.imread(str(img_p))
        mask = (cv2.imread(str(mask_p), cv2.IMREAD_GRAYSCALE) > 127).astype(np.uint8) * 255
        split = "val" if site_dir.name in VAL_SITES else "train"
        stem = site_dir.name.replace(" ", "_").replace(",", "")
        n = tile_site(img, mask, out / split, stem, args.stride)
        totals[split] += n
        print(f"  {site_dir.name:32} -> {split:5} {n:4d} tiles")

    (out / "data.yaml").write_text(
        f"path: {out.resolve()}\ntrain: train/images\nval: val/images\n"
        "names:\n  0: parcel\n"
    )
    print(f"\ntrain {totals['train']} tiles · val {totals['val']} tiles -> {out}/data.yaml")


if __name__ == "__main__":
    main()
