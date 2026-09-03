#!/usr/bin/env python3
"""
Exports the trained U-Net checkpoint to ONNX so the browser can run it.

Why this exists: app/api/detect/route.js shells out to ml/.venv/bin/python3
with torch + OpenCV. That works on a dev machine and dies on Vercel, whose
Node runtime has no Python at all (and where a torch install would blow past
the function size limit regardless). Rather than drop the model in production,
the same weights are exported once to ONNX and executed client-side by
onnxruntime-web — the numbers the /benchmark page reports stay honest because
it is literally the same network.

Height and width are dynamic axes: predict_full() feeds edge tiles that are
smaller than the 512px interior tile, and the JS port must be free to do the
same so its probability map matches this repo's Python output.

Usage:
    python -m ml.building_detector.export_onnx \\
        --checkpoint ml/models/unet_parcel.pt --out public/models/unet_parcel.onnx
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import torch

from ml.building_detector.train_unet import ResNetUNet


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--checkpoint", default="ml/models/unet_parcel.pt")
    ap.add_argument("--metrics", default="ml/models/unet_parcel_metrics.json")
    ap.add_argument("--out", default="public/models/unet_parcel.onnx")
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    model = ResNetUNet(pretrained=False)
    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model.load_state_dict(ckpt["state_dict"])
    model.eval()

    # Sigmoid is folded into the graph so the JS side receives probabilities
    # directly, exactly like predict_full() does before averaging tiles.
    class WithSigmoid(torch.nn.Module):
        def __init__(self, net):
            super().__init__()
            self.net = net

        def forward(self, x):
            return torch.sigmoid(self.net(x))

    wrapped = WithSigmoid(model).eval()
    dummy = torch.randn(1, 3, 512, 512)

    torch.onnx.export(
        wrapped,
        dummy,
        str(out_path),
        input_names=["input"],
        output_names=["prob"],
        opset_version=args.opset,
        dynamic_axes={
            "input": {2: "height", 3: "width"},
            "prob": {2: "height", 3: "width"},
        },
        do_constant_folding=True,
    )

    # torch's exporter spills weights into a sidecar .onnx.data by default.
    # onnxruntime-web would then need an extra externalData registration and a
    # second fetch, so collapse it back into one self-contained file.
    import onnx

    model_proto = onnx.load(str(out_path), load_external_data=True)
    onnx.save_model(model_proto, str(out_path), save_as_external_data=False)
    sidecar = out_path.with_suffix(out_path.suffix + ".data")
    sidecar.unlink(missing_ok=True)
    opsets = {i.domain or "ai.onnx": i.version for i in model_proto.opset_import}
    print(f"  single file, ir_version={model_proto.ir_version}, opsets={opsets}")

    # Parity check against the torch model, at the interior tile size and at a
    # smaller edge-tile size, since a mismatch there would only show up as a
    # seam along the right/bottom of a real upload.
    import onnxruntime as ort

    sess = ort.InferenceSession(str(out_path), providers=["CPUExecutionProvider"])
    worst = 0.0
    for h, w in [(512, 512), (256, 384)]:
        x = torch.randn(1, 3, h, w)
        with torch.no_grad():
            expected = wrapped(x).numpy()
        got = sess.run(["prob"], {"input": x.numpy()})[0]
        worst = max(worst, float(np.abs(expected - got).max()))
        print(f"  {h}x{w}: max|torch - onnx| = {np.abs(expected - got).max():.3e}")
    if worst > 1e-4:
        raise SystemExit(f"ONNX output diverges from torch (max diff {worst:.3e})")

    # The tool page shows the held-out validation metrics next to a result;
    # served from public/ so the browser path can report them without an API.
    metrics_src = Path(args.metrics)
    if metrics_src.exists():
        metrics_dst = out_path.parent / metrics_src.name
        shutil.copyfile(metrics_src, metrics_dst)
        summary = json.loads(metrics_src.read_text()).get("metrics", {}).get("mean", {})
        print(f"  metrics -> {metrics_dst}  {summary}")

    size_mb = out_path.stat().st_size / 1e6
    print(f"[DONE] {out_path} ({size_mb:.1f} MB), opset {args.opset}, parity ok")


if __name__ == "__main__":
    main()
