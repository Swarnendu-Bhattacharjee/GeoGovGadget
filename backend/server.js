const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// In-memory store standing in for SQLite/PostGIS today.
// { id, filename, status: "pending" | "approved" | "rejected", feature }
const parcelStore = new Map();

function hardcodedFeatureCollection() {
  // Fake but geometrically plausible building footprints / parcel boundaries
  // so the frontend has real GeoJSON shapes to render against.
  const features = [
    {
      type: "Feature",
      properties: { id: uuidv4(), class: "building_footprint", confidence: 0.94, status: "pending" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [77.5946, 12.9716], [77.5951, 12.9716], [77.5951, 12.9721],
          [77.5946, 12.9721], [77.5946, 12.9716]
        ]]
      }
    },
    {
      type: "Feature",
      properties: { id: uuidv4(), class: "parcel_boundary", confidence: 0.88, status: "pending" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [77.5944, 12.9714], [77.5954, 12.9714], [77.5954, 12.9724],
          [77.5944, 12.9724], [77.5944, 12.9714]
        ]]
      }
    },
    {
      type: "Feature",
      properties: { id: uuidv4(), class: "parcel_boundary", confidence: 0.81, status: "pending" },
      // Deliberately overlaps the parcel above, to demo the overlap/encroachment check.
      geometry: {
        type: "Polygon",
        coordinates: [[
          [77.5952, 12.9718], [77.5960, 12.9718], [77.5960, 12.9726],
          [77.5952, 12.9726], [77.5952, 12.9718]
        ]]
      }
    }
  ];

  for (const f of features) parcelStore.set(f.properties.id, f);

  return { type: "FeatureCollection", features };
}

// Naive AABB-based overlap check (bounding box), good enough for a demo flag.
// Real version (Pranjal/ML side) should use Shapely/Turf polygon intersection.
function boundingBox(coords) {
  const ring = coords[0];
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function boxesOverlap(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function findOverlaps(features) {
  const overlaps = [];
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const a = boundingBox(features[i].geometry.coordinates);
      const b = boundingBox(features[j].geometry.coordinates);
      if (boxesOverlap(a, b)) {
        overlaps.push([features[i].properties.id, features[j].properties.id]);
      }
    }
  }
  return overlaps;
}

app.get("/health", (req, res) => res.json({ status: "ok" }));

// POST /segment — accepts an uploaded image, returns segmentation as GeoJSON.
// STUB: ignores the actual image content and returns hardcoded polygons so the
// frontend can build against the real response shape today. Swap the body of
// this handler for Pranjal's model output (mask -> Shapely polygons -> GeoJSON)
// without changing the contract.
app.post("/segment", upload.single("image"), (req, res) => {
  const fc = hardcodedFeatureCollection();
  const overlaps = findOverlaps(fc.features);

  res.json({
    imageId: uuidv4(),
    filename: req.file ? req.file.originalname : null,
    polygons: fc,
    overlaps
  });
});

// GET /parcels — list all parcels currently held (for the dashboard's initial load).
app.get("/parcels", (req, res) => {
  const features = Array.from(parcelStore.values());
  res.json({ type: "FeatureCollection", features });
});

// POST /verify/:id — human-in-the-loop approve/reject of a single parcel.
app.post("/verify/:id", (req, res) => {
  const { status } = req.body; // "approved" | "rejected"
  const feature = parcelStore.get(req.params.id);

  if (!feature) return res.status(404).json({ error: "not found" });
  if (!["approved", "rejected", "pending"].includes(status)) {
    return res.status(400).json({ error: "status must be approved, rejected, or pending" });
  }

  feature.properties.status = status;
  res.json(feature);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`GeoGovGadget backend stub listening on :${PORT}`));
