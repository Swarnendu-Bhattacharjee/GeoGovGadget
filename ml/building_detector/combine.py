"""Combines RAW (photo) and PLOTTED (schematic) detections for the same site.

Why both: the RAW satellite photos have real tree canopy sitting on top of
building roofs, which hides or breaks up footprints when detecting from
the photo alone (detect.py, SAM-based). The PLOTTED schematic renders have
zero vegetation occlusion — Google Maps already drew every building as a
clean solid shape — so plotted_extractor.py reads footprints straight off
those instead, immune to greenery.

These two images are NOT pixel-aligned: PLOTTED is a flat schematic map
render (different projection/zoom/rotation) of the same location, not a
photo-realistic annotation of RAW. An ORB+RANSAC homography registration
attempt between a RAW/PLOTTED pair was tested and rejected — 8 inliers out
of 200 candidate matches, i.e. no reliable geometric correspondence — so
this script does NOT attempt to warp one onto the other's pixel space.
Instead it runs both detectors independently and reports them side by
side: RAW/SAM for photo-accurate outlines (weak under tree cover), PLOTTED
for vegetation-immune clean polygons/rectangles (weak on anything Google's
map style didn't draw, e.g. under-construction structures).

Usage:
    python -m ml.building_detector.combine \\
        --raw-dir path/to/RAW --plotted-dir path/to/PLOTTED \\
        --output data/outputs/combined \\
        --checkpoint ml/models/sam_vit_b_01ec64.pth --model-type vit_b
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import cv2
import numpy as np

from ml.building_detector.detect import (
    FilterConfig,
    detect_building_masks,
    load_sam_mask_generator,
    masks_to_polygons,
    polygons_to_geojson,
    render_outputs,
)
from ml.building_detector.plotted_extractor import (
    PlottedFilterConfig,
    extract_plotted_footprints,
    render_plotted_overlay,
    shapes_to_geojson,
)

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}
STOPWORDS = {"and", "the", "from", "at", "of"}


def _tokens(name: str) -> set[str]:
    words = re.split(r"[^a-z0-9]+", name.lower())
    return {w for w in words if w and w not in STOPWORDS}


def match_pairs(raw_dir: Path, plotted_dir: Path) -> list[tuple[Path, Path, float]]:
    """Fuzzy-matches RAW/PLOTTED files by filename word overlap (Jaccard)."""
    raw_files = [p for p in raw_dir.iterdir() if p.suffix.lower() in IMAGE_EXTS]
    plotted_files = [p for p in plotted_dir.iterdir() if p.suffix.lower() in IMAGE_EXTS]

    pairs = []
    used_plotted = set()
    for r in raw_files:
        r_tokens = _tokens(r.stem)
        best, best_score = None, 0.0
        for p in plotted_files:
            if p in used_plotted:
                continue
            p_tokens = _tokens(p.stem)
            union = r_tokens | p_tokens
            score = len(r_tokens & p_tokens) / len(union) if union else 0.0
            if score > best_score:
                best, best_score = p, score
        if best is not None and best_score > 0:
            pairs.append((r, best, best_score))
            used_plotted.add(best)
    return pairs


def stack_side_by_side(left: np.ndarray, right: np.ndarray, left_label: str, right_label: str) -> np.ndarray:
    target_h = 700
    def resize(im):
        h, w = im.shape[:2]
        scale = target_h / h
        return cv2.resize(im, (int(w * scale), target_h))

    left_r, right_r = resize(left), resize(right)
    header_h = 34
    gap = 6
    total_w = left_r.shape[1] + right_r.shape[1] + gap
    canvas = np.full((target_h + header_h, total_w, 3), 24, dtype=np.uint8)
    canvas[header_h:, : left_r.shape[1]] = left_r
    canvas[header_h:, left_r.shape[1] + gap :] = right_r
    cv2.putText(canvas, left_label, (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(
        canvas, right_label, (left_r.shape[1] + gap + 8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA
    )
    return canvas


def process_pair(raw_path: Path, plotted_path: Path, output_dir: Path, mask_generator):
    raw_bgr = cv2.imread(str(raw_path))
    plotted_bgr = cv2.imread(str(plotted_path))
    if raw_bgr is None or plotted_bgr is None:
        raise ValueError(f"Could not read {raw_path} or {plotted_path}")

    raw_masks = detect_building_masks(raw_bgr, mask_generator, FilterConfig())
    raw_polygons = masks_to_polygons(raw_masks)
    raw_overlay, _, _ = render_outputs(raw_bgr, raw_masks, raw_polygons)
    raw_geojson = polygons_to_geojson(raw_polygons, raw_path.name)

    plotted_shapes = extract_plotted_footprints(plotted_bgr, PlottedFilterConfig())
    plotted_overlay = render_plotted_overlay(plotted_bgr, plotted_shapes)
    plotted_geojson = shapes_to_geojson(plotted_shapes, plotted_path.name)

    combined = {
        "site": raw_path.stem,
        "registration_note": (
            "RAW and PLOTTED are independent, unregistered views of the same site "
            "(ORB+RANSAC homography attempt yielded 8/200 inliers, rejected). "
            "Coordinates below are pixel space local to each image, not fused."
        ),
        "raw_photo": raw_geojson,
        "plotted_schematic": plotted_geojson,
    }

    out_dir = output_dir / raw_path.stem
    out_dir.mkdir(parents=True, exist_ok=True)
    side_by_side = stack_side_by_side(
        raw_overlay,
        plotted_overlay,
        f"RAW photo + SAM ({len(raw_polygons)} footprints, vegetation-limited)",
        f"PLOTTED schematic ({len(plotted_shapes)} footprints, vegetation-free)",
    )
    cv2.imwrite(str(out_dir / "raw_overlay.jpg"), raw_overlay)
    cv2.imwrite(str(out_dir / "plotted_overlay.jpg"), plotted_overlay)
    cv2.imwrite(str(out_dir / "side_by_side.jpg"), side_by_side, [cv2.IMWRITE_JPEG_QUALITY, 92])
    (out_dir / "combined.geojson").write_text(json.dumps(combined, indent=2))

    return len(raw_polygons), len(plotted_shapes), out_dir


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--raw-dir", required=True)
    parser.add_argument("--plotted-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--model-type", default="vit_b", choices=["vit_b", "vit_l", "vit_h"])
    parser.add_argument("--device", default=None)
    args = parser.parse_args()

    import torch

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Loading SAM ({args.model_type}) on {device} ...")
    mask_generator = load_sam_mask_generator(args.checkpoint, args.model_type, device)

    raw_dir, plotted_dir, output_dir = Path(args.raw_dir), Path(args.plotted_dir), Path(args.output)
    pairs = match_pairs(raw_dir, plotted_dir)
    print(f"Matched {len(pairs)} RAW/PLOTTED pairs by filename overlap:")
    for r, p, score in pairs:
        print(f"  {r.name}  <->  {p.name}  (score={score:.2f})")

    for r, p, _ in pairs:
        n_raw, n_plotted, out_dir = process_pair(r, p, output_dir, mask_generator)
        print(f"{r.stem}: raw={n_raw} footprints, plotted={n_plotted} footprints -> {out_dir}")


if __name__ == "__main__":
    main()
