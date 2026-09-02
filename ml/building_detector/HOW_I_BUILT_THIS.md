# How the building-footprint detector was built

A step-by-step log of exactly what was done, in order, to go from
`C:\Users\Swarnendu\Downloads\IMAGES` to working footprint detections.

## 1. Looked at the source data

Folder given: `IMAGES/` with three subfolders.

- `EXAMPLE/` (6 images) — the *target output style*. Two formats shown:
  1. An aerial photo with yellow polygon outlines drawn around every
     rooftop.
  2. A 2x3 grid: raw photo | white-on-black binary mask | edge-only
     outline, for two different scenes.
- `RAW/` (10 images) — satellite screenshots of SRM Kattankulathur campus
  buildings (BEL block, law school, dental/medical/global blocks, etc.),
  no labels.
- `PLOTTED/` (10 images) — **not** annotations of `RAW`. These are Google
  Maps *schematic* renders of the same locations (grey building blocks
  with text labels like "BEL Lab", "Canteen"), not pixel-aligned masks.
  Confirmed by opening a matched pair side by side — different
  projection, different framing, no correspondence usable as ground
  truth.

Also found an existing prototype already in the repo:
`ml/notebooks/train_boundary_model.ipynb`. It assumes `PLOTTED` images
have hand-drawn **red/green lines on top of the raw photo**, which it
would threshold in HSV to auto-generate training masks, then train a
MobileNetV2-encoder U-Net. That assumption doesn't match the real
`PLOTTED` folder (schematic map, no colored line overlay, not
pixel-aligned) — so that notebook's data pipeline can't run on this data
as-is. This meant: **no usable training labels exist**, so training a
model from scratch was ruled out.

## 2. Asked what approach to take (AskUserQuestion)

Given no labels, offered three options and asked which to build:
- Pretrained segmentation + polygon extraction (no training data needed)
- Classical CV only (no ML)
- Set up a trainable pipeline for future labeled data

User picked **pretrained segmentation + polygon extraction**, and for
output format picked **overlay image + mask/edge images + GeoJSON
polygons**.

## 3. Checked the local machine before choosing a model

```bash
python3 --version                                   # Python 3.12.3
pip3 list | grep -iE "torch|opencv|segment|numpy"    # only numpy/pillow present
nvidia-smi --query-gpu=name,memory.total --format=csv
# NVIDIA GeForce RTX 3050 Laptop GPU, 6144 MiB
curl -sI https://github.com --max-time 5             # internet reachable
```

6GB of VRAM and working internet meant a mid-size pretrained vision model
was feasible locally.

## 4. Chose Segment Anything (SAM) as the pretrained model

Why SAM specifically, over other pretrained options:
- It's class-agnostic instance segmentation — proposes a mask for
  *everything* in the image without needing "building" as a trained
  class (unlike COCO-pretrained Mask R-CNN, which has no building
  category).
- `vit_b` checkpoint is ~375MB and runs comfortably on a 6GB GPU.
- Ships an "automatic mask generator" mode that needs zero prompts/clicks
  — just runs on a full image and returns every object-like region, which
  is exactly what's needed for an unattended batch pipeline.

The trade-off: SAM doesn't know what a "building" is either — it just
finds coherent blobs (buildings, tree clusters, shadows, parking lots).
So a **post-processing filter** on top of SAM's raw output was the actual
building-detection logic (see step 6).

## 5. Set up the environment

```bash
mkdir -p ml/building_detector
python3 -m venv ml/.venv
source ml/.venv/bin/activate
pip install -r ml/building_detector/requirements.txt
```

`requirements.txt`:
```
torch>=2.1
torchvision>=0.16
git+https://github.com/facebookresearch/segment-anything.git
opencv-python-headless>=4.8
numpy>=1.24
Pillow>=10.0
shapely>=2.0
tqdm>=4.66
```

Installed torch 2.13.0+cu130 with CUDA, confirmed working:

```bash
python3 -c "import torch; print(torch.__version__, torch.cuda.is_available())"
# 2.13.0+cu130 True
```

Downloaded the pretrained SAM checkpoint (public Meta AI weights, no
account/auth needed) via `ml/building_detector/download_checkpoint.sh`:

```bash
curl -L -o ml/models/sam_vit_b_01ec64.pth \
  https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth
```

## 6. Wrote the detection pipeline (`ml/building_detector/detect.py`)

Four stages, in order:

