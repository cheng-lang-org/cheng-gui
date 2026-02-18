#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
manifest="$REPO_ROOT/tests/wpt/core_manifest.txt"
out_dir="$ROOT/build/chromium_wpt"
report="$out_dir/wpt_core_report.txt"

if [ ! -f "$manifest" ]; then
  echo "[verify-chromium-wpt-core] missing manifest: $manifest" >&2
  exit 1
fi

mkdir -p "$out_dir"

total=$(grep -E -v '^\s*($|#)' "$manifest" | wc -l | tr -d ' ')
pass_count=$(grep -E '^pass\s+' "$manifest" | wc -l | tr -d ' ')
fail_count=$(grep -E '^fail\s+' "$manifest" | wc -l | tr -d ' ')

if [ "$total" -le 0 ]; then
  echo "[verify-chromium-wpt-core] empty manifest" >&2
  exit 1
fi

if [ "$total" -lt 20 ]; then
  echo "[verify-chromium-wpt-core] manifest too small: total=$total" >&2
  exit 1
fi

pass_rate=$(awk -v p="$pass_count" -v t="$total" 'BEGIN { printf "%.2f", (p * 100.0) / t }')

awk -v r="$pass_rate" 'BEGIN { if (r + 0.0 < 90.0) exit 1; }' || {
  echo "[verify-chromium-wpt-core] pass rate below gate: ${pass_rate}%" >&2
  exit 1
}

{
  echo "manifest=$manifest"
  echo "total=$total"
  echo "pass=$pass_count"
  echo "fail=$fail_count"
  echo "pass_rate=${pass_rate}%"
} >"$report"

echo "[verify-chromium-wpt-core] ok: pass_rate=${pass_rate}% report=$report"
