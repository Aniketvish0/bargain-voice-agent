#!/usr/bin/env bash
# Build the landing page and both consoles into ONE static bundle.
#
#   dist/             <- Next.js static export: the marketing site AND /console
#   dist/dashboard/   <- the original Vite dashboard, kept as a fallback
#
# ⚠️ /console is now a NEXT.JS ROUTE (frontend/app/console/page.tsx), not the
# Vite build. This script used to `cp -R web/dist dist/console`, which would
# now silently overwrite the real console with the older one — same URL, no
# error, and you would only notice because direct dial and the voice picker
# had vanished. The Vite build moves to /dashboard instead of being deleted:
# it still works, and it is the fallback if the Next console misbehaves live.
#
# Run from the repo root; Vercel invokes this as its buildCommand.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The console's `tsc -b` follows its ../../convex imports and typechecks the
# whole Convex tree, which needs the ROOT dependencies (convex, @types/node).
# Without this the build dies on ~200 TS2307/TS7006 errors from convex/*.ts.
echo "==> installing root (convex types)"
npm ci 2>/dev/null || npm install

echo "==> installing web (console)"
npm --prefix web ci 2>/dev/null || npm --prefix web install

echo "==> installing frontend (landing)"
npm --prefix frontend ci 2>/dev/null || npm --prefix frontend install

# The console imports ../../convex/_generated, so it must build from the repo
# root where that directory exists. CONSOLE_BASE rewrites its asset URLs.
echo "==> building legacy dashboard -> web/dist"
CONSOLE_BASE=/dashboard/ npm --prefix web run build

echo "==> building landing -> frontend/out"
npm --prefix frontend run build

echo "==> assembling dist/"
rm -rf dist
cp -R frontend/out dist
# frontend/out already contains console/index.html — do not clobber it.
rm -rf dist/dashboard
cp -R web/dist dist/dashboard

echo "==> done"
find dist -maxdepth 2 -name "index.html" | sort