1. **`load_sam_mask_generator`** — loads the SAM checkpoint via
   `segment_anything.sam_model_registry`, wraps it in
   `SamAutomaticMaskGenerator` (32 points-per-side grid, IoU/stability
   thresholds tuned slightly up from SAM's defaults to cut down on noisy
   low-confidence proposals, `min_mask_region_area=200px` to drop
   speckles immediately).

2. **`detect_building_masks`** — runs the mask generator on the full
   image (BGR→RGB first, SAM expects RGB), then passes every proposed
   mask through `_is_building_like()`, a shape filter using OpenCV
   contour math:
   - **area fraction** in `[0.03%, 35%]` of the image — drops single-pixel
     noise and drops masks that are basically the whole background/ground.
   - **solidity** (`contour area / convex-hull area`) ≥ 0.55 — rooftops
     are fairly convex; this rejects sprawling, concave blobs (tree
     canopies, mixed vegetation+shadow regions).
   - **aspect ratio** (`max(w,h)/min(w,h)`) ≤ 6 — rejects long thin
     slivers: roads, the translucent route-line overlays baked into some
     of the campus screenshots, drainage lines.
   - **border-touch check** — rejects a mask whose bounding box covers
     almost the entire frame (near-guaranteed background).
   All thresholds live in one `FilterConfig` dataclass so they're easy to
   retune per image type.

