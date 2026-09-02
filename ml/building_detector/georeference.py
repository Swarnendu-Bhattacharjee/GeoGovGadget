#!/usr/bin/env python3
"""
Turns pixel-space parcel polygons into real WGS84 GeoJSON.

Why this is possible at all
---------------------------
None of the site captures carry a geotransform, so for most of this project
the polygons could only ever be drawn back onto the image they came from.
But the reference captures in `data/cordinates with images/` (Screenshots
143-148) are all the SAME Google Maps camera, and each one has a different
point clicked with its latitude/longitude printed in the info card. Diffing
those screenshots against their own per-pixel median isolates each clicked
marker, giving five pixel->lat/lng control points in one frame.

Least-squares fitting an affine over those five points reproduces all of them
to a mean residual of ~0.2 m (max ~0.5 m), at 1.093 m/px horizontally and
1.092 m/px vertically with -0.01 degrees of rotation — i.e. it recovers a
clean, north-up, square-pixel map projection, which is exactly what a correct
solution should look like. That is the anchor.

Every site capture is then SIFT+RANSAC registered into that reference frame,
and the two transforms compose: site pixel -> reference pixel -> lat/lng.

Outputs public/parcels.geojson — real WGS84 polygons, per site, carrying both
the model's prediction and the surveyed ground truth, ready for any GIS.

Usage:
    python -m ml.building_detector.georeference
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np

# The reference camera shared by Screenshots 143-148.
REFERENCE_SCREENSHOT = "data/cordinates with images/Screenshot (143).png"
# Map viewport within that screenshot (excludes browser chrome and left rail),
# so SIFT can't match on interface furniture.
VIEWPORT = {"x0": 90, "y0": 140, "x1": 1920, "y1": 1080}

# Marker centre (in full-screenshot pixels) -> the lat/lng Google printed for it.
CONTROL_POINTS = [
    ((1304, 855), (12.820890, 80.047881)),  # Basic Science Block
    ((1154, 465), (12.824715, 80.046372)),  # near Dr TP Ganesan Auditorium
    ((908, 575), (12.823636, 80.043894)),   # SRM College of Management
    ((1482, 365), (12.825696, 80.049679)),  # Dental Grounds
    ((1334, 642), (12.822974, 80.048182)),  # SRM Global Hospitals
]

M_PER_DEG_LAT = 111320.0
MIN_INLIERS = 30


def fit_reference_transform():
    """Least-squares affine: reference-frame pixel -> (lng, lat)."""
    P = np.array([[px, py, 1.0] for (px, py), _ in CONTROL_POINTS])
    lng = np.array([c[1] for _, c in CONTROL_POINTS])
    lat = np.array([c[0] for _, c in CONTROL_POINTS])
    a, *_ = np.linalg.lstsq(P, lng, rcond=None)
    b, *_ = np.linalg.lstsq(P, lat, rcond=None)

    lat0 = float(np.mean(lat))
    m_per_deg_lng = M_PER_DEG_LAT * math.cos(math.radians(lat0))

    residuals = []
    for (px, py), (t_lat, t_lng) in CONTROL_POINTS:
        dx = (a[0] * px + a[1] * py + a[2] - t_lng) * m_per_deg_lng
        dy = (b[0] * px + b[1] * py + b[2] - t_lat) * M_PER_DEG_LAT
        residuals.append(math.hypot(dx, dy))

    diagnostics = {
        "control_points": len(CONTROL_POINTS),
        "mean_residual_m": round(float(np.mean(residuals)), 3),
        "max_residual_m": round(float(np.max(residuals)), 3),
        "scale_x_m_per_px": round(float(math.hypot(a[0] * m_per_deg_lng, b[0] * M_PER_DEG_LAT)), 4),
        "scale_y_m_per_px": round(float(math.hypot(a[1] * m_per_deg_lng, b[1] * M_PER_DEG_LAT)), 4),
        "rotation_deg": round(math.degrees(math.atan2(b[0] * M_PER_DEG_LAT, a[0] * m_per_deg_lng)), 3),
    }
    return a, b, diagnostics


def register_to_reference(site_bgr, ref_gray, sift, matcher):
    """Homography: site-capture pixel -> reference-frame pixel (full-image coords)."""
    k, d = sift.detectAndCompute(cv2.cvtColor(site_bgr, cv2.COLOR_BGR2GRAY), None)
    rk, rd = ref_gray
    if d is None:
        return None, 0
    good = [m for m, n in matcher.knnMatch(d, rd, k=2) if m.distance < 0.75 * n.distance]
    if len(good) < 12:
        return None, 0
    src = np.float32([k[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([rk[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 6.0)
    if H is None:
        return None, 0
    # SIFT ran on the cropped viewport, so shift back into full-image pixels.
    offset = np.array([[1, 0, VIEWPORT["x0"]], [0, 1, VIEWPORT["y0"]], [0, 0, 1]], dtype=np.float64)
    return offset @ H, int(mask.sum())


def polygon_to_lnglat(points_xy, H, a, b):
    """Site-capture polygon -> [[lng, lat], ...] ring."""
    pts = np.array(points_xy, dtype=np.float64).reshape(-1, 1, 2)
    ref = cv2.perspectiveTransform(pts, H).reshape(-1, 2)
    ring = [[float(a[0] * x + a[1] * y + a[2]), float(b[0] * x + b[1] * y + b[2])]
            for x, y in ref]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def ring_area_m2(ring, lat0):
    """Planar area of a small lng/lat ring, in square metres."""
    m_lng = M_PER_DEG_LAT * math.cos(math.radians(lat0))
    xs = [(p[0] - ring[0][0]) * m_lng for p in ring]
    ys = [(p[1] - ring[0][1]) * M_PER_DEG_LAT for p in ring]
    area = 0.0
    for i in range(len(xs) - 1):
        area += xs[i] * ys[i + 1] - xs[i + 1] * ys[i]
    return abs(area) / 2.0


def mask_to_polygons(mask, min_area_px=400, simplify_frac=0.012):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in contours:
        if cv2.contourArea(c) < min_area_px:
            continue
        approx = cv2.approxPolyDP(c, simplify_frac * cv2.arcLength(c, True), True)
        if len(approx) >= 3:
            out.append(approx.reshape(-1, 2))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ground-truth", default="data/ground_truth")
    ap.add_argument("--out", default="public/parcels.geojson")
    ap.add_argument("--checkpoint", default="ml/models/unet_parcel.pt")
    args = ap.parse_args()

    a, b, diagnostics = fit_reference_transform()
    print(f"reference transform: mean residual {diagnostics['mean_residual_m']} m, "
          f"max {diagnostics['max_residual_m']} m, "
          f"{diagnostics['scale_x_m_per_px']} m/px, rot {diagnostics['rotation_deg']}deg")

    ref = cv2.imread(REFERENCE_SCREENSHOT)
    crop = ref[VIEWPORT["y0"]:VIEWPORT["y1"], VIEWPORT["x0"]:VIEWPORT["x1"]]
    sift = cv2.SIFT_create(nfeatures=12000)
    matcher = cv2.BFMatcher()
    ref_feats = sift.detectAndCompute(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), None)

    # Load the trained model once so predictions can be georeferenced too.
    model = device = None
    try:
        import torch
        from ml.building_detector.train_unet import ResNetUNet
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = ResNetUNet(pretrained=False).to(device)
        model.load_state_dict(torch.load(args.checkpoint, map_location=device,
                                         weights_only=False)["state_dict"])
        model.eval()
    except Exception as exc:  # georeferencing the labels still works without it
        print(f"[warn] model unavailable, exporting ground truth only: {exc}")

    features, site_summaries = [], []
    gt_dir = Path(args.ground_truth)

    for site_dir in sorted(p for p in gt_dir.iterdir() if p.is_dir()):
        site = site_dir.name
        image = cv2.imread(str(site_dir / "image.jpg"))
        truth = cv2.imread(str(site_dir / "mask.png"), cv2.IMREAD_GRAYSCALE)
        if image is None or truth is None:
            continue

        H, inliers = register_to_reference(image, ref_feats, sift, matcher)
        if H is None or inliers < MIN_INLIERS:
            print(f"[skip] {site}: registration too weak ({inliers} inliers)")
            continue

        layers = {"ground_truth": (truth > 127).astype(np.uint8) * 255}
        if model is not None:
            from ml.building_detector.train_unet import predict_full
            prob = predict_full(model, cv2.cvtColor(image, cv2.COLOR_BGR2RGB), device)
            layers["predicted"] = (prob > 0.5).astype(np.uint8) * 255

        counts = {}
        for source, mask in layers.items():
            polys = mask_to_polygons(mask)
            counts[source] = len(polys)
            for i, poly in enumerate(polys):
                ring = polygon_to_lnglat(poly, H, a, b)
                lat0 = float(np.mean([p[1] for p in ring]))
                features.append({
                    "type": "Feature",
                    "properties": {
                        "id": f"{site}:{source}:{i}",
                        "site": site,
                        "source": source,
                        "class": "parcel_boundary",
                        "area_sqm": round(ring_area_m2(ring, lat0), 1),
                    },
                    "geometry": {"type": "Polygon", "coordinates": [ring]},
                })

        # Ground sample distance of this capture, via the composed transform.
        scale = math.hypot(H[0, 0], H[1, 0]) * diagnostics["scale_x_m_per_px"]
        site_summaries.append({
            "site": site,
            "registration_inliers": inliers,
            "metres_per_pixel": round(float(scale), 3),
            **{f"{k}_polygons": v for k, v in counts.items()},
        })
        print(f"[OK] {site:32s} inliers={inliers:4d}  {scale:.2f} m/px  "
              + "  ".join(f"{k}={v}" for k, v in counts.items()))

    payload = {
        "type": "FeatureCollection",
        "crs_note": "WGS84 (EPSG:4326), derived — see georeferencing block",
        "georeferencing": {
            "method": (
                "Five clicked lat/lng control points recovered from the reference Google Maps "
                "camera by median-diffing Screenshots 143-148, least-squares affine fitted, then "
                "each site capture SIFT+RANSAC registered into that reference frame."
            ),
            **diagnostics,
        },
        "sites": site_summaries,
        "features": features,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload))
    print(f"\n{len(features)} georeferenced polygons across {len(site_summaries)} sites -> {out}")


if __name__ == "__main__":
    main()
