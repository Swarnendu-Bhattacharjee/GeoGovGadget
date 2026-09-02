#!/usr/bin/env python3
"""
GeoGov 2.0 - Improved Building & Land Lot Polygon Detector
Built on lessons from mistakes documented in MISTAKES.md

Key improvements:
1. Separate RAW vs PLOTTED image detection pipelines
2. CLAHE + Otsu + adaptive fallback for low-contrast RAW images
3. HSV color masking for high-contrast PLOTTED images
4. Proper contour filtering (area, solidity, max_contour_ratio)
5. Bug-free polygon coordinate extraction
6. Polygon output with rotation angle and bounding boxes

Usage:
    python3 geo_gov_detector.py --input <image> --type raw|plotted [--output dir] [--debug]

Author: Pranjal Das / Hermes Agent
"""

import cv2
import numpy as np
import argparse
import json
import os
from pathlib import Path
from datetime import datetime


class RawBuildingDetector:
    """Detector for RAW satellite imagery (low contrast, vegetation-covered)."""

    def __init__(self, min_area=300, max_area=200000, debug=False):
        self.min_area = min_area
        self.max_area = max_area
        self.debug = debug

    def preprocess(self, image):
        """
        Edge-based region proposals, not a brightness-threshold blob mask.

        The previous version (v2) ran Otsu/adaptive thresholding on
        grayscale: it decides "foreground" purely from whether a pixel is
        lighter or darker than its neighbors, then has to *guess* which
        polarity (light-on-dark or dark-on-light) is "the building" — wrong
        on any frame with more than one brightness pattern (roads, dirt lots,
        water, buildings all in one image). That's why it merged buildings +
        parking lots + shorelines into single giant blobs, or inverted
        everything on complex scenes.

        This version finds building CANDIDATES from edges instead — where
        does the picture actually have a distinct closed boundary — which
        works regardless of whether the object is locally bright or dark.
        Rejecting non-buildings (vegetation, water, roads) then happens
        per-candidate in find_buildings() by sampling that candidate's own
        mean color, not by a single global pixel mask (a global HSV mask
        fragments real buildings wherever a shadow or antenna pixel drifts
        into the vegetation/water hue range).
        """
        self._source = image  # find_buildings() samples color from this per-candidate

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        # Bilateral filter instead of Gaussian blur: smooths flat regions
        # (roof surfaces, roads, grass) while keeping their edges sharp —
        # Gaussian blur softens edges everywhere, which is exactly what a
        # boundary-driven pipeline can't afford.
        smoothed = cv2.bilateralFilter(gray, d=9, sigmaColor=60, sigmaSpace=60)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(smoothed)

        median_val = float(np.median(enhanced))
        lower = int(max(0, 0.66 * median_val))
        upper = int(min(255, 1.33 * median_val))
        edges = cv2.Canny(enhanced, lower, upper)

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        # Close small gaps in an otherwise-complete building outline (a
        # roof edge Canny only half-detected), then dilate once so nearly-
        # closed loops become fully closed before contour-finding.
        closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
        closed = cv2.dilate(closed, kernel, iterations=1)

        return closed

    def find_buildings(self, mask):
        """Filter edge-derived candidates by shape AND sampled color."""
        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

        height, width = mask.shape
        img_area = height * width
        max_contour_area = img_area * 0.3  # No building > 30% of image
        source = getattr(self, "_source", None)

        buildings = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < self.min_area or area > min(self.max_area, max_contour_area):
                continue

            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)

            # Too few corners (a stray line segment) or too many (a jagged
            # blob the simplification couldn't tame, typical of foliage
            # edges and shoreline noise) — neither reads as a rooftop.
            if len(approx) < 4 or len(approx) > 12:
                continue

            hull = cv2.convexHull(cnt)
            hull_area = cv2.contourArea(hull)
            solidity = area / hull_area if hull_area > 0 else 0
            # Real rooftops are close to convex (rectangles, L-shapes at
            # worst); jagged/star-shaped blobs (tree canopy, shoreline) are not.
            if solidity < 0.55:
                continue

            bbox = cv2.boundingRect(cnt)
            bx, by, bw, bh = bbox
            extent = area / float(bw * bh) if bw * bh > 0 else 0
            if extent < 0.35:
                continue

            rect = cv2.minAreaRect(cnt)
            (rw, rh) = rect[1]
            long_side, short_side = max(rw, rh), min(rw, rh)
            if short_side > 0 and (long_side / short_side) > 4.5:
                continue

            # Rectangularity: how much of the *oriented* bounding rectangle
            # the shape fills. A blob can be reasonably convex (passing
            # solidity) while still being a poor rectangle fit (an ellipse,
            # a rounded pond, a diamond) — real buildings fit their own
            # minAreaRect tightly; most non-buildings don't.
            rect_area = rw * rh
            rectangularity = area / rect_area if rect_area > 0 else 0
            if rectangularity < 0.55:
                continue

            touches_border = bx <= 1 or by <= 1 or (bx + bw) >= width - 1 or (by + bh) >= height - 1
            if touches_border and area > self.min_area * 8:
                continue

            # Per-candidate color check: sample this shape's own mean HSV
            # (not a global pixel mask) and reject it if it reads as
            # vegetation or water/shadow. Sampling per-region instead of
            # per-pixel means a building with a few shadowed or foliage-
            # adjacent edge pixels doesn't get fragmented or dropped, and a
            # tree/lake blob that happens to pass every shape filter still
            # gets caught here.
            if source is not None and not self._looks_like_a_roof(source, cnt, bbox):
                continue

            approx_points = approx.reshape(-1, 2).tolist()

            buildings.append({
                "contour": cnt,
                "polygon": [[int(p[0]), int(p[1])] for p in approx_points],
                "area": int(area),
                "vertices": len(approx),
                "bbox": {"x": int(bbox[0]), "y": int(bbox[1]), "w": int(bbox[2]), "h": int(bbox[3])},
                "solidity": round(solidity, 3),
                "rotation_angle": round(float(rect[2]), 2),
            })

        buildings.sort(key=lambda x: x["area"], reverse=True)
        return self._suppress_nested_duplicates(buildings)

    @staticmethod
    def _looks_like_a_roof(source, cnt, bbox):
        """
        Sample a candidate region's own pixels and reject it if they don't
        look like photographed roof material: vegetation/water by color, or
        a flat UI element (search bar, icon, button) by having almost no
        texture at all. A screenshot of a live map page has both problems —
        real buildings and flat interface chrome both produce clean,
        roughly-rectangular edges, so shape alone can't tell them apart.
        Photographed surfaces (roofs, roads, dirt, foliage) always carry
        some sensor/compression noise; a solid-fill UI icon or button does not.
        """
        bx, by, bw, bh = bbox
        crop = source[by:by + bh, bx:bx + bw]
        if crop.size == 0:
            return False

        local_mask = np.zeros((bh, bw), dtype=np.uint8)
        cv2.drawContours(local_mask, [cnt - [bx, by]], -1, 255, thickness=cv2.FILLED)
        if cv2.countNonZero(local_mask) == 0:
            return False

        hsv_crop = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        mean_h, mean_s, mean_v, _ = cv2.mean(hsv_crop, mask=local_mask)

        is_vegetation = 32 <= mean_h <= 95 and mean_s >= 35
        is_water_or_deep_shadow = mean_v < 55 and mean_s < 55
        if is_vegetation or is_water_or_deep_shadow:
            return False

        gray_crop = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        _, stddev = cv2.meanStdDev(gray_crop, mask=local_mask)
        if float(stddev[0][0]) < 6:
            return False

        return True

    @staticmethod
    def _suppress_nested_duplicates(buildings, iou_threshold=0.6):
        """
        RETR_LIST (unlike RETR_EXTERNAL) returns both a closed edge loop AND
        near-duplicate contours just inside/outside it from the dilation
        pass, so the same rooftop can otherwise show up as 2-3 near-identical
        polygons. Drop smaller shapes whose bounding box heavily overlaps a
        larger, already-kept one.
        """
        kept = []
        for b in buildings:  # already sorted largest-area first
            bx, by, bw, bh = b["bbox"]["x"], b["bbox"]["y"], b["bbox"]["w"], b["bbox"]["h"]
            is_duplicate = False
            for k in kept:
                kx, ky, kw, kh = k["bbox"]["x"], k["bbox"]["y"], k["bbox"]["w"], k["bbox"]["h"]
                ix1, iy1 = max(bx, kx), max(by, ky)
                ix2, iy2 = min(bx + bw, kx + kw), min(by + bh, ky + kh)
                iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
                inter = iw * ih
                if inter == 0:
                    continue
                smaller_area = min(bw * bh, kw * kh)
                if smaller_area > 0 and inter / smaller_area > iou_threshold:
                    is_duplicate = True
                    break
            if not is_duplicate:
                kept.append(b)
        return kept


