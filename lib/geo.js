// Demo-mode feature generator + real topology validation.
//
// The segmentation step (turning pixels into parcel/building polygons) is the
// part that in production is a trained Mask R-CNN / U-Net model. Standing one
// up and training it is out of scope for today's build, so this file
// generates deterministic, seeded polygons instead — same input image always
// produces the same layout, different images produce different layouts. This
// is the single place a real model's output would plug in: replace
// `generateFeatures()`'s body with the model's mask -> polygon conversion and
// nothing else in the app needs to change.
//
// Overlap/topology validation (`findOverlaps`) is real: it runs actual
// polygon-intersection geometry via Turf.js against whatever features exist,
// generated or model-produced alike.

import * as turf from "@turf/turf";

// Reference site: an urban block, used as the anchor for generated geometry.
export const SITE_CENTER = [77.5946, 12.9716]; // [lng, lat] — Bengaluru sample block

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

function rectAround([lng, lat], w, h) {
  return [
    [
      [lng - w / 2, lat - h / 2],
      [lng + w / 2, lat - h / 2],
      [lng + w / 2, lat + h / 2],
      [lng - w / 2, lat + h / 2],
      [lng - w / 2, lat - h / 2],
    ],
  ];
}

const CLASS_STYLE = {
  building_footprint: { fill: "#4fd1c5", label: "Building footprint" },
  parcel_boundary: { fill: "#ff8a3d", label: "Parcel boundary" },
  road: { fill: "#8fa0bc", label: "Road / access corridor" },
  land_use: { fill: "#7fd88f", label: "Land-use zone" },
};

export function classStyle(cls) {
  return CLASS_STYLE[cls] || { fill: "#e7ebf2", label: cls };
}

const WARDS = ["Ward 12 — Indiranagar", "Ward 17 — Domlur", "Ward 24 — Koramangala", "Ward 31 — HSR Layout"];
const OWNER_TYPES = ["Private (Residential)", "Private (Commercial)", "Government", "Institutional"];

function surveyNumber(rand, i) {
  const year = 2019 + Math.floor(rand() * 6);
  return `SY-${year}-${String(1000 + i * 37 + Math.floor(rand() * 30)).slice(-4)}`;
}

function lastVerifiedDate(rand) {
  const daysAgo = Math.floor(rand() * 700);
  const d = new Date(Date.UTC(2026, 7, 31) - daysAgo * 86400000);
  return d.toISOString().slice(0, 10);
}

// Adds the record-style metadata a government official would actually ask
// about (survey number, ward, owner type, area, last verified) and a
// heightM used purely for the 3D visualization. Not part of the core
// segmentation output — layered on top so lib/geo.js stays the single
// source of truth for both the map and the AI assistant's context.
function enrichRecord(feature, rand, i) {
  const p = feature.properties;
  let area_sqm = null;
  let heightM = 0;
  if (feature.geometry.type === "Polygon") {
    try {
      area_sqm = Math.round(turf.area(feature));
    } catch {
      area_sqm = null;
    }
    if (p.class === "building_footprint") {
      const floors = 1 + Math.floor(rand() * 6);
      heightM = floors * 3.2;
      p.floors = floors;
    } else if (p.class === "parcel_boundary") {
      heightM = 1.2;
    } else if (p.class === "land_use") {
      heightM = 0.4;
    }
  }

  p.surveyNo = surveyNumber(rand, i);
  p.ward = WARDS[Math.floor(rand() * WARDS.length)];
  p.ownerType = OWNER_TYPES[Math.floor(rand() * OWNER_TYPES.length)];
  p.lastVerified = lastVerifiedDate(rand);
  p.area_sqm = area_sqm;
  p.heightM = heightM;
  return feature;
}

