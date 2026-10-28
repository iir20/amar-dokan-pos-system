#!/bin/sh
# Phase 2 — uptime check for Amar Dokan POS.
# Usage: scripts/uptime-check.sh https://<your-service>/api/health
# Exit 0: app up AND database connected.
# Exit 1: app down, or app up but running on the disk-persisted fallback
#         (database down) — survivable, but not normal; alert on this.
# Prints the health body for the alerting tool to capture.
set -eu
URL="${1:-}"
if [ -z "$URL" ]; then
  echo "usage: $0 https://<your-service>/api/health" >&2
  exit 2
fi
BODY="$(curl -fsS --max-time 10 "$URL" || { echo "HEALTH_ENDPOINT_UNREACHABLE"; exit 1; })"
echo "$BODY"
case "$BODY" in
  *'"fallbackMode":"disk-persisted-fallback"'*)
    echo "WARNING: app is up but on disk-persisted fallback (database down)" >&2
    exit 1
    ;;
esac
exit 0