class PlotDetector:
    """Detector for PLOTTED satellite imagery (high contrast, green background)."""

    def __init__(self, min_area=300, max_area=200000, debug=False):
        self.min_area = min_area
        self.max_area = max_area
        self.debug = debug

    def preprocess(self, image):
        """
        HSV color-based masking for plotted images.
        Strategy: buildings = non-green AND not-white regions.
        """
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        h, s, v = cv2.split(hsv)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        # Green vegetation mask (hue 30-90 covers green range)
        green_mask = cv2.inRange(hsv, (30, 10, 40), (90, 255, 255))
        non_green = cv2.bitwise_not(green_mask)

        # White background mask (value 235-255)
        too_white = cv2.inRange(gray, 235, 255)
        not_white = cv2.bitwise_not(too_white)

        # Buildings = non-green AND not-white
        building_mask = cv2.bitwise_and(non_green, not_white)

        # Morphological cleanup
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        building_mask = cv2.morphologyEx(building_mask, cv2.MORPH_CLOSE, kernel)
        kernel_small = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        building_mask = cv2.morphologyEx(building_mask, cv2.MORPH_OPEN, kernel_small)

        return building_mask

    def find_buildings(self, mask):
        """Find building polygons with proper filtering."""
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        height, width = mask.shape
        img_area = height * width
        max_contour_area = img_area * 0.15  # 15% for plotted images

        buildings = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < self.min_area or area > min(self.max_area, max_contour_area):
                continue

            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)

            if len(approx) < 3:
                continue

            hull = cv2.convexHull(cnt)
            hull_area = cv2.contourArea(hull)
            solidity = area / hull_area if hull_area > 0 else 0
            if solidity < 0.3:
                continue

            rect = cv2.minAreaRect(cnt)
            bbox = cv2.boundingRect(cnt)

            # Use convex hull points for cleaner polygon
            hull_points = hull.reshape(-1, 2).tolist()

            buildings.append({
                "contour": cnt,
                "polygon": [[int(p[0]), int(p[1])] for p in hull_points],
                "area": int(area),
                "vertices": len(approx),
                "bbox": {"x": int(bbox[0]), "y": int(bbox[1]), "w": int(bbox[2]), "h": int(bbox[3])},
                "solidity": round(solidity, 3),
                "rotation_angle": round(float(rect[2]), 2),
            })

        buildings.sort(key=lambda x: x["area"], reverse=True)
        return buildings


