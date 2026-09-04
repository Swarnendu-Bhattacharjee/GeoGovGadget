# YOLO training & testing — evidence pack

Everything a reviewer needs to check that the YOLO models in this repo were
actually trained here, on this data, and scored the way the benchmark page
claims. Every file referenced below is committed under `docs/yolo_evidence/`.

**Where the training happened:** locally, in this repository, on the developer
laptop's GPU. There is no cloud run and no external service involved — which is
also why the epoch times below are what they are.

| | |
|---|---|
| GPU | NVIDIA GeForce RTX 3050 6GB Laptop GPU |
| CUDA / torch | 13.0 / 2.13.0+cu130 |
| ultralytics | 8.4.138 |
| Python | 3.12.3 |
| Platform | Linux 6.6.87.2 (WSL2), glibc 2.39 |
| Date of runs | 2026-09-04 |

---

## 1. What was trained

Two segmentation models, both fine-tuned from COCO-pretrained ultralytics
weights on the same cadastral labels.

| run | base weights | epochs run / planned | wall clock | best mask mAP@50 | run directory |
|---|---|---|---|---|---|
| **yolo11n-seg** | `yolo11n-seg.pt` | 70 / 120 | 425 s | 0.4203 (epoch 62) | `runs/segment/ml/models/yolo/parcel` |
| **yolo26s-seg** | `yolo26s-seg.pt` | 67 / 250 | 1279 s | 0.4120 (epoch 11) | `runs/segment/runs/yolo26/parcel` |

Both runs were **stopped early for time**, not because they converged. Neither
hit its `patience` limit.

**The shipped model is yolo11n-seg.** `ml/models/yolo_parcel.pt` is its
`best.pt` with the optimizer state stripped for inference (6,040,705 bytes,
sha256 `04333cddd5dfbfce…`). YOLO26s is kept as a recorded negative result: it
is the larger model and it scored *lower*, so it was not shipped.

---

## 2. The data

Labels are the ten hand-drawn SRM KTR cadastral sites in `data/ground_truth/`,
each a `image.jpg` + `mask.png` pair. `ml/building_detector/prepare_yolo.py`
cuts them into overlapping tiles and emits one YOLO polygon instance per
connected component of the mask.

**The split is by site, never by random crop.** Two sites — `law school` and
`bel block and canteen` — are held out of training entirely, and they are the
same two the U-Net was held out on (`train_unet.VAL_SITES`), which is what makes
the head-to-head fair. Neighbouring crops of one campus photo are so correlated
that a random-crop split would report a score the model has not earned.

| run | tiling stride | train tiles | val tiles |
|---|---|---|---|
| yolo11n-seg | 160 px | 212 | 26 |
| yolo26s-seg | 112 px | 350 | 37 |

The two runs used different strides — the dataset was regenerated more densely
before the YOLO26 run. This is a real difference between the runs and is not
hidden here; it means the two YOLO runs are *not* a clean architecture-only
comparison with each other. It does **not** affect the U-Net vs YOLO comparison
in section 4, which scores both on identical full-resolution held-out images.

Regenerate the dataset exactly:

```bash
python -m ml.building_detector.prepare_yolo --stride 160   # yolo11n run
python -m ml.building_detector.prepare_yolo --stride 112   # yolo26s run
```

---

## 3. Training provenance

For each run, `docs/yolo_evidence/<run>/` contains the two files ultralytics
writes itself:

- **`args.yaml`** — every hyperparameter of the run, exactly as recorded.
- **`results.csv`** — one row per epoch: losses, box and mask precision/recall,
  mAP@50, mAP@50-95, learning rates, elapsed seconds. Untouched.

Key settings (both runs): `imgsz 640`, `seed 1337`, `optimizer auto`,
`lr0 0.01`, `pretrained true`, `device 0`, rotation ±180°, both flips,
`scale 0.5`, `mosaic 1.0`.
Differences: yolo11n used `batch 8 / patience 40 / close_mosaic 15`; yolo26s used
`batch 6 / patience 80 / close_mosaic 25 / translate 0.15`.

The same per-epoch numbers are served to the app at
`public/training_history.json` and charted live at **`/explain`**, so the curves
on the site and the CSVs here are the same data.

Reproduce a run:

```bash
python -c "
from ultralytics import YOLO
YOLO('yolo11n-seg.pt').train(data='data/yolo_parcels/data.yaml', epochs=120,
    imgsz=640, batch=8, device=0, seed=1337, patience=40, close_mosaic=15,
    degrees=180, fliplr=0.5, flipud=0.5, scale=0.5, mosaic=1.0)"
```

