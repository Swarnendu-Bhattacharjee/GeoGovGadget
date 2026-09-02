# GeoGovGadget 2.0 — AI-Enabled Automated Cadastral Mapping

[![SIH 2026](https://img.shields.io/badge/SIH%202026-INFECTS-blue)](https://www.sih.gov.in/)
[![Python 3.14](https://img.shields.io/badge/Python-3.14.4-blue)]()
[![OpenCV 5.0](https://img.shields.io/badge/OpenCV-5.0.0-red)]()
[![Next.js 14](https://img.shields.io/badge/Next.js-14-black)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-green)]()

> **Problem Statement ID: 26012** — AI-Enabled Automated Cadastral Mapping and Urban Parcel Boundary Extraction using Drone/Satellite Imagery

**Team INFERICS** | **SIH 2026** | **Software Category**

---

## 🔍 What It Does

Given satellite/aerial imagery, GeoGovGadget 2.0 automatically:

1. **Detects building rooftops** using classical computer vision (CLAHE + Otsu + adaptive thresholding + Canny edge detection)
2. **Extracts roof boundary polygons** as GeoJSON — just the building footprints, no vegetation or green layouts
3. **Generates GIS-ready land lot layouts** with bounding boxes, rotation angles, and area metadata
4. **Crops individual buildings** for further inspection
5. **Serves results through a Next.js plugin** that drops into any existing web app

### Why This Matters

Traditional cadastral mapping requires months of manual field surveys. This pipeline reduces that to minutes by automatically extracting building parcel boundaries from satellite imagery — directly supporting SVAMITVA and DILRMP digitization goals.

---

## 🏗️ Architecture

```
GeoGovGadget 2.0/
├── geo_gov_detector.py        # Main dual-mode detector (RAW + PLOTTED)
├── detect_buildings.py        # Original grayscale + color fallback detector
├── extract_roof_boundaries.py # Batch roof-only boundary extractor
├── generate_test_image.py     # Synthetic test image generator
├── web-plugin/                # Next.js plugin for web integration
│   ├── api/roof-detect.js     # API route handler
│   ├── components/RoofBoundaryOverlay.jsx
│   ├── lib/geogov-client.js   # Client library
│   └── package.json
├── requirements.txt           # Python dependencies
├── PROJECT_LOG.txt            # 15+ bugs fixed, lessons learned
├── README.md                  # You are here
└── storage/venv/              # Python venv (opencv-python + numpy)
```

### Detection Pipeline

```
Satellite Image
    ↓
[Auto-Detect Type]
├── mean_v > 220 & std_v < 25 → PLOTTED
├── green_ratio > 0.30 & std_v < 30 → PLOTTED
└── else → RAW
    ↓
RAW Pipeline:
  CLAHE → Gaussian Blur → Otsu Threshold
    ↓
[white_ratio > 50%? → try inverted / adaptive / Canny / image inversion]
    ↓
Morphological Close/Open → Contour Extraction
    ↓
[Filter: min_area=300, max_area=30% image, solidity > 0.3, vertices >= 4]
    ↓
Convex Hull + approxPolyDP → Building Polygons → GeoJSON
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.14+
- OpenCV 5.0+ (in `/mnt/c/PROJECTS/storage/venv/`)
- For web plugin: Node.js 18+, Next.js 14+

### Environment Setup

```bash
# Activate the venv (already has opencv-python + numpy)
source /mnt/c/PROJECTS/storage/venv/bin/activate
# OR use direct path
/mnt/c/PROJECTS/storage/venv/bin/python3

# Verify
python3 -c "import cv2; print(cv2.__version__)"
```

### Detect Buildings in a Single Image

```bash
# Auto-detect (recommended)
python3 geo_gov_detector.py --input image.jpg --output ./output --debug

# Force RAW satellite mode
python3 geo_gov_detector.py --input image.jpg --type raw -o ./output

# Force PLOTTED map mode  
python3 geo_gov_detector.py --input image.jpg --type plotted -o ./output
```

### Batch Process All Images (Roof Boundaries Only)

```bash
# Process all images in a directory
python3 extract_roof_boundaries.py \
  --input-dir /mnt/c/PROJECTS/IMAGES/RAW/ \
  --output-dir ./output_roofs \
  --debug
```

### Web Plugin Integration

Drop the `web-plugin/` folder into any Next.js project:

```bash
# Copy into your Next.js project
cp -r geogov-gadget-2.0/web-plugin/pages/api/ ./pages/api/
cp -r geogov-gadget-2.0/web-plugin/components/ ./components/
cp -r geogov-gadget-2.0/web-plugin/lib/ ./lib/

# Use in a page
import { detectRoofs } from '../lib/geogov-client';
```

---

## 📊 Processing Results

| Dataset | Images | Buildings Detected |
|---------|--------|--------------------|
| RAW Satellite | 10 | 207 |
| EXAMPLE (WhatsApp forwards) | 29 | 531 |
| **Total** | **39** | **738** |

### Per-Image Breakdown (RAW)

| Image | Buildings | Type |
|-------|-----------|------|
| annexure and m,n block.jpg | 6 | RAW |
| arch right side hostels.jpg | 21 | RAW |
| bel block and canteen.png | 33 | RAW |
| law school.png | 41 | RAW |
| main eee block entrance area.jpg | 16 | RAW |
| srm dental.jpg | 23 | RAW |
| srm global.jpg | 11 | RAW |
| srm medical.jpg | 23 | RAW |
| tech 1,2 audi.png | 15 | RAW |
| ubi and valli gate.png | 18 | RAW |

### Output Files (per image)

| File | Description |
|------|-------------|
| `roof_boundaries.png` | Original image with green roof outlines + red IDs |
| `roofs.geojson` | Building polygons as GeoJSON FeatureCollection |
| `debug_mask.png` | Binary segmentation mask (debug) |
| `debug_segmentation_mask.png` | Intermediate threshold result (debug) |
| `crops/building_NNNN_WxH.png` | Individual building crops |
| `crops/manifest.json` | Metadata for each crop |
| `metadata.json` | Full processing metadata |

---

## 🐛 Bugs Fixed (15 total)

Full details in `PROJECT_LOG.txt`. Summary:

1. `fillPoly` alpha kwarg unsupported in OpenCV 5.0 → use `addWeighted`
2. `cvcv` typo → fixed to `cv2`
3. Index error on approx array → `reshape((-1, 2))`
4. Over-segmentation with adaptive threshold → white_ratio check + fallback
5. Color mask noise → filter by min_area + area bounds
6. Giant background contour → max_contour_area = 30% of image
7. Per-pixel noise in test images → block-based noise (50x50 blocks)
8. Wrong threshold direction → try both binary and inverted
9. Bitwise NOT on grayscale → proper HSV operations
10. Auto-detection misclassifying PLOTTED as RAW → green_pct tuning
11. Overpass API timeout → switched to local satellite imagery
12. `ret` variable unused → renamed to `otsu_ret`
13. False positive vegetation pickups → HSV green exclusion (fix approach documented)
14. Over-counting on dense urban → min dimension check (approach documented)
15. Composite image spatial overlap → stack with gaps (approach documented)

---

## ⚠️ Known Limitations

- **Vegetation false positives**: Large tree canopies/parks can be detected as buildings. Fix: add HSV-based green exclusion before thresholding
- **Low-contrast images**: Very dark or overexposed images may need Canny/inversion fallback
- **No georeferencing**: GeoJSON coordinates are pixel-space, not real-world GPS
- **No confidence scoring**: All detections treated equally
- **Classical CV only**: No deep learning segmentation (U-Net/Mask R-CNN yet)

### For Production / Hackathons

The SIH PPT proposes integrating TensorFlow U-Net/Mask R-CNN for production-grade accuracy. This classical CV prototype provides a working baseline with valid GeoJSON output.

---

## 🔌 API Usage

### POST `/api/roof-detect`

Upload a satellite image and receive building polygons + GeoJSON.

**Request:**
```
POST /api/geogov/roof-detect
Content-Type: multipart/form-data

image: <satellite_image_file>
```

**Response:**
```json
{
  "success": true,
  "detection_type": "raw",
  "buildings_detected": 41,
  "geojson": { "type": "FeatureCollection", "features": [...] },
  "annotated_image": "/tmp/geogov_output/layouts/annotated_result.png"
}
```

---

## 📁 Project Layout

```
opencv-GeoGovGadget-2.0/     # Working copy (template at opencv-GeoGovGadget/ is untouched)
├── Scripts/
│   ├── geo_gov_detector.py    # Dual-mode detector (active development)
│   ├── detect_buildings.py    # Original grayscale+color detector
│   └── extract_roof_boundaries.py  # Batch roof boundary extractor
├── web-plugin/
│   ├── api/roof-detect.js     # Next.js API route
│   ├── components/            # React components
│   ├── lib/geogov-client.js   # Client library
│   └── package.json           # Plugin manifest
├── IMAGES/                    # Input datasets
│   ├── RAW/                   # 10 satellite photos
│   ├── PLOTTED/               # 10 map-style images
│   └── EXAMPLE/               # 29 WhatsApp forwards + dataset images
├── output_*/                  # Generated results (per-image)
│   ├── roof_boundaries.png    # Roof outlines overlay
│   ├── roofs.geojson          # Building polygons
│   ├── crops/                 # Individual building crops
│   └── debug_mask.png         # Binary mask
├── requirements.txt           # opencv-python, numpy
├── PROJECT_LOG.txt            # Bug log + lessons learned
└── storage/venv/              # Python virtual environment
```

---

## 👥 Team INFERICS

- **SIH 2026**, Problem Statement 26012
- **Theme**: AI-automated geospatial property boundary mapping
- **Technologies**: Python, OpenCV, GDAL, TensorFlow/Keras, U-Net, Mask R-CNN, PostGIS, React/Next.js

### Members
- Pranjal Das — CV pipeline, Python backend, Next.js integration
- Hermes Agent — AI co-pilot, debugging, automation

---

## 📄 License

MIT — see [LICENSE](LICENSE) file.

Built for Smart India Hackathon 2026.
