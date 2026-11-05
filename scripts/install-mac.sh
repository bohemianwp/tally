#!/bin/zsh
# Makes Tally start by itself whenever you log in to this Mac (and restart if it ever crashes).
#   Install:    scripts/install-mac.sh
#   Uninstall:  scripts/install-mac.sh --uninstall      (your data in data/ is left alone)
set -e
cd "${0:a:h}/.."
DIR=$PWD
LABEL=com.tally.server
PLIST=~/Library/LaunchAgents/$LABEL.plist

if [[ "$1" == "--uninstall" ]]; then
  launchctl bootout gui/$(id -u)/$LABEL 2>/dev/null || true
  rm -f $PLIST
  echo "Tally will no longer start automatically. Your data is still in $DIR/data/"
  exit 0
fi

NODE=$(command -v node || true)
if [[ -z "$NODE" ]]; then
  echo "Node.js is not installed. Install it first (version 22.13 or newer):"
  echo "  • with Homebrew:  brew install node"
  echo "  • or download:    https://nodejs.org"
  exit 1
fi
V=$("$NODE" -p 'process.versions.node')
if ! "$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  echo "Your Node.js is $V — Tally needs 22.13 or newer (it uses Node's built-in SQLite). Update it, then run this again."
  exit 1
fi

mkdir -p data ~/Library/LaunchAgents
cat > $PLIST <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>--no-warnings</string><string>server.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$DIR/data/server.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/server.log</string>
</dict>
</plist>
EOF
launchctl bootout gui/$(id -u)/$LABEL 2>/dev/null || true
launchctl bootstrap gui/$(id -u) $PLIST
sleep 1
if curl -s -o /dev/null http://127.0.0.1:8787/api/setup; then
  echo "✓ Tally is running and will start by itself after every login."
  echo "  Open http://localhost:8787 on this Mac to set up your household."
  echo "  Phones: see “Use it on your phone” in README.md (Tailscale, about 5 minutes)."
else
  echo "Tally didn't answer yet. Check the log: $DIR/data/server.log"
fi
