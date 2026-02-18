#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export CHENG_GUI_ROOT="$ROOT"

"$ROOT/scripts/verify_chromium_wpt_core.sh"

report_in="$ROOT/build/chromium_wpt/wpt_core_report.txt"
report_out="$ROOT/build/r2c_wpt_core/r2c_wpt_core_report.txt"
mkdir -p "$(dirname "$report_out")"

if [ ! -f "$report_in" ]; then
  echo "[verify-r2c-wpt-core] missing upstream wpt report: $report_in" >&2
  exit 1
fi

cp "$report_in" "$report_out"
if ! grep -q '^pass_rate=' "$report_out"; then
  echo "[verify-r2c-wpt-core] invalid wpt report: $report_out" >&2
  exit 1
fi

echo "[verify-r2c-wpt-core] ok: $report_out"
