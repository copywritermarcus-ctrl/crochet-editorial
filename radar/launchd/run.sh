#!/bin/bash
# Radar weekly run, invoked by launchd (co.crochet.radar).
#
# This wrapper exists for one reason: launchd's StandardOutPath does not expand
# dates, and the run log is meant to be one file per run date. Everything the
# job actually does is in `radar run`.
set -uo pipefail

RADAR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RADAR_DIR" || exit 1

LOG_DIR="$RADAR_DIR/data/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/radar-$(date +%Y-%m-%d).log"

NODE_BIN="${RADAR_NODE:-$(command -v node || echo /usr/local/bin/node)}"

{
  echo "=== radar run started $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  "$NODE_BIN" "$RADAR_DIR/dist/bin.js" run --since 8 --max-minutes 600
  status=$?
  echo "=== radar run finished $(date -u +%Y-%m-%dT%H:%M:%SZ), exit $status ==="
  exit $status
} >>"$LOG_FILE" 2>&1
