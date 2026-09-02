"""Building footprint detection on aerial/satellite images.

Uses a pretrained Segment Anything (SAM) model to propose class-agnostic
masks, then filters those masks down to the ones that look like building
rooftops (compact, non-elongated, not background-sized) — the same shape
heuristics a person uses when eyeballing an orthophoto. No training data
required: this is the "pretrained + post-processing" path from
PROJECT_PLAN.md, standing in for the from-scratch Mask R-CNN/U-Net that
would come later with real labeled data.

For each input image this writes, into <output>/<image_stem>/:
  overlay.jpg       original image with detected footprints outlined
  mask.png          binary mask (white = building)
  edges.png         mask boundaries only, on black (matches the
                     raw|mask|edges triptych style in EXAMPLE/)
  footprints.geojson  polygons in PIXEL coordinates (col, row) — these
                     images aren't geo-referenced, so there's no lng/lat
                     transform available. See "Wiring into the app" in
                     this package's README for how to turn this into the
                     lng/lat GeoJSON app/api/segment expects once a
                     geotransform (or the app's on-screen image bounds)
                     is available.

Usage:
    python -m ml.building_detector.detect \\
        --input path/to/image_or_folder \\
        --output ml/../data/outputs/buildings \\
        --checkpoint ml/models/sam_vit_b_01ec64.pth \\
        --model-type vit_b
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}


@dataclass
class FilterConfig:
    min_area_frac: float = 0.0003   # drop specks smaller than this fraction of the image
    max_area_frac: float = 0.35     # drop blobs this large — almost certainly background/ground
    min_solidity: float = 0.55      # area / convex-hull area; rooftops are fairly convex
    max_aspect_ratio: float = 6.0   # drop long thin slivers (roads, shadows, path overlays)
    border_touch_frac: float = 0.98  # drop masks whose bbox spans nearly the whole frame


def load_sam_mask_generator(checkpoint: str, model_type: str, device: str):
    from segment_anything import SamAutomaticMaskGenerator, sam_model_registry

    sam = sam_model_registry[model_type](checkpoint=checkpoint)
    sam.to(device=device)
    return SamAutomaticMaskGenerator(
        sam,
        points_per_side=32,
        pred_iou_thresh=0.88,
        stability_score_thresh=0.92,
        min_mask_region_area=200,
    )


def _is_building_like(mask: np.ndarray, image_area: int, cfg: FilterConfig) -> bool:
    area = int(mask.sum())
    if area == 0:
        return False
    area_frac = area / image_area
    if area_frac < cfg.min_area_frac or area_frac > cfg.max_area_frac:
        return False

    mask_u8 = (mask.astype(np.uint8)) * 255
    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return False
    contour = max(contours, key=cv2.contourArea)

    hull = cv2.convexHull(contour)
    hull_area = cv2.contourArea(hull)
    if hull_area <= 0:
        return False
    solidity = cv2.contourArea(contour) / hull_area
    if solidity < cfg.min_solidity:
        return False

    x, y, w, h = cv2.boundingRect(contour)
    if w == 0 or h == 0:
        return False
    aspect_ratio = max(w, h) / min(w, h)
    if aspect_ratio > cfg.max_aspect_ratio:
        return False

    img_h, img_w = mask.shape
    if w / img_w > cfg.border_touch_frac and h / img_h > cfg.border_touch_frac:
        return False

    return True


def detect_building_masks(
    image_bgr: np.ndarray, mask_generator, cfg: FilterConfig | None = None
) -> list[np.ndarray]:
    """Returns a list of boolean masks, one per detected building footprint."""
    cfg = cfg or FilterConfig()
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    proposals = mask_generator.generate(image_rgb)
    image_area = image_bgr.shape[0] * image_bgr.shape[1]

    kept = []
    for p in proposals:
        seg = p["segmentation"]
        if _is_building_like(seg, image_area, cfg):
            kept.append(seg)
    return kept


def masks_to_polygons(masks: list[np.ndarray], epsilon_frac: float = 0.004) -> list[np.ndarray]:
    """Simplifies each mask's outer contour into a polygon (Nx2 array of x,y)."""
    polygons = []
    for mask in masks:
        mask_u8 = (mask.astype(np.uint8)) * 255
        contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        contour = max(contours, key=cv2.contourArea)
        epsilon = epsilon_frac * cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, epsilon, True)
        polygons.append(approx.reshape(-1, 2))
    return polygons


def render_outputs(image_bgr: np.ndarray, masks: list[np.ndarray], polygons: list[np.ndarray]):
    h, w = image_bgr.shape[:2]

    overlay = image_bgr.copy()
    for poly in polygons:
        cv2.polylines(overlay, [poly.astype(np.int32)], isClosed=True, color=(0, 220, 255), thickness=3)

    mask_img = np.zeros((h, w), dtype=np.uint8)
    for m in masks:
        mask_img[m] = 255

    edges = cv2.Canny(mask_img, 50, 150)
    edges_bgr = cv2.cvtColor(edges, cv2.COLOR_GRAY2BGR)

    return overlay, mask_img, edges_bgr


def polygons_to_geojson(polygons: list[np.ndarray], image_name: str) -> dict:
    features = []
    for i, poly in enumerate(polygons):
        ring = poly.tolist()
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        features.append(
            {
                "type": "Feature",
                "properties": {"id": f"{Path(image_name).stem}_{i}", "class": "building_footprint"},
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        )
    return {
        "type": "FeatureCollection",
        "crs_note": "pixel coordinates (col, row) — not geo-referenced",
        "source_image": image_name,
        "features": features,
    }


def process_image(image_path: Path, output_dir: Path, mask_generator, cfg: FilterConfig):
    image_bgr = cv2.imread(str(image_path))
    if image_bgr is None:
        raise ValueError(f"Could not read image: {image_path}")

    masks = detect_building_masks(image_bgr, mask_generator, cfg)
    polygons = masks_to_polygons(masks)
    overlay, mask_img, edges_bgr = render_outputs(image_bgr, masks, polygons)
    geojson = polygons_to_geojson(polygons, image_path.name)

    out_dir = output_dir / image_path.stem
    out_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_dir / "overlay.jpg"), overlay)
    cv2.imwrite(str(out_dir / "mask.png"), mask_img)
    cv2.imwrite(str(out_dir / "edges.png"), edges_bgr)
    (out_dir / "footprints.geojson").write_text(json.dumps(geojson, indent=2))

    return len(polygons), out_dir


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", required=True, help="Image file or folder of images")
    parser.add_argument("--output", required=True, help="Output folder")
    parser.add_argument("--checkpoint", required=True, help="Path to SAM checkpoint (.pth)")
    parser.add_argument("--model-type", default="vit_b", choices=["vit_b", "vit_l", "vit_h"])
    parser.add_argument("--device", default=None, help="cuda / cpu (default: auto-detect)")
    args = parser.parse_args()

    import torch

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Loading SAM ({args.model_type}) on {device} ...")
    mask_generator = load_sam_mask_generator(args.checkpoint, args.model_type, device)

    input_path = Path(args.input)
    output_dir = Path(args.output)
    if input_path.is_dir():
        image_paths = sorted(p for p in input_path.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    else:
        image_paths = [input_path]

    cfg = FilterConfig()
    for image_path in image_paths:
        n, out_dir = process_image(image_path, output_dir, mask_generator, cfg)
        print(f"{image_path.name}: {n} footprints -> {out_dir}")


if __name__ == "__main__":
    main()
