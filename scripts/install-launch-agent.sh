#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.donkeeman.vector"
TEMPLATE_PATH="$ROOT_DIR/ops/macos/$LABEL.plist.template"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_PATH="${NODE_PATH:-$(command -v node || true)}"

if [[ -z "$NODE_PATH" ]]; then
  echo "node executable not found. Set NODE_PATH or add node to PATH."
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

sed \
  -e "s|__NODE_PATH__|$NODE_PATH|g" \
  -e "s|__WORKDIR__|$ROOT_DIR|g" \
  -e "s|__HOME__|$HOME|g" \
  "$TEMPLATE_PATH" > "$PLIST_PATH"

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST_PATH"
launchctl kickstart -k "gui/$UID/$LABEL"

echo "Installed $LABEL"
echo "plist: $PLIST_PATH"
