#!/usr/bin/env bash
# Build the landing page and the console into ONE static bundle.
#
#   dist/            <- Next.js static export (the marketing site)
#   dist/console/    <- the Vite dashboard
#
# Both ship behind a single domain: / is the landing page, /console is the
# dashboard. Run from the repo root; Vercel invokes this as its buildCommand.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> installing web (console)"
npm --prefix web ci 2>/dev/null || npm --prefix web install

echo "==> installing frontend (landing)"
npm --prefix frontend ci 2>/dev/null || npm --prefix frontend install

# The console imports ../../convex/_generated, so it must build from the repo
# root where that directory exists. CONSOLE_BASE rewrites its asset URLs.
echo "==> building console -> web/dist"
CONSOLE_BASE=/console/ npm --prefix web run build

echo "==> building landing -> frontend/out"
npm --prefix frontend run build

echo "==> assembling dist/"
rm -rf dist
cp -R frontend/out dist
rm -rf dist/console
cp -R web/dist dist/console

echo "==> done"
find dist -maxdepth 2 -name "index.html" | sort
