// Straight port of vectorize() and to_geojson() from
// ml/building_detector/infer_unet.py. Given a probability map from the U-Net,
// produces the same parcels the Python engine would, so a result carries the
// same meaning whichever engine ran it.

import { findExternalContours, meanInsidePolygon, morphologyEx } from "./raster.js";
import { approxPolyDP, arcLength, boundingRect, contourArea, minAreaRect } from "./geometry.js";

// Kept in sync with infer_unet.py's module constants.
export const MIN_AREA_FRAC = 0.0004;
export const SIMPLIFY_FRAC = 0.012;

export function vectorize(prob, width, height, threshold = 0.5, minAreaFrac = MIN_AREA_FRAC) {
  const binary = new Uint8Array(width * height);
  for (let i = 0; i < binary.length; i++) binary[i] = prob[i] > threshold ? 1 : 0;

  let cleaned = morphologyEx(binary, width, height, "open", 1);
  cleaned = morphologyEx(cleaned, width, height, "close", 2);

  const minArea = Math.max(60, minAreaFrac * width * height);
  const polygons = [];

  for (const contour of findExternalContours(cleaned, width, height)) {
    if (contourArea(contour) < minArea) continue;
    const approx = approxPolyDP(contour, SIMPLIFY_FRAC * arcLength(contour));
    if (approx.length / 2 < 3) continue;

    polygons.push({
      points: approx,
      area: contourArea(approx),
      // Mean model confidence inside the polygon, so the UI can rank parcels
      // for a human verifier instead of presenting them all as equal.
      confidence: meanInsidePolygon(approx, prob, width, height),
      bbox: boundingRect(approx),
      rect: minAreaRect(approx),
    });
  }

  polygons.sort((a, b) => b.area - a.area);
  return { polygons, mask: cleaned };
}

export function toGeoJSON(polygons, imageName) {
  const features = polygons.map((p, i) => {
    const ring = [];
    for (let k = 0; k < p.points.length; k += 2) ring.push([p.points[k], p.points[k + 1]]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);

    return {
      type: "Feature",
      properties: {
        lot_id: `LOT_${String(i).padStart(4, "0")}`,
        class: "parcel_boundary",
        source_image: imageName,
        area_pixels: Math.trunc(p.area),
        confidence: Math.round(p.confidence * 1e4) / 1e4,
        vertices: p.points.length / 2,
        rotation_angle: Math.round(p.rect.angle * 100) / 100,
        bbox: p.bbox,
      },
      geometry: { type: "Polygon", coordinates: [ring] },
    };
  });

  return {
    type: "FeatureCollection",
    crs_note: "pixel coordinates (col, row) — not geo-referenced",
    source_image: imageName,
    features,
  };
}
