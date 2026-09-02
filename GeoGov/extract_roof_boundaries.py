#!/usr/bin/env python3
"""
GeoGovGadget 2.0 - Roof Boundary Extractor

Extracts ONLY roof boundaries (building outlines) from RAW satellite images.
Creates a single composite image showing all building roof footprints as
bordered outlines, plus a GeoJSON of all polygons.

Usage:
    python3 extract_roof_boundaries.py --input-dir /path/to/raw/images/ --output-dir ./output

The detector auto-detects image type and uses the RAW pipeline for satellite
imagery. For each image, it extracts building contours and renders them as
outlined polygons on a composite canvas.

Author: Pranjal Das / Hermes Agent
"""
import cv2
import numpy as np
import argparse
import json
import os
from pathlib import Path
from datetime import datetime

# Import the detector classes from geo_gov_detector
from geo_gov_detector import RawBuildingDetector


def extract_roofs(image_path, min_area=300, max_area=200000, debug=False):
    """Run RAW detector on a single image and return building polygons."""
    detector = RawBuildingDetector(min_area=min_area, max_area=max_area, debug=debug)
    image = cv2.imread(str(image_path))
    if image is None:
        raise FileNotFoundError(f"Could not load image: {image_path}")

    mask = detector.preprocess(image)
    buildings = detector.find_buildings(mask)

    # If no buildings found, try inverted image (dark images / inverted contrast)
    if len(buildings) == 0:
        inverted = cv2.bitwise_not(image)
        mask_inv = detector.preprocess(inverted)
        buildings = detector.find_buildings(mask_inv)
        if len(buildings) > 0:
            print(f"  [INFO] Inversion fallback: found {len(buildings)} buildings")

    return image, mask, buildings


def create_composite_image(images_data, canvas_size=None):
    """
    Create a composite image with all roof boundaries overlaid.
    Each building gets a unique border color for identification.
    """
    if canvas_size is None:
        # Use the largest image dimensions as canvas
        max_w = max(img.shape[1] for img, _, _ in images_data)
        max_h = max(img.shape[0] for img, _, _ in images_data)
        canvas_size = (max_h, max_w, 3)

    # White background canvas
    canvas = np.full(canvas_size, 255, dtype=np.uint8)

    # Color palette for different images
    colors = [
        (0, 255, 0),      # green
        (0, 0, 255),      # red
        (255, 0, 0),      # blue
        (0, 255, 255),    # yellow
        (255, 0, 255),    # magenta
        (255, 165, 0),    # orange
        (128, 0, 128),    # purple
        (0, 128, 128),    # teal
        (128, 128, 0),    # olive
        (128, 0, 0),      # maroon
    ]

    all_lots = []
    lot_counter = 0

    for img_idx, (image, mask, buildings) in enumerate(images_data):
        color = colors[img_idx % len(colors)]

        for b in buildings:
            polygon = b["polygon"]
            # Draw roof boundary as outlined polygon
            pts = np.array(polygon, np.int32).reshape((-1, 1, 2))
            cv2.polylines(canvas, [pts], True, color, 3)

            # Fill with semi-transparent color for visibility
            overlay = canvas.copy()
            cv2.fillPoly(overlay, [pts], color)
            canvas = cv2.addWeighted(canvas, 0.8, overlay, 0.2, 0)

            # Label
            bbox = b["bbox"]
            M = cv2.moments(np.array(polygon, np.int32).reshape((-1, 1, 2)))
            if M["m00"] != 0:
                cx = int(M["m10"] / M["m00"])
                cy = int(M["m01"] / M["m00"])
                cv2.putText(canvas, str(lot_counter), (cx, cy),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)

            all_lots.append({
                "lot_id": f"LOT_{lot_counter:04d}",
                "source_image": "",
                "building_polygon": polygon,
                "area_pixels": b["area"],
                "vertices": b["vertices"],
                "bbox": bbox,
                "rotation_angle": b["rotation_angle"],
                "solidity": b["solidity"],
                "color_bgr": list(color),
            })
            lot_counter += 1

    return canvas, all_lots


