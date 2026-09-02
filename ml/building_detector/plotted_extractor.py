"""Building footprint extraction from the PLOTTED (schematic map) images.

The RAW satellite photos have real tree canopy sitting on top of building
roofs, which hides/breaks up footprints for the SAM-based detector in
detect.py (see FilterConfig's solidity/aspect-ratio filters fighting to
reject vegetation blobs). The PLOTTED images don't have this problem at
all — they're flat schematic renders (Google Maps' standard building-fill
style) where every building is drawn as a single solid fill color with a
clean edge, with zero vegetation occlusion. So instead of trying to
segment buildings out from under trees, this module reads the shapes
Google Maps already drew.

Sampled across all 10 PLOTTED images, the building fill color is
consistently ~BGR(202, 208, 215) (a light tan-grey), distinct from the
background land fill (~234, 239, 240), parks (~208, 248, 213 / greener
variants), and roads (white or ~221, 210, 182 for arterial roads). That
consistency is what makes a fixed color threshold reliable here — see
`sample_fill_colors.py` if a new map style needs re-calibrating.

Output polygons are snapped to a rotated rectangle when the shape is
close enough to one (most single buildings are), and left as a simplified
polygon otherwise (L-shaped/complex blocks) — i.e. "polygons or
rectangles", per how these buildings actually get drawn on the source map.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class PlottedFilterConfig:
    # BGR color range matching Google Maps' building-fill style, sampled
    # across all 10 PLOTTED images (see module docstring).
    fill_lower: tuple[int, int, int] = (190, 196, 203)
    fill_upper: tuple[int, int, int] = (214, 220, 227)
    min_area_px: int = 150
    close_kernel: int = 5
    close_iterations: int = 3
    open_iterations: int = 1
    rect_solidity_thresh: float = 0.88  # contour area / min-area-rect area
    poly_epsilon_frac: float = 0.015    # approxPolyDP epsilon, as a fraction of perimeter


def _building_mask(image_bgr: np.ndarray, cfg: PlottedFilterConfig) -> np.ndarray:
    mask = cv2.inRange(image_bgr, np.array(cfg.fill_lower), np.array(cfg.fill_upper))
    kernel = np.ones((cfg.close_kernel, cfg.close_kernel), np.uint8)
    # Closing first bridges gaps where a text label (e.g. "BEL Lab") is
    # drawn over a building in a different color, splitting the fill.
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=cfg.close_iterations)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=cfg.open_iterations)
    return mask


def extract_plotted_footprints(
    image_bgr: np.ndarray, cfg: PlottedFilterConfig | None = None
) -> list[dict]:
    """Returns a list of {"points": Nx2 int array, "is_rectangle": bool}."""
    cfg = cfg or PlottedFilterConfig()
    mask = _building_mask(image_bgr, cfg)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    shapes = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < cfg.min_area_px:
            continue

        rect = cv2.minAreaRect(contour)
        (rw, rh) = rect[1]
        rect_area = rw * rh
        is_rectangle = rect_area > 0 and (area / rect_area) >= cfg.rect_solidity_thresh

        if is_rectangle:
            points = cv2.boxPoints(rect).astype(np.int32)
        else:
            epsilon = cfg.poly_epsilon_frac * cv2.arcLength(contour, True)
            points = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)

        shapes.append({"points": points, "is_rectangle": is_rectangle, "area_px": area})

    return shapes


def render_plotted_overlay(image_bgr: np.ndarray, shapes: list[dict]) -> np.ndarray:
    overlay = image_bgr.copy()
    for shape in shapes:
        color = (255, 160, 0) if shape["is_rectangle"] else (255, 0, 200)  # cyan-blue rects, magenta polygons
        cv2.polylines(overlay, [shape["points"].astype(np.int32)], isClosed=True, color=color, thickness=2)
    return overlay


def shapes_to_geojson(shapes: list[dict], image_name: str) -> dict:
    features = []
    for i, shape in enumerate(shapes):
        ring = shape["points"].tolist()
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": f"{image_name}_{i}",
                    "class": "building_footprint",
                    "shape": "rectangle" if shape["is_rectangle"] else "polygon",
                    "source": "plotted_schematic",
                },
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        )
    return {
        "type": "FeatureCollection",
        "crs_note": "pixel coordinates (col, row) in the PLOTTED image — not geo-referenced",
        "source_image": image_name,
        "features": features,
    }
