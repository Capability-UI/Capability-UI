#!/usr/bin/env bash
# Idempotent Cloud Agent setup for Capability UI.
# Runs after the repository is checked out. Safe to run repeatedly.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== Capability UI core =="
npm install
npm run build

echo "== Examples =="
npm install --prefix examples

# The marketing site lives in a sibling repository (github.com/Capability-UI/Website)
# and depends on this package via file:../Capability-UI. Install and build it only
# when it is checked out next to this repo so setup stays valid without it.
SITE_DIR="$(cd "$ROOT/.." && pwd)/Website"
if [ -d "$SITE_DIR" ]; then
  echo "== Marketing site ($SITE_DIR) =="
  ( cd "$SITE_DIR" && npm install && npm run build )
else
  echo "== Marketing site not present; skipping =="
  echo "   Clone github.com/Capability-UI/Website as a sibling of this repo to enable it."
fi

echo "== Setup complete =="
