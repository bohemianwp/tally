#!/bin/zsh
# Phone-sized screenshots of the demo households (headless Chrome, nothing opens on screen).
# Usage: npm run demo && scripts/screenshots.sh      → docs/screenshots/{en,zh}-*.png
# Headless Chrome won't go narrower than 500px, so pages are 500 wide (a large phone), light theme.
cd "${0:a:h}/.."
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT=docs/screenshots; mkdir -p $OUT
TMP=$(mktemp -d)
FLAGS=(--headless=new --disable-gpu --hide-scrollbars --blink-settings=preferredColorScheme=1 --force-device-scale-factor=2 --virtual-time-budget=5000)
shoot() {  # url file height [lang]
  "$CH" $FLAGS --user-data-dir="$TMP/$2" --window-size=500,$3 ${4:+--lang=$4} --screenshot="$OUT/$2.png" "$1" >/dev/null 2>&1
  echo "$OUT/$2.png"
}
export TALLY_TODAY=${TALLY_TODAY:-2026-10-22}   # a fixed "today" late in a month, so every report has data (only works on demo databases)
node --no-warnings scripts/demo.js en >/dev/null && node --no-warnings scripts/demo.js zh >/dev/null
pids=()
for L in en zh; do
  P=$([ $L = en ] && echo 8811 || echo 8812)
  U=$([ $L = en ] && echo Alex || echo 大伟)
  TALLY_DB=data/demo-$L.db TALLY_DEMO_USER=$U PORT=$P node --no-warnings server.js >/dev/null 2>&1 & pids+=$!
  TALLY_DB=$TMP/empty-$L.db PORT=$((P+10)) node --no-warnings server.js >/dev/null 2>&1 & pids+=$!
done
sleep 1.5
for L in en zh; do
  P=$([ $L = en ] && echo 8811 || echo 8812)
  for t in home rec list month quarter year; do shoot "http://127.0.0.1:$P/#$t" $L-$t 1000; done
  shoot "http://127.0.0.1:$P/#me" $L-me 2000
done
shoot http://127.0.0.1:8821/ en-setup 1500 en-US   # setup screen: the browser language picks which shows first
shoot http://127.0.0.1:8822/ zh-setup 1500 zh-CN
kill $pids 2>/dev/null
rm -rf $TMP
