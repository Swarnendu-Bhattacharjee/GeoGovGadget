# GeoGovGadget — Team INFERICS — SIH 2026 (PS 26012)

**Problem Statement:** AI-Enabled Automated Cadastral Mapping and Urban Parcel Boundary Extraction using Drone/Satellite Imagery
**Category:** Software | **Theme:** AI-automated geospatial property boundary mapping
**Deadline:** Working demo ready by tonight (2026-08-31). Dept. screening tomorrow (2026-09-01).

## Reality check on scope

The full pitch (custom-trained U-Net/Mask R-CNN + PostGIS + Web-GIS dashboard + Raspberry Pi
edge TFLite unit) is a multi-week build. In one day we build a **working, demoable slice** of
every layer in the pipeline, using pretrained/lightly-fine-tuned models and sample imagery
instead of a from-scratch trained model. Judges care that the pipeline is real and the demo
runs live — not that the model is production-accurate.

**What "done" looks like tonight:**
1. Upload a drone/satellite image → backend runs segmentation → returns building footprint +
   parcel boundary polygons (GeoJSON).
2. Web-GIS dashboard displays the image with polygons overlaid on a Leaflet map, with an
   "approve/reject/edit" human-verification action (can be a stub that just persists a status).
3. A basic overlap/encroachment check flags two polygons that intersect.
4. Edge story: a script demonstrating the same inference running via TensorFlow Lite (on a
   laptop simulating a Pi, or on an actual Pi if Pranjal has one handy) — doesn't need to be
   physically wired to a camera, just needs to prove the "works offline, on-device" claim.
5. 2–3 minute live demo script + updated pitch deck slide with architecture diagram + README.

Cut ruthlessly if behind schedule, in this order: edge device demo (fake it in slides if no
time) → overlap-check UI polish → multi-image batch upload → auth/login. Never cut: the
live segmentation-to-map demo — that's the whole pitch.

## Tech stack (from PPT, trimmed for a 1-day build)

- **ML/CV:** Python, OpenCV, TensorFlow/Keras. Use a **pretrained Mask R-CNN** (COCO weights,
  fine-tune only if there's a labeled sample set available; otherwise pretrained + OpenCV
  post-processing is enough for a convincing demo) for building/parcel segmentation.
  GDAL/Shapely to convert raster masks → GeoJSON polygons.
- **Backend:** Node.js/Express (or FastAPI if faster for the ML dev) exposing `/segment`,
  `/parcels`, `/verify` endpoints. SQLite for the day (swap-in PostGIS is a "future work" slide,
  not a blocker) unless PostGIS is already installed somewhere and trivial to spin up.
- **Frontend:** React + Leaflet, image upload, polygon overlay, verify/reject buttons.
- **Edge:** TensorFlow Lite conversion of the same model + a standalone script that runs
  inference on a static image, timed, to show it works without a network call.
- **Data:** A handful of open aerial/satellite images (e.g. sample drone/orthophoto tiles,
  or public satellite crops) dropped into `data/sample_imagery/` — enough to demo, not a
  full dataset.

## Repo layout (scaffolded)

```
GeoGovGadget/
  backend/         API server (segmentation endpoint, polygon store, verify/reject, overlap check)
  frontend/        React + Leaflet dashboard
  ml/              model loading/inference code, notebooks for quick experiments
  edge/            TFLite conversion + standalone edge-inference demo script
  data/
    sample_imagery/  demo input images
    outputs/          generated GeoJSON/shapefile outputs
  docs/            architecture diagram, demo script, judge Q&A prep notes
  assets/          screenshots/gifs for the deck
```

## Roles (mapped to stated skills)