// Deterministic "segmentation output" for a given upload. Seeded by
// filename + size so repeat uploads of the same file reproduce the same
// layout, and different files look different — not literally hardcoded.
export function generateFeatures(seedKey) {
  const rand = mulberry32(hashSeed(seedKey || "default"));
  const [cx, cy] = SITE_CENTER;
  const features = [];

  const gridCols = 3;
  const gridRows = 2;
  const cellW = 0.0011;
  const cellH = 0.0009;

  let id = 0;
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const jitterX = (rand() - 0.5) * 0.00012;
      const jitterY = (rand() - 0.5) * 0.00012;
      const px = cx - 0.0016 + c * cellW + jitterX;
      const py = cy - 0.0009 + r * cellH + jitterY;

      // Parcel boundary (bigger, but kept well inside its grid cell so
      // neighboring parcels don't overlap by construction — only the
      // deliberate pair below should trip the topology check).
      const parcelW = cellW * (0.62 + rand() * 0.14);
      const parcelH = cellH * (0.62 + rand() * 0.14);
      const parcelId = `f${id++}`;
      features.push({
        type: "Feature",
        properties: {
          id: parcelId,
          class: "parcel_boundary",
          confidence: Number((0.78 + rand() * 0.19).toFixed(2)),
          status: "pending",
        },
        geometry: { type: "Polygon", coordinates: rectAround([px, py], parcelW, parcelH) },
      });

      // Building footprint (smaller, inset)
      const bW = parcelW * (0.45 + rand() * 0.2);
      const bH = parcelH * (0.45 + rand() * 0.2);
      const buildingId = `f${id++}`;
      features.push({
        type: "Feature",
        properties: {
          id: buildingId,
          class: "building_footprint",
          confidence: Number((0.85 + rand() * 0.13).toFixed(2)),
          status: "pending",
        },
        geometry: { type: "Polygon", coordinates: rectAround([px, py], bW, bH) },
      });
    }
  }

  // Deliberately push two adjacent parcels to overlap sometimes, so the
  // topology check has something real to find (still driven by the seed,
  // not scripted every time).
  if (rand() > 0.4 && features.length >= 4) {
    const a = features[0];
    const [lng, lat] = a.geometry.coordinates[0][0];
    features[2].geometry.coordinates = rectAround(
      [lng + cellW * 0.35, lat + cellH * 0.1],
      cellW * 0.95,
      cellH * 0.85
    );
  }

  // A road running through the block
  const roadId = `f${id++}`;
  features.push({
    type: "Feature",
    properties: { id: roadId, class: "road", confidence: 0.9, status: "pending" },
    geometry: {
      type: "LineString",
      coordinates: [
        [cx - 0.002, cy - 0.0011],
        [cx + 0.0022, cy + 0.0012],
      ],
    },
  });

  // A land-use zone (larger, low-confidence classification)
  const landUseId = `f${id++}`;
  features.push({
    type: "Feature",
    properties: {
      id: landUseId,
      class: "land_use",
      confidence: Number((0.6 + rand() * 0.2).toFixed(2)),
      status: "pending",
      label: "Mixed residential",
    },
    geometry: { type: "Polygon", coordinates: rectAround([cx + 0.0007, cy - 0.0004], 0.0038, 0.0026) },
  });

  features.forEach((f, i) => enrichRecord(f, rand, i));

  return { type: "FeatureCollection", features };
}

// Real geometry check: flags any pair of same-class polygons whose shapes
// actually intersect (parcel-vs-parcel, or building-vs-building).
// Deliberately NOT cross-class (parcel vs. its own building) — a building
// footprint sitting inside its parent parcel is correct, not an overlap.
export function findOverlaps(featureCollection) {
  const overlaps = [];

  for (const cls of ["parcel_boundary", "building_footprint"]) {
    const polys = featureCollection.features.filter(
      (f) => f.geometry.type === "Polygon" && f.properties.class === cls
    );
    for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        try {
          const intersection = turf.intersect(turf.featureCollection([polys[i], polys[j]]));
          if (intersection) {
            overlaps.push([polys[i].properties.id, polys[j].properties.id]);
          }
        } catch {
          // Non-overlapping or degenerate geometry — skip.
        }
      }
    }
  }
  return overlaps;
}
