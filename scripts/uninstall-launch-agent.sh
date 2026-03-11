#!/bin/zsh

set -euo pipefail

LABEL="com.donkeeman.vector"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST_PATH"

echo "Removed $LABEL"
