#!/bin/bash
# Install dependencies from plugin directory, then run server from project cwd
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
bun install --no-summary --cwd "$PLUGIN_DIR" 2>/dev/null
exec bun "$PLUGIN_DIR/channel/index.ts" "$@"
