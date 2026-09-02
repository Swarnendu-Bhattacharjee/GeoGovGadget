# AI-Based Automated Urban Parcel Mapping and Cadastral Feature Extraction System using Drone Imagery

**Smart India Hackathon 2026 — Team Solution Pitch**

| | |
|---|---|
| **Problem Statement ID** | 26012 |
| **Organization** | Ministry of Rural Development |
| **Department** | Dept. of Land Resources (DoLR) |
| **Theme** | Robotics & Drones |

## What This Project Is

This project automates the creation of **cadastral maps** — the official maps that define land ownership boundaries — for urban areas, using **drone imagery** and **AI**, instead of relying on slow, fully manual surveying.

In simple terms: point a drone at a town, and this pipeline turns the resulting images into ready-to-use land parcel boundaries, buildings, and roads — flagging only the uncertain or conflicting cases for a human to check, instead of requiring a human to trace and verify everything by hand.

It's built as a **human-in-the-loop system by design** — not a fully autonomous "black box." Legal land records carry real consequences (property tax, ownership disputes, title verification), so the system is architected to let AI handle the repetitive, high-confidence work while routing anything ambiguous to a trained reviewer before anything is finalized.

## The Problem It Solves

Cadastral mapping today is slow, manual, and error-prone, for three main reasons:

1. **Manual digitization** — Technicians currently trace parcel boundaries by hand from imagery, one plot at a time. It's slow, and inconsistent between different technicians.
2. **Dense, irregular urban geometry** — Indian cities have overlapping structures, encroachments (illegal boundary extensions), and very narrow gaps between buildings — all of which make manual and simple automated tracing genuinely difficult.
3. **Delayed land records** — Even after imagery is captured, ambiguous boundaries require sending surveyors physically to the site to confirm them, which alone can stretch a survey out over months.

**Why now:** the raw data this system needs — drone imagery, elevation models (DSM/DTM), and orthorectified imagery (ORI) — is increasingly already being captured as part of routine government drone survey programs. The bottleneck has shifted from "do we have the data?" to "do we have a way to process it at scale?" — which is exactly what this pipeline addresses.

## How the Pipeline Works

A six-stage pipeline turns raw drone data into verified, government-usable cadastral maps:

### 1. Ingest & Fuse
Drone imagery, elevation data (DSM/DTM), and any existing GIS layers are aligned to the same coordinate system and tiled into consistent chunks — a required first step since these inputs are typically captured separately and won't line up otherwise.

**Key inputs:**
- High-resolution drone imagery
- **ORI** (Orthorectified Imagery) — drone photos corrected for lens/terrain distortion so they map accurately to real-world coordinates
- **DSM** (Digital Surface Model) — elevation of everything, including rooftops and trees
- **DTM** (Digital Terrain Model) — elevation of bare ground only
- Existing GIS parcel layers
- GNSS/CORS survey points — high-precision reference points used for calibration

### 2. AI Segmentation
Deep learning models scan the fused imagery and classify what's in it — buildings, parcels, roads — with three specialized tasks running in parallel:

