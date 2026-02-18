#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SRC_DEFAULT="/Users/lbcheng/UniMaker/ClaudeDesign"
SRC="${CHENG_CLAUDE_SOURCE:-$SRC_DEFAULT}"
DST="$ROOT/tests/claude_fixture"

strict=0
if [ "${1:-}" = "--strict" ]; then
  strict=1
fi

if [ ! -d "$SRC" ]; then
  if [ "$strict" -eq 1 ]; then
    echo "[sync-claude-fixture] missing source: $SRC" >&2
    exit 2
  fi
  echo "[sync-claude-fixture] skip: source not found: $SRC"
  exit 0
fi

mkdir -p "$DST"

if ! command -v rsync >/dev/null 2>&1; then
  echo "[sync-claude-fixture] missing rsync" >&2
  exit 2
fi

rsync -a --delete \
  --exclude '.DS_Store' \
  --exclude '.build/' \
  --exclude '.third_party/' \
  --exclude '.claude/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude 'android/' \
  --exclude 'ios/' \
  --exclude 'artifacts/' \
  --exclude 'package-lock.json' \
  --exclude 'scripts/' \
  --include 'index.html' \
  --include 'app/***' \
  --include 'styles/***' \
  --include 'package.json' \
  --include 'tsconfig.json' \
  --include 'tsconfig.node.json' \
  --include 'tailwind.config.js' \
  --include 'postcss.config.js' \
  --include 'vite.config.ts' \
  --include 'capacitor.config.ts' \
  --exclude '*' \
  "$SRC/" "$DST/"

echo "[sync-claude-fixture] ok: $DST"