class GeoGovDetector:
    """Unified detector that auto-selects RAW or PLOTTED pipeline."""

    def __init__(self, min_area=300, max_area=200000, debug=False, image_type="auto"):
        self.min_area = min_area
        self.max_area = max_area
        self.debug = debug
        self.image_type = image_type
        self.detector = None

    def process_image(self, image_path, output_dir):
        """Main processing pipeline."""
        image_path = Path(image_path)
        output_dir = Path(output_dir)
        crops_dir = output_dir / "crops"
        layouts_dir = output_dir / "layouts"
        crops_dir.mkdir(parents=True, exist_ok=True)
        layouts_dir.mkdir(parents=True, exist_ok=True)

        image = cv2.imread(str(image_path))
        if image is None:
            raise FileNotFoundError(f"Could not load image: {image_path}")

        original = image.copy()
        height, width = image.shape[:2]

        # Auto-detect image type if not specified
        if self.image_type == "auto":
            img_type = self._detect_image_type(image)
        else:
            img_type = self.image_type

        print(f"[INFO] Processing {image_path.name} ({width}x{height}) as {img_type.upper()}...")

        # Select detector
        if img_type == "plotted":
            self.detector = PlotDetector(self.min_area, self.max_area, self.debug)
        else:
            self.detector = RawBuildingDetector(self.min_area, self.max_area, self.debug)

        # Segment and detect
        mask = self.detector.preprocess(image)
        if self.debug:
            cv2.imwrite(str(layouts_dir / "debug_segmentation_mask.png"), mask)

        buildings = self.detector.find_buildings(mask)

        # If no buildings found on a RAW image, try inverted image
        # (some satellite images have inverted contrast where Otsu fails)
        if len(buildings) == 0 and img_type == "raw":
            print("[INFO] No buildings found - retrying with inverted image...")
            inverted = cv2.bitwise_not(image)
            mask_inv = self.detector.preprocess(inverted)
            buildings = self.detector.find_buildings(mask_inv)
            if self.debug:
                cv2.imwrite(str(layouts_dir / "debug_segmentation_mask_inverted.png"), mask_inv)

        print(f"[INFO] Detected {len(buildings)} buildings/polygons.")

        # Draw results
        result_image = original.copy()
        lot_layouts = []
        crop_metadata = []

        for idx, b in enumerate(buildings):
            cnt = b["contour"]
            polygon = b["polygon"]

            # Draw polygon outline with semi-transparent fill
            overlay = result_image.copy()
            pts = np.array(polygon, np.int32).reshape((-1, 1, 2))
            cv2.polylines(overlay, [pts], True, (0, 255, 0), 2)
            cv2.fillPoly(overlay, [pts], (0, 255, 0))
            # Blend overlay with original (30% opacity for fill)
            result_image = cv2.addWeighted(result_image, 0.7, overlay, 0.3, 0)

            # Crop building
            x, y, w, h = b["bbox"]["x"], b["bbox"]["y"], b["bbox"]["w"], b["bbox"]["h"]
            pad_w = int(w * 0.05)
            pad_h = int(h * 0.05)
            x0 = max(0, x - pad_w)
            y0 = max(0, y - pad_h)
            w0 = min(image.shape[1] - x0, w + 2 * pad_w)
            h0 = min(image.shape[0] - y0, h + 2 * pad_h)
            crop_img = original[y0:y0+h0, x0:x0+w0]

            crop_filename = f"building_{idx:04d}_{w}x{h}.png"
            cv2.imwrite(str(crops_dir / crop_filename), crop_img)

            # Generate lot layout
            layout = {
                "lot_id": f"LOT_{idx:04d}",
                "building_polygon": polygon,
                "bounding_box": b["bbox"],
                "area_pixels": b["area"],
                "vertices": b["vertices"],
                "solidity": b["solidity"],
                "rotation_angle": b["rotation_angle"],
                "image_type": img_type,
            }
            lot_layouts.append(layout)

            crop_metadata.append({
                "lot_id": layout["lot_id"],
                "source_image": image_path.name,
                "crop_file": crop_filename,
                "bbox": b["bbox"],
                "area_pixels": b["area"],
                "vertices": b["vertices"],
                "solidity": b["solidity"],
                "rotation_angle": b["rotation_angle"],
            })

            # Label
            M = cv2.moments(cnt)
            if M["m00"] != 0:
                cx = int(M["m10"] / M["m00"])
                cy = int(M["m01"] / M["m00"])
                cv2.putText(result_image, f"#{idx}", (cx, cy), cv2.FONT_HERSHEY_SIMPLEX,
                            0.5, (0, 0, 255), 1)

        # Save outputs
        cv2.imwrite(str(layouts_dir / "annotated_result.png"), result_image)

        geojson = self._to_geojson(lot_layouts, image_path.name, width, height)
        with open(output_dir / "lot_layouts.geojson", "w") as f:
            json.dump(geojson, f, indent=2)

        metadata = {
            "source_image": image_path.name,
            "image_dimensions": {"width": width, "height": height},
            "detection_type": img_type,
            "detection_params": {
                "min_area": self.min_area,
                "max_area": self.max_area,
            },
            "buildings_detected": len(buildings),
            "timestamp": datetime.now().isoformat(),
            "lots": lot_layouts,
        }
        with open(output_dir / "metadata.json", "w") as f:
            json.dump(metadata, f, indent=2)

        with open(crops_dir / "manifest.json", "w") as f:
            json.dump(crop_metadata, f, indent=2)

        print(f"[INFO] Results saved to: {output_dir}")
        print(f"  - {img_type} detection")
        print(f"  - Annotated image: layouts/annotated_result.png")
        print(f"  - Lot layouts: lot_layouts.geojson")
        print(f"  - Building crops: crops/ ({len(buildings)} files)")
        print(f"  - Metadata: metadata.json")

        return output_dir

    def _detect_image_type(self, image):
        """Auto-detect if image is RAW satellite or PLOTTED.
        
        PLOTTED maps are typically bright (high mean V) and flat (low std V) 
        because they are illustrations/diagrams. RAW satellite imagery has 
        more contrast variation and lower mean brightness.
        """
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        h, s, v = cv2.split(hsv)

        mean_v = float(np.mean(v))
        std_v = float(np.std(v))

        green_mask = cv2.inRange(hsv, (30, 10, 40), (90, 255, 255))
        green_ratio = float(np.sum(green_mask == 255)) / green_mask.size

        # PLOTTED heuristic: bright & flat (illustration maps have uniform bright bg)
        if mean_v > 220 and std_v < 25:
            return "plotted"
        # Also plotted if high green coverage AND relatively flat (green schematic maps)
        if green_ratio > 0.30 and std_v < 30:
            return "plotted"
        else:
            return "raw"

    def _to_geojson(self, lots, source_name, width, height):
        """Convert lot layouts to GeoJSON Polygon format."""
        features = []
        for lot in lots:
            feature = {
                "type": "Feature",
                "properties": {
                    "lot_id": lot["lot_id"],
                    "source_image": source_name,
                    "area_pixels": lot["area_pixels"],
                    "vertices": lot["vertices"],
                    "rotation_angle": lot["rotation_angle"],
                    "bbox": lot["bounding_box"],
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
        description="GeoGov 2.0: Improved building detection and land lot layout generator"
    )
    parser.add_argument("--input", "-i", required=True, help="Path to satellite image")
    parser.add_argument("--output", "-o", default="./output", help="Output directory")
    parser.add_argument("--type", "-t", choices=["raw", "plotted", "auto"], default="auto",
                        help="Image type: raw (satellite), plotted, or auto-detect")
    parser.add_argument("--min-area", type=int, default=300, help="Minimum building area")
    parser.add_argument("--max-area", type=int, default=200000, help="Maximum building area")
    parser.add_argument("--debug", action="store_true", help="Save debug images")
    args = parser.parse_args()

    detector = GeoGovDetector(
        min_area=args.min_area,
        max_area=args.max_area,
        debug=args.debug,
        image_type=args.type
    )

    output = detector.process_image(args.input, args.output)
    print(f"\n[DONE] Processing complete. Output: {output}")


if __name__ == "__main__":
    main()
