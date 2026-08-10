#!/usr/bin/env bash
# vps-deploy.sh — pull latest main and restart the PM2 workers on the VPS.
#
# This VPS runs the two background workers (chain-worker, workflow-worker)
# from ecosystem.config.js, NOT the Next.js app — the app is served by
# Vercel. Do not `pnpm build` or `pnpm start` here for that reason.
#
# Requires: the VPS's own read-only deploy key already added to the repo
# (see the setup steps in the PR/commit that introduced this script), and
# `origin` on this checkout pointed at the SSH host alias that uses it —
# `git remote -v` should show something like
# git@github-gigawork-vps:quicklyreviews/gigawork.git.
#
# Usage: bash scripts/vps-deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ fetching origin/main"
git fetch origin
git checkout main
git pull --ff-only origin main

echo "→ installing dependencies"
pnpm install --frozen-lockfile

echo "→ restarting PM2 workers"
pm2 restart ecosystem.config.js --update-env
pm2 save

echo "→ done. pm2 status:"
pm2 status