| Person | Primary role today | Owns |
|---|---|---|
| **Swarnendu** | Tech lead + integration | Backend API, glue between ML output → GeoJSON → frontend, devops (repo, running everything live for the demo), fallback on anything blocked |
| **Pranjal** | ML/CV lead | Mask R-CNN/OpenCV segmentation pipeline, mask→polygon conversion, TFLite conversion for the edge demo |
| **Sheshadri** | Data | Source/prepare sample drone & satellite images, basic labeling if fine-tuning happens, sanity-check outputs against real geography |
| **Aditi** | Design | Dashboard UI/UX (Leaflet map styling, verify/reject flow, polygon color coding), refreshed pitch deck visuals, architecture diagram |
| **Samson** | Docs + narrative | README, demo script (word-for-word walkthrough), updated PPT text, keeps the timeline honest (tracks what's actually done vs. claimed) |
| **Pranav** | Devil's advocate / judge-proofing | Stress-tests the live demo (breaks it on purpose before judges do), preps answers to hard questions (accuracy, scalability, SVAMITVA fit, why Pi, data privacy), owns the pitch narrative/Q&A |

Swarnendu and Pranjal are the only two who *must* touch ML/backend code simultaneously —
everyone else can work in parallel once the API contract (`/segment` request/response shape)
is agreed in the first 30 minutes.

## Timeline — today, 2026-08-31 (times in IST, adjust to actual local time)

**12:00–12:30 — Kickoff (all 6)**
- Walk through this plan, confirm the API contract: `POST /segment` takes an image, returns
  `{ polygons: GeoJSON FeatureCollection, overlaps: [...] }`.
- Aditi starts on UI wireframe in parallel from minute 1.
- Sheshadri starts pulling sample imagery immediately.

**12:30–15:30 — Core build sprint 1**
- Pranjal: get pretrained Mask R-CNN running locally on a sample image, output raw masks.
- Swarnendu: scaffold backend API + repo structure (done), stub `/segment` returning
  hardcoded GeoJSON so frontend can start against a real contract immediately.
- Aditi: build Leaflet map + image overlay component against the stubbed API.
- Sheshadri: finalize 5–10 sample images, converted to consistent format/resolution.
- Samson: draft README + demo script skeleton.
- Pranav: research judge panel's likely questions from problem statement + SVAMITVA docs.

**15:30–16:00 — Sync + merge checkpoint**
- Swap stubbed `/segment` for Pranjal's real model output → mask-to-polygon (Shapely) →
  real GeoJSON. Confirm frontend renders it without changes (contract discipline pays off here).

**16:00–19:00 — Core build sprint 2**
- Swarnendu + Pranjal: wire overlap/encroachment check (Shapely polygon intersection),
  verify/reject persistence (SQLite).
- Aditi: polish UI — verify/reject buttons, polygon color by status, responsive layout,
  finalize deck visuals/architecture diagram.
- Pranjal (after model wired): convert model to TFLite, write `edge/infer.py` standalone
  script proving offline inference + timing it.
- Samson: keep README/demo script updated as features land; update PPT text to match
  what's actually built (don't let the deck overclaim).
- Sheshadri: QA outputs against real image geography, flag bad segmentations.
- Pranav: start breaking the demo — bad image formats, huge files, no-detection cases —
  report bugs immediately rather than at the end.

**19:00–20:00 — Feature freeze + integration**
- No new features after this point. Everyone fixes bugs Pranav/Sheshadri find.

**20:00–21:00 — Full dry run #1**
- Run the entire demo start to finish, live, on the actual machine/network you'll present on.
- Samson times it, Pranav plays skeptical judge and asks the hard questions out loud.

**21:00–22:00 — Fix what broke in dry run #1**

**22:00–22:30 — Dry run #2 (should be clean)**
- Record a backup screen-capture video of a working run in case live demo fails tomorrow.

**22:30–23:30 — Deck + narrative finalization**
- Aditi finalizes slides, Samson finalizes speaking script, Pranav finalizes Q&A cheat sheet.
- Swarnendu/Pranjal write up "future work" (PostGIS, full training data, physical Pi
  deployment, DILRMP integration) so unfinished scope reads as roadmap, not gaps.

**23:30 onward — Stop. Sleep.**
- Screening is tomorrow morning. A tired team fumbling Q&A loses more points than a slightly
  smaller feature set. Don't code past this.

**Tomorrow morning before screening**
- 30 min buffer: re-run the demo once, cold, exactly as it'll be presented.

## First 30 minutes — concrete next actions

1. Swarnendu: `git init`, push initial scaffold, share repo access.
2. Agree the `/segment` API contract as a team (5 min), then split.
3. Pranjal: `pip install tensorflow opencv-python shapely` and get a pretrained Mask R-CNN
   sample running against one test image before touching anything Indian-imagery-specific.
4. Sheshadri: start pulling sample aerial/satellite images now — this blocks everyone else
   from testing on real data.
