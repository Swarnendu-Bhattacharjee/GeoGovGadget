#!/usr/bin/env python3
"""
Trains a U-Net (ImageNet-pretrained ResNet18 encoder) to segment cadastral
built-up parcels from satellite imagery.

This is the model the SIH pitch promises ("U-Net ... fine-tune on
region-specific imagery with transfer learning"), trained on the only real
labels this project has: the hand-drawn red parcel/footprint annotations in
`data/pranav images/satellite plotted building`, registered onto their RAW
captures by ml/building_detector/build_ground_truth.py.

Ten labelled sites is far too few to train a segmentation network from
scratch, which is why this uses a pretrained encoder and trains on random
256px crops with heavy augmentation — the deck's own stated mitigation for
"limited labeled training data for Indian-specific cadastral imagery".

Validation is by held-out SITE, never by random crops from a site that also
appears in training: neighbouring crops of one campus photo are so correlated
that a random-crop split would report a score the model hasn't earned.

Usage:
    python -m ml.building_detector.train_unet \\
        --data data/ground_truth --out ml/models --epochs 60
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# Held out from training entirely, so reported metrics come from sites the
# model has never seen. One densely-built site, one sparse.
VAL_SITES = ["law school", "bel block and canteen"]


# ---------------------------------------------------------------- model


class DecoderBlock(nn.Module):
    def __init__(self, in_ch: int, skip_ch: int, out_ch: int):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(in_ch + skip_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
        )

    def forward(self, x, skip=None):
        x = F.interpolate(x, scale_factor=2, mode="nearest")
        if skip is not None:
            x = torch.cat([x, skip], dim=1)
        return self.conv(x)


class ResNetUNet(nn.Module):
    """U-Net with an ImageNet-pretrained ResNet18 encoder."""

    def __init__(self, pretrained: bool = True):
        super().__init__()
        weights = torchvision.models.ResNet18_Weights.IMAGENET1K_V1 if pretrained else None
        enc = torchvision.models.resnet18(weights=weights)

        self.stem = nn.Sequential(enc.conv1, enc.bn1, enc.relu)  # 64ch,  /2
        self.pool = enc.maxpool
        self.layer1 = enc.layer1                                  # 64ch,  /4
        self.layer2 = enc.layer2                                  # 128ch, /8
        self.layer3 = enc.layer3                                  # 256ch, /16
        self.layer4 = enc.layer4                                  # 512ch, /32

        self.dec4 = DecoderBlock(512, 256, 256)
        self.dec3 = DecoderBlock(256, 128, 128)
        self.dec2 = DecoderBlock(128, 64, 64)
        self.dec1 = DecoderBlock(64, 64, 32)
        self.head = nn.Sequential(
            nn.Conv2d(32, 16, 3, padding=1, bias=False),
            nn.BatchNorm2d(16),
            nn.ReLU(inplace=True),
            nn.Conv2d(16, 1, 1),
        )

    def forward(self, x):
        s0 = self.stem(x)          # /2   64
        s1 = self.layer1(self.pool(s0))  # /4   64
        s2 = self.layer2(s1)       # /8   128
        s3 = self.layer3(s2)       # /16  256
        s4 = self.layer4(s3)       # /32  512

        d = self.dec4(s4, s3)
        d = self.dec3(d, s2)
        d = self.dec2(d, s1)
        d = self.dec1(d, s0)
        d = F.interpolate(d, scale_factor=2, mode="bilinear", align_corners=False)
        return self.head(d)


# ---------------------------------------------------------------- data


def load_sites(data_dir: Path):
    sites = {}
    for site_dir in sorted(p for p in data_dir.iterdir() if p.is_dir()):
        img_p, mask_p = site_dir / "image.jpg", site_dir / "mask.png"
        if not (img_p.exists() and mask_p.exists()):
            continue
        img = cv2.cvtColor(cv2.imread(str(img_p)), cv2.COLOR_BGR2RGB)
        mask = (cv2.imread(str(mask_p), cv2.IMREAD_GRAYSCALE) > 127).astype(np.uint8)
        sites[site_dir.name] = (img, mask)
    return sites


def augment(img: np.ndarray, mask: np.ndarray, rng: random.Random):
    if rng.random() < 0.5:
        img, mask = img[:, ::-1], mask[:, ::-1]
    if rng.random() < 0.5:
        img, mask = img[::-1], mask[::-1]
    k = rng.randint(0, 3)
    if k:
        img, mask = np.rot90(img, k), np.rot90(mask, k)

    img = img.astype(np.float32)
    if rng.random() < 0.8:  # brightness / contrast / per-channel colour jitter
        img *= rng.uniform(0.75, 1.3)
        img = (img - img.mean()) * rng.uniform(0.8, 1.25) + img.mean()
        img *= np.array([rng.uniform(0.92, 1.08) for _ in range(3)], dtype=np.float32)
    return np.ascontiguousarray(img).clip(0, 255), np.ascontiguousarray(mask)


def sample_crop(img, mask, size, rng: random.Random):
    """Random scale-jittered crop, resized to `size`."""
    h, w = mask.shape
    scale = rng.uniform(0.7, 1.6)
    crop = int(min(h, w, max(64, size * scale)))
    y = rng.randint(0, max(0, h - crop))
    x = rng.randint(0, max(0, w - crop))
    ic = img[y:y + crop, x:x + crop]
    mc = mask[y:y + crop, x:x + crop]
    if ic.shape[0] != size or ic.shape[1] != size:
        ic = cv2.resize(ic, (size, size), interpolation=cv2.INTER_LINEAR)
        mc = cv2.resize(mc, (size, size), interpolation=cv2.INTER_NEAREST)
    return ic, mc


def to_tensor(img: np.ndarray) -> torch.Tensor:
    x = img.astype(np.float32) / 255.0
    x = (x - IMAGENET_MEAN) / IMAGENET_STD
    return torch.from_numpy(x.transpose(2, 0, 1))


def make_batch(sites, names, size, batch, rng):
    xs, ys = [], []
    for _ in range(batch):
        img, mask = sites[rng.choice(names)]
        ic, mc = sample_crop(img, mask, size, rng)
        ic, mc = augment(ic, mc, rng)
        xs.append(to_tensor(ic))
        ys.append(torch.from_numpy(mc.astype(np.float32))[None])
    return torch.stack(xs), torch.stack(ys)


# ------------------------------------------------------------ inference


def predict_full(model, img: np.ndarray, device, tile: int = 512, overlap: int = 128) -> np.ndarray:
    """Sliding-window inference over a full-resolution image -> probability map."""
    model.eval()
    h, w = img.shape[:2]
    pad_h = (32 - h % 32) % 32
    pad_w = (32 - w % 32) % 32
    padded = cv2.copyMakeBorder(img, 0, pad_h, 0, pad_w, cv2.BORDER_REFLECT)
    ph, pw = padded.shape[:2]

    prob = np.zeros((ph, pw), np.float32)
    count = np.zeros((ph, pw), np.float32)
    step = max(32, tile - overlap)

    with torch.no_grad():
        for y in range(0, max(1, ph - tile + 1), step):
            for x in range(0, max(1, pw - tile + 1), step):
                y2, x2 = min(y + tile, ph), min(x + tile, pw)
                patch = padded[y:y2, x:x2]
                t = to_tensor(patch)[None].to(device)
                out = torch.sigmoid(model(t))[0, 0].cpu().numpy()
                prob[y:y2, x:x2] += out[: y2 - y, : x2 - x]
                count[y:y2, x:x2] += 1

    count[count == 0] = 1
    return (prob / count)[:h, :w]


def score(pred_bin: np.ndarray, truth: np.ndarray) -> dict:
    tp = float(np.logical_and(pred_bin, truth).sum())
    fp = float(np.logical_and(pred_bin, ~truth.astype(bool)).sum())
    fn = float(np.logical_and(~pred_bin.astype(bool), truth).sum())
    iou = tp / (tp + fp + fn) if (tp + fp + fn) else 0.0
    prec = tp / (tp + fp) if (tp + fp) else 0.0
    rec = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
    return {"iou": iou, "precision": prec, "recall": rec, "f1": f1}


def evaluate(model, sites, names, device) -> dict:
    per_site, agg = {}, []
    for n in names:
        img, mask = sites[n]
        prob = predict_full(model, img, device)
        m = score(prob > 0.5, mask)
        per_site[n] = {k: round(v, 4) for k, v in m.items()}
        agg.append(m)
    mean = {k: round(float(np.mean([a[k] for a in agg])), 4) for k in ["iou", "precision", "recall", "f1"]}
    return {"mean": mean, "per_site": per_site}


# ---------------------------------------------------------------- train


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default="data/ground_truth")
    ap.add_argument("--out", default="ml/models")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--steps-per-epoch", type=int, default=40)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--crop", type=int, default=256)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--seed", type=int, default=1337)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    sites = load_sites(Path(args.data))
    val_names = [n for n in VAL_SITES if n in sites]
    train_names = [n for n in sites if n not in val_names]
    print(f"device={device}  train sites={len(train_names)}  val sites={val_names}")

    model = ResNetUNet(pretrained=True).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)
    bce = nn.BCEWithLogitsLoss()

    best_iou, history = -1.0, []
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        model.train()
        losses = []
        for _ in range(args.steps_per_epoch):
            x, y = make_batch(sites, train_names, args.crop, args.batch, rng)
            x, y = x.to(device), y.to(device)
            logits = model(x)
            probs = torch.sigmoid(logits)
            inter = (probs * y).sum((1, 2, 3))
            dice = 1 - ((2 * inter + 1) / (probs.sum((1, 2, 3)) + y.sum((1, 2, 3)) + 1)).mean()
            loss = bce(logits, y) + dice
            opt.zero_grad()
            loss.backward()
            opt.step()
            losses.append(loss.item())
        sched.step()

        if epoch % 5 == 0 or epoch == args.epochs:
            ev = evaluate(model, sites, val_names, device)
            m = ev["mean"]
            history.append({"epoch": epoch, "loss": round(float(np.mean(losses)), 4), **m})
            print(f"epoch {epoch:3d}  loss={np.mean(losses):.4f}  "
                  f"val IoU={m['iou']:.4f}  P={m['precision']:.4f}  R={m['recall']:.4f}  F1={m['f1']:.4f}")
            if m["iou"] > best_iou:
                best_iou = m["iou"]
                torch.save({"state_dict": model.state_dict(), "val": ev, "epoch": epoch},
                           out_dir / "unet_parcel.pt")
        else:
            print(f"epoch {epoch:3d}  loss={np.mean(losses):.4f}")

    ckpt = torch.load(out_dir / "unet_parcel.pt", map_location=device, weights_only=False)
    report = {
        "model": "U-Net (ResNet18 ImageNet encoder)",
        "trained_on": train_names,
        "validated_on": val_names,
        "best_epoch": ckpt["epoch"],
        "metrics": ckpt["val"],
        "history": history,
        "params_millions": round(sum(p.numel() for p in model.parameters()) / 1e6, 2),
    }
    (out_dir / "unet_parcel_metrics.json").write_text(json.dumps(report, indent=2))
    print(f"\nbest val IoU={best_iou:.4f} (epoch {ckpt['epoch']}) -> {out_dir/'unet_parcel.pt'}")


if __name__ == "__main__":
    main()
