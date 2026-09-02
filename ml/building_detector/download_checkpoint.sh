#!/usr/bin/env bash
# Downloads a pretrained Segment Anything (SAM) checkpoint into ml/models/.
# Default is vit_b (~375MB) — fits comfortably on a 6GB laptop GPU and is
# fast enough for a live demo. Pass "vit_l" or "vit_h" for a larger/more
# accurate model if you have the VRAM and don't need real-time inference.
set -euo pipefail

MODEL_TYPE="${1:-vit_b}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../models"
mkdir -p "$OUT_DIR"

case "$MODEL_TYPE" in
  vit_b)
    URL="https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
    ;;
  vit_l)
    URL="https://dl.fbaipublicfiles.com/segment_anything/sam_vit_l_0b3195.pth"
    ;;
  vit_h)
    URL="https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth"
    ;;
  *)
    echo "Unknown model type: $MODEL_TYPE (expected vit_b, vit_l, or vit_h)" >&2
    exit 1
    ;;
esac

OUT_FILE="$OUT_DIR/$(basename "$URL")"
if [ -f "$OUT_FILE" ]; then
  echo "Already downloaded: $OUT_FILE"
else
  echo "Downloading $MODEL_TYPE checkpoint to $OUT_FILE ..."
  curl -L --fail -o "$OUT_FILE" "$URL"
fi
echo "Done. Use --checkpoint $OUT_FILE --model-type $MODEL_TYPE"
