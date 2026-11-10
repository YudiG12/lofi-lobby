#!/usr/bin/env bash
# Renders the README images (banner and high-level design) to PNG at 2x with headless Chrome.
set -euo pipefail
cd "$(dirname "$0")/../docs/assets"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
shot() { # file width height out
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --virtual-time-budget=10000 --window-size="$2,$3" --screenshot="$PWD/$4" "file://$PWD/$1" >/dev/null 2>&1
}
shot banner.html 1282 366 banner.png
shot hld.html 1200 500 hld-light.png
echo "rendered: banner.png hld-light.png"
# low-level design map: generated SVG, then PNG
python3 ../architecture/draw.py >/dev/null
( cd ../architecture && "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --virtual-time-budget=10000 --window-size=1460,580 --screenshot="$PWD/v1.png" "file://$PWD/v1.svg" >/dev/null 2>&1 )
echo "rendered: architecture/v1.png"
