#!/bin/zsh
# 把 scripts/icon.html 用无界面 Chrome 截成 512 图标，再缩一张 180 的给 iPhone 主屏幕
cd "${0:a:h}/.."
TMP=$(mktemp -d)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --user-data-dir="$TMP" --window-size=512,512 --force-device-scale-factor=1 \
  --screenshot=public/icon-512.png "file://$PWD/scripts/icon.html" >/dev/null 2>&1
sips -z 180 180 public/icon-512.png --out public/icon-180.png >/dev/null
file public/icon-512.png public/icon-180.png
