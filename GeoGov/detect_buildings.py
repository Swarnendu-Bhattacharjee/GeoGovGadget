#!/usr/bin/env python3
"""
GeoGovGadget - Satellite Image Building Detection & Land Lot Layout Generator

Uses OpenCV to process raw satellite imagery and:
1. Detect buildings by their roof shapes/colors
2. Crop buildings according to actual roof size
3. Generate land lot layouts from the detected structures
4. Output georeferenced lot polygons (GeoJSON export)

Usage:
    python3 detect_buildings.py --input <satellite_image.jpg>
                                [--output <output_dir>]
                                [--min-area 300]
                                [--max-area 200000]
                                [--debug]

Author: Pranjal Das / Hermes Agent
"""

import cv2
import numpy as np
import argparse
import json
import os
from pathlib import Path
from datetime import datetime


class BuildingDetector:
    def __init__(self, min_area=300, max_area=200000, debug=False):
        self.min_area = min_area
        self.max_area = max_area
        self.debug = debug

    def preprocess_color(self, image):
        """
        Color-based building detection.
        Buildings have low saturation (gray/blue roofs) while vegetation is highly saturated green.
        Also buildings tend to be brighter than terrain.
        """
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        h, s, v = cv2.split(hsv)

        # Mask out green vegetation (hue 35-85 is green)
        non_green = cv2.bitwise_or(
            cv2.inRange(hsv, (0, 0, 0), (35, 255, 255)),
            cv2.inRange(hsv, (85, 0, 0), (180, 255, 255))
        )

        # Low saturation = non-vegetation (buildings, roads, bare earth)
        low_sat = cv2.inRange(s, 0, 80)

        # Reasonable brightness (not sky/dark shadows)
        mid_val = cv2.inRange(v, 40, 250)

        # Combine: non-green AND low-saturation AND mid-brightness
        building_mask = cv2.bitwise_and(
            cv2.bitwise_and(non_green, low_sat),
            mid_val
        )

        # Morphological operations to clean up
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        building_mask = cv2.morphologyEx(building_mask, cv2.MORPH_CLOSE, kernel)
        kernel_small = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        building_mask = cv2.morphologyEx(building_mask, cv2.MORPH_OPEN, kernel_small)

        return building_mask

    def preprocess_grayscale(self, image):
        """
        Grayscale-based building detection using CLAHE + Otsu/Adaptive thresholding.
        Handles both bright buildings on dark background and dark buildings on bright background.
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        # CLAHE for contrast enhancement
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)
        blurred = cv2.GaussianBlur(enhanced, (5, 5), 0)

        # Try Otsu threshold (buildings brighter than background)
        ret, otsu_thresh = cv2.threshold(
            blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        white_ratio = np.sum(otsu_thresh == 255) / otsu_thresh.size

        # Also try inverted (buildings darker than background)
        otsu_inv = cv2.bitwise_not(otsu_thresh)

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        kernel_small = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))

        # Check which gives better results (avoid over-segmentation)
        if white_ratio > 0.5:
            # Otsu over-segments; use adaptive threshold with inversion
            thresh = cv2.adaptiveThreshold(
                blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY_INV, 15, 5
            )
        else:
            thresh = otsu_thresh

        # Morphological operations
        combined = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
        combined = cv2.morphologyEx(combined, cv2.MORPH_OPEN, kernel_small)

        return combined

    def preprocess(self, image):
        """
        Detect potential building regions using grayscale thresholding as primary
        and color-based detection as fallback for low-contrast images.
        Returns a binary mask where white pixels indicate potential buildings.
        """
        height, width = image.shape[:2]
        img_area = height * width

        # --- Grayscale approach (primary) ---
        # CLAHE + Otsu works well when buildings contrast with background
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)
        blurred = cv2.GaussianBlur(enhanced, (5, 5), 0)

        ret, otsu_thresh = cv2.threshold(
            blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        white_ratio = np.sum(otsu_thresh == 255) / otsu_thresh.size

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        kernel_small = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))

        if white_ratio > 0.5:
            # Otsu over-segments; try inverted (buildings darker than bright background)
            otsu_inv = cv2.bitwise_not(otsu_thresh)
            inv_ratio = np.sum(otsu_inv == 255) / otsu_inv.size
            if inv_ratio < 0.5:
                thresh = otsu_inv
            else:
                # Both over-segment; use adaptive threshold
                thresh = cv2.adaptiveThreshold(
                    blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                    cv2.THRESH_BINARY_INV, 15, 5
                )
        else:
            thresh = otsu_thresh

        gray_mask = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
        gray_mask = cv2.morphologyEx(gray_mask, cv2.MORPH_OPEN, kernel_small)

        # Check if grayscale detection is useful (has valid-size contours)
        gray_contours, _ = cv2.findContours(gray_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        gray_valid = sum(1 for c in gray_contours
                        if self.min_area <= cv2.contourArea(c) <= min(self.max_area, img_area * 0.3))

        if gray_valid >= 3:
            # Grayscale produced enough results; use it directly
            return gray_mask

        # --- Color approach (fallback for low-contrast images) ---
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        non_green = cv2.bitwise_or(
            cv2.inRange(hsv, (0, 0, 0), (35, 255, 255)),
            cv2.inRange(hsv, (85, 0, 0), (180, 255, 255))
        )
        low_sat = cv2.inRange(hsv[:,:,1], 0, 30)
        mid_val = cv2.inRange(hsv[:,:,2], 40, 250)
        color_mask = cv2.bitwise_and(cv2.bitwise_and(non_green, low_sat), mid_val)
        color_mask = cv2.morphologyEx(color_mask, cv2.MORPH_CLOSE, kernel)
        color_mask = cv2.morphologyEx(color_mask, cv2.MORPH_OPEN, kernel_small)

        # Filter color mask to remove huge regions
        color_contours, _ = cv2.findContours(color_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        color_filtered = np.zeros_like(color_mask)
        for c in color_contours:
            area = cv2.contourArea(c)
            if area < img_area * 0.3 and area > self.min_area:
                cv2.drawContours(color_filtered, [c], -1, 255, -1)

        # Combine grayscale + filtered color
        combined_mask = cv2.bitwise_or(gray_mask, color_filtered)

        return combined_mask

    def find_building_contours(self, edge_mask):
        """Find contours that match building roof shapes."""
        contours, _ = cv2.findContours(
            edge_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        building_contours = []
        img_area = edge_mask.shape[0] * edge_mask.shape[1]
        max_contour_area = img_area * 0.3  # No single building should cover >30% of image

        for cnt in contours:
            area = cv2.contourArea(cnt)
            # Filter by area and exclude giant background contours
            if area < self.min_area or area > min(self.max_area, max_contour_area):
                continue
            # Approximate contour to check shape
            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
            # Keep contours that have 4+ vertices (building-like shapes)
            if len(approx) >= 4:
                # Check solidity (ratio of contour area to convex hull area)
                hull = cv2.convexHull(cnt)
                hull_area = cv2.contourArea(hull)
                if hull_area > 0:
                    solidity = area / hull_area
                    if solidity > 0.3:
                        building_contours.append((cnt, approx, area))

        # Sort by area descending (biggest buildings first)
        building_contours.sort(key=lambda x: x[2], reverse=True)
        return building_contours

    def crop_building(self, image, contour):
        """Crop the image to the bounding box of a building contour."""
        x, y, w, h = cv2.boundingRect(contour)
        # Add small padding (5% of width/height)
        pad_w = int(w * 0.05)
        pad_h = int(h * 0.05)
        x = max(0, x - pad_w)
        y = max(0, y - pad_h)
        w = min(image.shape[1] - x, w + 2 * pad_w)
        h = min(image.shape[0] - y, h + 2 * pad_h)
        return image[y:y+h, x:x+w], (x, y, w, h)

    def generate_lot_layout(self, contour, index, x_offset, y_offset):
        """Generate a lot layout polygon from a building contour."""
        # Get the rotated bounding box
        rect = cv2.minAreaRect(contour)

        # Get the convex hull for lot boundary
        hull = cv2.convexHull(contour)
        hull_points = hull.reshape(-1, 2).tolist()

        # Offset hull points to absolute coordinates
        lot_boundary = [[int(p[0] + x_offset), int(p[1] + y_offset)] for p in hull_points]

        # Building footprint (approximated polygon)
        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
        # approx shape is (N, 1, 2) — reshape and offset
        approx_points = approx.reshape(-1, 2).tolist()
        building_footprint = [[int(p[0] + x_offset), int(p[1] + y_offset)] for p in approx_points]

        return {
            "lot_id": f"LOT_{index:04d}",
            "building_footprint": building_footprint,
            "lot_boundary": lot_boundary,
            "bounding_box": [int(x_offset), int(y_offset), int(rect[1][0]), int(rect[1][1])],
            "rotation_angle": round(float(rect[2]), 2),
        }

    def process_image(self, image_path, output_dir):
        """Main processing pipeline."""
        image_path = Path(image_path)
        output_dir = Path(output_dir)
        crops_dir = output_dir / "crops"
        layouts_dir = output_dir / "layouts"
        crops_dir.mkdir(parents=True, exist_ok=True)
        layouts_dir.mkdir(parents=True, exist_ok=True)

        # Load image
        image = cv2.imread(str(image_path))
        if image is None:
            raise FileNotFoundError(f"Could not load image: {image_path}")

        original = image.copy()
        height, width = image.shape[:2]

        print(f"[INFO] Processing {image_path.name} ({width}x{height})...")

        # Preprocess (color-based with grayscale fallback)
        edge_mask = self.preprocess(image)

        if self.debug:
            cv2.imwrite(str(layouts_dir / "debug_edge_mask.png"), edge_mask)

        # Find buildings
        buildings = self.find_building_contours(edge_mask)
        print(f"[INFO] Detected {len(buildings)} potential buildings.")

        # Draw results
        result_image = original.copy()
        lot_layouts = []
        crop_metadata = []

        for idx, (cnt, approx, area) in enumerate(buildings):
            color = (0, 255, 0)  # Green outline
            cv2.drawContours(result_image, [cnt], -1, color, 2)

            # Crop building
            crop_img, bbox = self.crop_building(original, cnt)
            x, y, w, h = bbox
            crop_filename = f"building_{idx:04d}_{w}x{h}.png"
            crop_path = crops_dir / crop_filename
            cv2.imwrite(str(crop_path), crop_img)

            # Generate lot layout
            layout = self.generate_lot_layout(cnt, idx, x, y)
            lot_layouts.append(layout)

            crop_metadata.append({
                "lot_id": layout["lot_id"],
                "source_image": image_path.name,
                "crop_file": crop_filename,
                "bbox": {"x": x, "y": y, "width": w, "height": h},
                "area_pixels": int(area),
                "rotation_angle": layout["rotation_angle"],
            })

            # Label
            M = cv2.moments(cnt)
            if M["m00"] != 0:
                cx = int(M["m10"] / M["m00"])
                cy = int(M["m01"] / M["m00"])
                cv2.putText(result_image, f"#{idx}", (cx, cy), cv2.FONT_HERSHEY_SIMPLEX,
                            0.5, (0, 0, 255), 1)

        # Save result image
        cv2.imwrite(str(layouts_dir / "annotated_result.png"), result_image)

        # Save GeoJSON layout
        geojson = self._to_geojson(lot_layouts, image_path.name, width, height)
        geojson_path = output_dir / "lot_layouts.geojson"
        with open(geojson_path, "w") as f:
            json.dump(geojson, f, indent=2)

        # Save metadata
        metadata = {
            "source_image": image_path.name,
            "image_dimensions": {"width": width, "height": height},
            "detection_params": {
                "min_area": self.min_area,
                "max_area": self.max_area,
            },
            "buildings_detected": len(buildings),
            "timestamp": datetime.now().isoformat(),
            "lots": lot_layouts,
        }
        metadata_path = output_dir / "metadata.json"
        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)

        # Save crop manifest
        manifest_path = crops_dir / "manifest.json"
        with open(manifest_path, "w") as f:
            json.dump(crop_metadata, f, indent=2)

        print(f"[INFO] Results saved to: {output_dir}")
        print(f"  - Annotated image: layouts/annotated_result.png")
        print(f"  - Lot layouts: lot_layouts.geojson")
        print(f"  - Building crops: crops/ ({len(buildings)} files)")
        print(f"  - Metadata: metadata.json")

        return output_dir

    def _to_geojson(self, lots, source_name, width, height):
        """Convert lot layouts to GeoJSON format."""
        features = []
        for lot in lots:
            feature = {
                "type": "Feature",
                "properties": {
                    "lot_id": lot["lot_id"],
                    "source_image": source_name,
                    "rotation_angle": lot["rotation_angle"],
                    "bbox": lot["bounding_box"],
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[list(pt) for pt in lot["lot_boundary"]]]
                }
            }
            features.append(feature)

        return {
            "type": "FeatureCollection",
            "features": features,
        }


def main():
    parser = argparse.ArgumentParser(
        description="GeoGovGadget: Building detection and land lot layout generator from satellite imagery"
    )
    parser.add_argument("--input", "-i", required=True, help="Path to satellite image (jpg/png)")
    parser.add_argument("--output", "-o", default="./output", help="Output directory")
    parser.add_argument("--min-area", type=int, default=300, help="Minimum building area in pixels")
    parser.add_argument("--max-area", type=int, default=200000, help="Maximum building area in pixels")
    parser.add_argument("--debug", action="store_true", help="Save debug intermediate images")
    args = parser.parse_args()

    detector = BuildingDetector(
        min_area=args.min_area,
        max_area=args.max_area,
        debug=args.debug
    )

    output = detector.process_image(args.input, args.output)
    print(f"\n[DONE] Processing complete. Output: {output}")


if __name__ == "__main__":
    main()