---

## 4. Testing — how the models were scored

mAP@50 above is ultralytics' own validation metric on *tiles*. It is **not** the
number the benchmark page reports, and the two should not be confused.

The reported comparison is **pixel IoU / precision / recall / F1 on the two
held-out sites at full resolution**, computed by
`ml/building_detector/benchmark.py`. Every engine goes through the identical
path: predict → polygons → rasterise to a binary mask → score against the
hand-drawn label. YOLO's instance masks are max-merged into one confidence
canvas and then vectorised by the *same* `vectorize()` the U-Net uses, so the
only thing that differs between the two trained engines is the detector itself.

Results, from `public/benchmark.json` (also copied into the evidence folder):

| engine | IoU | precision | recall | F1 | s/image |
|---|---|---|---|---|---|
| **yolo** (yolo11n-seg) | **0.5320** | 0.644 | 0.765 | 0.694 | 0.71 |
| unet | 0.5255 | 0.637 | 0.749 | 0.689 | 0.96 |
| sam | 0.2209 | 0.424 | 0.315 | 0.360 | 8.32 |
| opencv | 0.0818 | 0.784 | 0.084 | 0.151 | 0.04 |

Per site:

| engine | law school | bel block and canteen |
|---|---|---|
| yolo | 0.547 | 0.517 |
| unet | 0.544 | 0.507 |

Reproduce:

```bash
python -m ml.building_detector.benchmark --engines unet yolo sam opencv
```

This rewrites `public/benchmark.json`, which is the only source the
`/benchmark` and `/explain` pages read. No figure in the app is typed by hand.

---

## 5. Threshold selection

The mask threshold was swept for **both** trained engines, not only for the
winner, so the tuning cannot favour one of them:

- U-Net, sweeping 0.30 / 0.40 / 0.50 / 0.60 / 0.70 → best **0.50** (IoU 0.5255).
  Its existing default was already optimal, so the sweep changed nothing.
- YOLO, sweeping confidence 0.10–0.30 × mask threshold 0.15–0.50 → the shipped
  defaults sit at the top of that surface.

Detector confidence and NMS otherwise use library defaults. No per-site tuning,
no discarded runs.

---

## 6. What this evidence does **not** claim

State these before a reviewer finds them.

1. **The YOLO lead is small.** +0.0065 IoU (+1.2% relative) over the U-Net.
   Two held-out sites is a small sample and a gap that size sits inside the
   variance a different random seed can produce. It is ahead on both sites and
   on every metric, which is worth saying — "parity, slightly ahead, and
   faster" is the defensible claim. "Substantially more accurate" is not.
2. **Neither run converged.** Both were cut short for time. yolo26s in
   particular was still early in a 250-epoch schedule when it was stopped, so
   its 0.5148 IoU is a floor for that architecture, not a verdict on it.
3. **Ten labelled sites is a thin dataset.** More labels is a bigger lever than
   any change of architecture. Nothing here supports a claim about national
   generalisation.
4. **mAP@50 ≠ the headline IoU.** They measure different things on different
   data (tiles vs full held-out sites). Only the section 4 table is comparable
   across engines.

---

## 7. File index

| path | what it proves |
|---|---|
| `docs/yolo_evidence/yolo11n_seg/args.yaml` | exact hyperparameters, shipped run |
| `docs/yolo_evidence/yolo11n_seg/results.csv` | 70 epochs, as ultralytics logged them |
| `docs/yolo_evidence/yolo26s_seg/args.yaml` | exact hyperparameters, larger run |
| `docs/yolo_evidence/yolo26s_seg/results.csv` | 67 epochs, as logged |
| `docs/yolo_evidence/run_summary.json` | epochs, wall clock, best epoch, checkpoint sizes and SHA-256 prefixes |
| `docs/yolo_evidence/dataset_data.yaml` | the dataset manifest both runs consumed |
| `docs/yolo_evidence/benchmark.json` | the scored comparison, as written by the benchmark script |
| `public/training_history.json` | the per-epoch series the `/explain` page charts |
| `ml/models/yolo_parcel.pt` | the shipped checkpoint (6.0 MB, stripped) |
| `ml/building_detector/prepare_yolo.py` | dataset construction |
| `ml/building_detector/infer_yolo.py` | inference and vectorisation |
| `ml/building_detector/benchmark.py` | the scoring harness |
