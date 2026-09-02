# Building footprint detector

Detects building footprints on aerial/satellite images using a **pretrained**
Segment Anything (SAM) model — no training data required. This is the
"pretrained + OpenCV post-processing" path described in `PROJECT_PLAN.md`,
and it's the piece that plugs into `generateFeatures()` in `lib/geo.js`
(see that file's comment for the exact swap-in point).

## Why pretrained, not trained

`ml/notebooks/train_boundary_model.ipynb` assumes paired `raw` + `plotted`
images where `plotted` has hand-drawn red/green boundary lines on top of
the raw photo, which get thresholded into training masks automatically.
The imagery actually collected (`IMAGES/RAW` + `IMAGES/PLOTTED`) doesn't
match that shape — `PLOTTED` is a schematic Google Maps render of the same
site, not a pixel-aligned annotation of `RAW`. So there's currently no
labeled mask data to train on. This module detects buildings zero-shot
instead; swap in the trained U-Net later once real labeled masks exist.

## Setup

```bash
cd ml/building_detector
python3 -m venv ../.venv && source ../.venv/bin/activate
pip install -r requirements.txt
./download_checkpoint.sh vit_b   # ~375MB, fits a 6GB GPU; also: vit_l, vit_h
```

## Run

```bash
source ml/.venv/bin/activate
python3 -m ml.building_detector.detect \
  --input path/to/image_or_folder \
  --output data/outputs/buildings \
  --checkpoint ml/models/sam_vit_b_01ec64.pth \
  --model-type vit_b
```

For each image `<name>.jpg`, writes `data/outputs/buildings/<name>/`:

- `overlay.jpg` — original image with detected footprints outlined (yellow)
- `mask.png` — binary building mask
- `edges.png` — mask boundaries on black
- `footprints.geojson` — polygons in **pixel** coordinates (col, row)

## Filtering heuristics

SAM proposes class-agnostic masks for everything in the image (buildings,
trees, roads, shadows). `detect.py`'s `FilterConfig` keeps only masks that
look like rooftops: bounded area (not a speck, not the whole background),
reasonably convex (`solidity`), not a long thin sliver (`max_aspect_ratio`,
filters out roads/paths), and not spanning almost the entire frame. Tune
`FilterConfig` in `detect.py` if a particular image type needs looser/
tighter thresholds — tree clusters and dark shadow patches are the most
common false positives.

## Combining RAW + PLOTTED (vegetation-robust footprints)

`detect.py` alone struggles wherever tree canopy sits on top of a roof in
the RAW photo — the mask either gets swallowed by the tree blob or broken
into fragments, and `FilterConfig`'s shape filters end up rejecting real
buildings along with real trees. `PLOTTED` images don't have this problem:
they're flat Google Maps schematic renders where every building is a
single solid fill color with a clean edge and zero vegetation.
`plotted_extractor.py` reads footprints directly off that fill color
(sampled as a consistent `BGR(202, 208, 215)` across all 10 PLOTTED
images), and snaps each shape to a rotated rectangle when it's close
enough to one, or a simplified polygon otherwise.

`combine.py` runs both detectors for every RAW/PLOTTED pair (fuzzy-matched
by filename word overlap, since e.g. `"bel block and canteen.png"` and
`"bel block.png"` name the same site differently) and writes, into
`<output>/<site>/`:

- `raw_overlay.jpg` / `plotted_overlay.jpg` — each source's outlines
- `side_by_side.jpg` — both overlays in one image for a quick compare
- `combined.geojson` — both sources' polygons, tagged `"raw_photo"` /
  `"plotted_schematic"`

**Important:** RAW and PLOTTED are *not* pixel-registered. An ORB+RANSAC
homography was attempted between a pair (`bel block and canteen.png` /
`bel block.png`) and rejected — 8 inlier matches out of 200 candidates,
i.e. no reliable geometric correspondence, because one is a satellite
photo and the other a differently-projected flat map render of the same
place. So `combine.py` reports both detections side by side rather than
claiming a fused, spatially-aligned polygon set. Use PLOTTED's shapes as
the vegetation-immune reference for a site, and RAW/SAM's shapes for
photo-level detail (parking lots, informal structures, anything not in
Google's map data).

```bash
python3 -m ml.building_detector.combine \
  --raw-dir path/to/RAW --plotted-dir path/to/PLOTTED \
  --output data/outputs/combined \
  --checkpoint ml/models/sam_vit_b_01ec64.pth --model-type vit_b
```

## Wiring into the app

`footprints.geojson` uses pixel coordinates because these images aren't
geo-referenced (no lng/lat transform is available for a screenshot/photo).
`app/api/segment/route.js` currently returns demo lng/lat polygons from
`generateFeatures()`. To wire real detections in:

1. Run this detector on the uploaded image server-side.
2. Either geo-reference the output (if the image has known corner
   lng/lat, e.g. from a map export) and convert pixel→lng/lat, or keep the
   polygons in image-pixel space and have the frontend overlay them
   directly on the displayed image (not a Leaflet basemap) using an
   image-coordinate overlay instead of geographic coordinates.
3. Replace `generateFeatures(seedKey)`'s return value with
   `polygons_to_geojson(...)`'s output — `findOverlaps()` in `lib/geo.js`
   already works on any `FeatureCollection` of polygons, real or seeded.
