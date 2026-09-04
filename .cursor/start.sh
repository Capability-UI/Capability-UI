#!/usr/bin/env bash
# Per-boot marketing site launcher for the combined marketing + live examples surface.
# Runs the sibling Website host when it is present, otherwise stays idle so the
# terminal remains available without failing the environment start.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_DIR="$(cd "$ROOT/.." && pwd)/Website"

if [ -d "$SITE_DIR" ]; then
  echo "Starting marketing site + /play examples on :4321"
  cd "$SITE_DIR"
  exec npm run serve
fi

echo "Website sibling not present; marketing site not started."
echo "Standalone example hosts still run on :8782-8784."
exec sleep infinity