3. **`masks_to_polygons`** — for each surviving mask: `cv2.findContours`
   to get its outer boundary, `cv2.approxPolyDP` (Douglas-Peucker, ε =
   0.4% of the contour's perimeter) to simplify the pixel-jagged mask
   edge into a clean polygon — this is what turns a blobby raster mask
   into the crisp straight-edged outlines seen in the output, matching
   the look of `EXAMPLE/`.

4. **`render_outputs`** — draws the polygons on a copy of the original
   image in yellow (`cv2.polylines`, matches `EXAMPLE`'s outline style),
   builds a binary mask image (union of all kept masks), and a Canny edge
   map of that mask for the "edges-only" output style.

5. **`polygons_to_geojson`** — wraps each polygon as a GeoJSON
   `Feature` with `class: "building_footprint"`. Coordinates are **pixel**
   (col, row), explicitly labeled `crs_note` in the output, since none of
   these images carry a geo-transform (they're screenshots/photos, not
   geo-referenced rasters) — there's no way to derive real lng/lat without
   that.

CLI entry point (`main()`) takes `--input` (file or folder), `--output`,
`--checkpoint`, `--model-type`, loops over every image, calls
`process_image()`, writes `overlay.jpg` / `mask.png` / `edges.png` /
`footprints.geojson` per image into `<output>/<image_stem>/`.

## 7. Ran it and checked the output visually

```bash
python3 -m ml.building_detector.detect \
  --input "IMAGES/RAW" \
  --output data/outputs/buildings \
  --checkpoint ml/models/sam_vit_b_01ec64.pth --model-type vit_b
```

All 10 RAW images processed in ~77 seconds total on the RTX 3050 (~7-8s
each), 73–138 footprints detected per image. Read a few `overlay.jpg`
and `mask.png` outputs directly to eyeball quality against `EXAMPLE/` —
rooftops traced cleanly; some false positives on dense tree clusters and
hard shadow edges (SAM has no semantic notion of "building", so this is
an expected zero-shot limitation, not a bug — tune `FilterConfig` to
tighten it further per scene).

Built a 5×2 thumbnail grid (`scan_summary.jpg`) of every processed
image's overlay, side by side, labeled with filenames, as a single-glance
summary of what got scanned.

## 8. Documented the integration point

Wrote `ml/building_detector/README.md` explaining: why pretrained (not
trained) was the right call given the data actually available, how to
run it, what the filter knobs do, and exactly how to wire
`footprints.geojson` into `app/api/segment/route.js` — that route
currently returns seeded fake polygons from `generateFeatures()` in
`lib/geo.js` (explicitly commented in that file as "the single place a
real model's output would plug in"); this detector's `polygons_to_geojson()`
output is what would replace that function's return value once a
geo-referencing strategy (or an image-pixel-space frontend overlay) is
decided.

## 9. Follow-up: RAW-only detection missed footprints hidden under tree canopy

The user pointed out that greenery in the RAW photos covers parts of
plots, and asked to use both RAW and PLOTTED together to compensate.

**Investigated whether RAW and PLOTTED could be pixel-registered** (so
one detector's output could be warped onto the other's coordinate space):
sampled ORB keypoints on both `bel block and canteen.png` (RAW) and
`bel block.png` (PLOTTED), matched them, ran RANSAC homography fitting.
Result: 8 inlier matches out of 200 candidates — essentially no reliable
geometric correspondence, because RAW is a satellite photo and PLOTTED is
a differently-projected flat schematic render of the same place, not a
photographic annotation. Registration was ruled out on that evidence.

**Checked whether PLOTTED could be used as its own independent,
vegetation-immune detector instead.** Sampled the most common pixel
colors across all 10 PLOTTED images (`Counter` over BGR pixel values):
building fill was consistently `~BGR(202, 208, 215)` (light tan-grey),
clearly distinct from background land (`~234, 239, 240`), parks
(`~208, 248, 213`), and roads (white, or `~221, 210, 182` for arterial
roads). That consistency across every image is what made a single fixed
color threshold viable without per-image tuning.

Wrote **`ml/building_detector/plotted_extractor.py`**:
1. `cv2.inRange` on that BGR range → binary building mask.
2. Morphological close (bridges gaps where a text label like "BEL Lab" is
   drawn over a building in a different color, splitting its fill) then
   open (drops speckle noise).
3. `cv2.findContours` per building blob, filtered by `min_area_px`.
4. For each contour: compute `cv2.minAreaRect`; if
   `contour_area / rect_area >= 0.88` the shape is snapped to that
   rotated rectangle (`cv2.boxPoints`) — most single buildings are drawn
   this way on the map. Otherwise simplified via `approxPolyDP` into a
   polygon (covers L-shaped/complex blocks like the biotech block).
   This is the "polygons or rectangles" output the user asked for.

Verified visually on `bel block.png`: the color mask alone reproduced the
building footprints almost exactly (BEL Lab, Architecture Block, MBA
Block, biotech block, Canteen, temple) with zero vegetation artifacts,
before any rectangle/polygon fitting was even applied.

Wrote **`ml/building_detector/combine.py`**:
1. `match_pairs()` — fuzzy-matches RAW/PLOTTED filenames by Jaccard
   overlap of word tokens (they're named inconsistently, e.g.
   `"annexure and m,n block.jpg"` vs `"annexure , m,n block.jpg"`,
   `"main eee block entrance area.jpg"` vs `"eee block entrance.jpg"`).
   All 10 RAW images matched their correct PLOTTED counterpart.
2. For each matched pair: runs SAM detection on RAW (reusing
   `detect.py`'s functions) and color-based extraction on PLOTTED, then
   writes `raw_overlay.jpg`, `plotted_overlay.jpg`, a `side_by_side.jpg`
   comparison, and `combined.geojson` containing both sources' polygons
   under separate keys (`"raw_photo"`, `"plotted_schematic"`), explicitly
   labeled as unregistered/not spatially fused (see registration finding
   above) rather than silently overlaying incompatible coordinate spaces.

Ran it on all 10 pairs (~1m51s total, GPU): PLOTTED yielded 2–23 clean
vegetation-free footprints per site (fewer than RAW/SAM's 73–138, since
PLOTTED only contains what Google's map data drew — e.g. `law school`'s
PLOTTED image is mostly still-undeveloped land, so only 2 shapes),
confirming the two sources are complementary rather than redundant: RAW
for the full photo-detail (dense, but occluded by trees), PLOTTED for a
sparser but reliable, vegetation-immune structural reference. Built a
stacked thumbnail grid (`combined_summary.jpg`) of all 10 `side_by_side`
comparisons to eyeball the full batch at once.

## Files produced

```
ml/building_detector/
  detect.py                 RAW-photo pipeline (SAM load, filter, polygonize, render, GeoJSON)
  plotted_extractor.py      PLOTTED-schematic pipeline (color threshold, rect/polygon fit, GeoJSON)
  combine.py                pairs RAW+PLOTTED per site, runs both, writes side-by-side + combined GeoJSON
  requirements.txt
  download_checkpoint.sh    fetches sam_vit_b_01ec64.pth (or vit_l/vit_h)
  README.md                 usage + design rationale + app wiring notes
  HOW_I_BUILT_THIS.md       this file
ml/models/sam_vit_b_01ec64.pth   (gitignored — 357MB, re-downloadable)
ml/.venv/                        (gitignored — local Python env)
data/outputs/buildings/<image_stem>/
  overlay.jpg, mask.png, edges.png, footprints.geojson
data/outputs/buildings/scan_summary.jpg   grid of all RAW-only overlays
data/outputs/combined/<site>/
  raw_overlay.jpg, plotted_overlay.jpg, side_by_side.jpg, combined.geojson
data/outputs/combined/combined_summary.jpg   stacked grid of all side-by-side comparisons
```

## Nothing here is committed to git yet — these are new/untracked files.