- **Building & Parcel Segmentation** — U-Net / Mask R-CNN models, fine-tuned specifically on Indian urban imagery, using RGB color **plus nDSM** (nDSM = DSM − DTM, i.e., object height above ground) as input. This height data is what lets the model reliably tell a real building apart from a shadow or a painted ground marking — something color alone can't always do.
- **Road & Corridor Detection** — A separate, lightweight detection model tuned specifically for thin, linear shapes (roads don't segment well with models tuned for building-shaped blobs, so this runs independently for better precision).
- **Land-Use Classification** — Once a parcel's shape is known, simple contextual features (size, density, distance to roads) classify it as residential, commercial, mixed-use, or vacant — a lightweight step that doesn't need a second heavy vision model.

### 3. Vectorize
AI models output raw pixel grids, but GIS systems need precise geometric shapes — so this stage converts one into the other:

- **Contour Extraction** — Traces the outer edge of every AI-detected pixel blob into a rough polygon outline.
- **Polygon Simplification** — Uses Douglas-Peucker style simplification to smooth the jagged, pixel-stepped boundary into a clean polygon with far fewer points — turning a "staircase" shape into something resembling an actual property line.

### 4. Validate
Before anything reaches a human, the system automatically checks for geometric and logical errors:

- **Topology Snapping** — Adjacent parcel boundaries are pulled together to close small gaps that occur when neighboring parcels are segmented independently.
- **Conflict Detection** — Genuine overlaps between parcels (not fixable by snapping) are flagged as a likely encroachment or segmentation error, and routed for human review.

This is what makes the output usable in real GIS systems at all — no self-intersecting polygons, no slivers, no unexplained gaps between adjoining plots.

### 5. Review (Human-in-the-Loop)
A web-based **Cadastral Review Console** lets field officers verify only what needs verification:

- **Confidence scoring** — Every parcel/building carries a model confidence score.
- **Smart routing** — Only low-confidence or conflict-flagged parcels are shown to a reviewer — not the entire dataset. (E.g., in a ward with 50,000 parcels, reviewing only the 5% flagged means checking 2,500 instead of 50,000.)
- **Accept / reject / redraw** — Reviewers can directly edit boundaries on the map when the AI gets something wrong.
- **Ground-truth & GNSS overlay** — Survey reference points are shown alongside the AI output so reviewers have an objective check, not just visual judgment.

Built on **Leaflet/Mapbox + PostGIS** — mature, widely used GIS tools already familiar to government GIS teams, making this practical to actually deploy rather than just a research demo.

### 6. Deliver
Final, human-verified cadastral layers are exported in standard, GIS-ready formats — ready to plug directly into existing land records systems.

## Deliverables

1. **AI/ML Parcel Extraction Engine** — the end-to-end segmentation + detection pipeline for parcels, buildings, and roads (reusable on new drone captures for other areas).
2. **GIS-Ready Cadastral Outputs** — clean shapefile / GeoJSON exports, usable directly in existing GIS software with no new tooling required.
3. **Web-Based Visualization Dashboard** — the interactive review/editing/approval interface for field officers.
4. **Automated Topology Validation** — continuous geometry checks and conflict/encroachment flagging.

**Expected impact:**
- **↓ Time** — Weeks, not months, per ward.
- **↑ Accuracy** — Consistent AI-generated boundaries with human verification, rather than purely manual, technician-dependent tracing.
- **↓ Manual Effort** — Reviewers spend time only on the parcels that actually need attention.

## Technology Stack

| Layer | Tools | Why |
|---|---|---|
| AI / Modeling | U-Net, Mask R-CNN, CNN-based object detection; PyTorch / TensorFlow | Pixel-level and instance segmentation for buildings, parcels, and roads |
| Geoprocessing | GDAL, Rasterio, Shapely | Standard Python geospatial stack for raster-to-vector conversion and topology operations |
| Backend & Storage | PostGIS, REST APIs | Spatial database purpose-built for combined geometry + ownership/legal data, with APIs for integration into other government systems |
| Frontend / Web-GIS | Leaflet / Mapbox GL | Lightweight, widely adopted interactive mapping for the review dashboard |

## Design Philosophy

- **Human-in-the-loop, not fully autonomous.** Legal land records carry real consequences, so the system never claims full autonomy — every low-confidence or conflicting parcel requires human sign-off before being finalized.
- **Built for real deployment, not just a demo.** Every tool in the stack (PostGIS, Leaflet/Mapbox, GDAL) is open, mature, and already familiar to government GIS teams — prioritizing integration over novelty.
- **Efficiency through targeted review, not blanket automation.** Smart routing means human effort scales with the *number of ambiguous cases*, not the total number of parcels — this is what makes the system viable at city scale.

---

*From months of manual survey to a mostly-automated pipeline. AI does the heavy lifting. Humans verify only what matters.*

**PS 26012 — AI-Based Automated Urban Parcel Mapping and Cadastral Feature Extraction System using Drone Imagery**
