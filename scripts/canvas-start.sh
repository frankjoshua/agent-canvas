#!/bin/bash
# canvas-start.sh — Start agent-canvas in dev mode (for use by agents)
#
# Usage: bash scripts/canvas-start.sh [--project /path/to/project]
#
# Finds a free port in 8765-8770, starts the canvas server in the
# background, verifies it's running, and prints the URL.
#
# If --project is not given, defaults to the current working directory.
set -euo pipefail

PROJECT_DIR="$(pwd)"
while [[ $# -gt 0 ]]; do
  case $1 in
    --project) PROJECT_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Resolve plugin directory (this script lives in <plugin>/scripts/)
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Find a free port
PORT=""
for p in 8765 8766 8767 8768 8769 8770; do
  if ! curl -s --max-time 0.3 "http://localhost:$p" >/dev/null 2>&1; then
    PORT=$p
    break
  fi
done

if [[ -z "$PORT" ]]; then
  echo "ERROR: No free port in 8765-8770 range" >&2
  exit 1
fi

# Install deps if needed
bun install --no-summary --cwd "$PLUGIN_DIR" 2>/dev/null

# Start in background
LOG="/tmp/canvas-${PORT}.log"
CANVAS_PORT=$PORT nohup bun "$PLUGIN_DIR/channel/index.ts" \
  --dev --project "$PROJECT_DIR" > "$LOG" 2>&1 &
CANVAS_PID=$!

# Wait briefly for startup
sleep 0.5

# Verify
if ! kill -0 "$CANVAS_PID" 2>/dev/null; then
  echo "ERROR: Canvas process died on startup. Log:" >&2
  cat "$LOG" >&2
  exit 1
fi

if ! curl -s --max-time 1 "http://localhost:$PORT" >/dev/null 2>&1; then
  echo "ERROR: Canvas started but not responding on port $PORT. Log:" >&2
  cat "$LOG" >&2
  exit 1
fi

# Build the Tailscale FQDN URL (works from any device on the tailnet)
FQDN=$(tailscale status --json 2>/dev/null | jq -r '.Self.DNSName' 2>/dev/null | sed 's/\.$//')
if [[ -n "$FQDN" && "$FQDN" != "null" ]]; then
  URL="http://${FQDN}:${PORT}"
else
  URL="http://localhost:${PORT}"
fi

echo "agent-canvas running at ${URL}"
echo "PID: $CANVAS_PID | Log: $LOG"