def to_geojson(lots, image_dims, names):
    """Convert all lots to GeoJSON."""
    features = []
    for i, lot in enumerate(lots):
        feature = {
            "type": "Feature",
            "properties": {
                "lot_id": lot["lot_id"],
                "source_image": lot["source_image"],
                "area_pixels": lot["area_pixels"],
                "vertices": lot["vertices"],
                "rotation_angle": lot["rotation_angle"],
                "bbox": lot["bbox"],
                "solidity": lot["solidity"],
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[list(pt) for pt in lot["building_polygon"]]]
            }
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Extract roof boundaries from RAW satellite images"
    )
    parser.add_argument("--input-dir", "-i", required=True,
                        help="Directory containing RAW satellite images")
    parser.add_argument("--output-dir", "-o", default="./output_roofs",
                        help="Output directory for composite results")
    parser.add_argument("--min-area", type=int, default=300,
                        help="Minimum building area in pixels")
    parser.add_argument("--max-area", type=int, default=200000,
                        help="Maximum building area in pixels")
    parser.add_argument("--debug", action="store_true",
                        help="Save debug images")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Collect all images
    image_extensions = {'.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp'}
    images = sorted([f for f in input_dir.iterdir()
                     if f.suffix.lower() in image_extensions])

    if not images:
        print(f"[ERROR] No images found in {input_dir}")
        return

    print(f"[INFO] Processing {len(images)} RAW satellite images from {input_dir}")
    print(f"[INFO] Output: {output_dir}")

    images_data = []
    all_lots = []
    lot_counter = 0
    max_w = 0
    max_h = 0

    for img_path in images:
        print(f"\n[INFO] Processing: {img_path.name}")
        try:
            image, mask, buildings = extract_roofs(
                img_path, args.min_area, args.max_area, args.debug
            )
        except Exception as e:
            print(f"  [ERROR] Failed: {e}")
            continue

        h, w = image.shape[:2]
        max_w = max(max_w, w)
        max_h = max(max_h, h)

        # Per-image output
        img_output_dir = output_dir / f"roofs_{img_path.stem}"
        img_output_dir.mkdir(parents=True, exist_ok=True)

        # Draw roof boundaries on the original image
        result = image.copy()
        for idx, b in enumerate(buildings):
            polygon = b["polygon"]
            pts = np.array(polygon, np.int32).reshape((-1, 1, 2))
            cv2.polylines(result, [pts], True, (0, 255, 0), 3)
            # Semi-transparent fill
            overlay = result.copy()
            cv2.fillPoly(overlay, [pts], (0, 255, 0))
            result = cv2.addWeighted(result, 0.7, overlay, 0.3, 0)
            # Label
            M = cv2.moments(np.array(polygon, np.int32).reshape((-1, 1, 2)))
            if M["m00"] != 0:
                cx = int(M["m10"] / M["m00"])
                cy = int(M["m01"] / M["m00"])
                cv2.putText(result, f"#{idx}", (cx, cy),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)

        cv2.imwrite(str(img_output_dir / "roof_boundaries.png"), result)
        if args.debug:
            cv2.imwrite(str(img_output_dir / "debug_mask.png"), mask)

        # Save per-image GeoJSON
        lots = []
        for idx, b in enumerate(buildings):
            lots.append({
                "lot_id": f"LOT_{idx:04d}",
                "source_image": img_path.name,
                "building_polygon": b["polygon"],
                "area_pixels": b["area"],
                "vertices": b["vertices"],
                "bbox": b["bbox"],
                "rotation_angle": b["rotation_angle"],
                "solidity": b["solidity"],
            })
            all_lots.append({
                "lot_id": f"LOT_{lot_counter:04d}",
                "source_image": img_path.name,
                "building_polygon": b["polygon"],
                "area_pixels": b["area"],
                "vertices": b["vertices"],
                "bbox": b["bbox"],
                "rotation_angle": b["rotation_angle"],
                "solidity": b["solidity"],
            })
            lot_counter += 1

        img_geojson = to_geojson(lots, (w, h), [img_path.name])
        with open(img_output_dir / "roofs.geojson", "w") as f:
            json.dump(img_geojson, f, indent=2)

        images_data.append((image, mask, buildings))
        print(f"  Detected {len(buildings)} buildings")

    # Create composite image
    print(f"\n[INFO] Creating composite image ({max_w}x{max_h})...")
    canvas, _ = create_composite_image(images_data, (max_h, max_w, 3))
    cv2.imwrite(str(output_dir / "composite_roof_boundaries.png"), canvas)

    # Save combined GeoJSON
    combined_geojson = to_geojson(all_lots, (max_w, max_h),
                                   [s.name for s in images])
    with open(output_dir / "combined_roofs.geojson", "w") as f:
        json.dump(combined_geojson, f, indent=2)

    # Save summary
    summary = {
        "source_dir": str(input_dir),
        "images_processed": len(images_data),
        "total_buildings": len(all_lots),
        "canvas_size": {"width": max_w, "height": max_h},
        "timestamp": datetime.now().isoformat(),
    }
    with open(output_dir / "summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\n[DONE] Processing complete.")
    print(f"  Total buildings detected: {len(all_lots)}")
    print(f"  Composite image: composite_roof_boundaries.png")
    print(f"  Combined GeoJSON: combined_roofs.geojson")
    print(f"  Per-image results: {len(images_data)} folders")
    print(f"  Summary: summary.json")


if __name__ == "__main__":
    main()
