#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"

report_wpt="$ROOT/build/chromium_wpt/wpt_core_report.txt"
runtime_bin="$ROOT/build/chromium_runtime_matrix/chromium_engine_smoke_macos"
network_bin="$ROOT/build/chromium_network_features/chromium_network_features_smoke_macos"
security_bin="$ROOT/build/chromium_security/chromium_security_smoke_macos"
perf_bin="$ROOT/build/chromium_perf/chromium_perf_smoke_macos"

for f in "$report_wpt" "$runtime_bin" "$network_bin" "$security_bin" "$perf_bin"; do
  if [ ! -e "$f" ]; then
    echo "[verify-r2c-chromium-equivalence-full] missing artifact: $f" >&2
    echo "[verify-r2c-chromium-equivalence-full] run verify_chromium_production_closed_loop.sh first" >&2
    exit 1
  fi
done

project_name="$(basename "${R2C_REAL_PROJECT:-/Users/lbcheng/UniMaker/ClaudeDesign}")"
project_slug="$(printf '%s' "$project_name" | sed 's/[^A-Za-z0-9._-]/_/g')"
real_out="${R2C_REAL_OUT:-$ROOT/build/r2c_real_project_closed_loop/$project_slug}"
real_report="$real_out/r2capp/r2capp_compile_report.json"
real_wpt="$real_out/r2capp/r2capp_wpt_core_report.json"
real_states="$real_out/r2capp/r2c_fullroute_states.json"
real_matrix="$real_out/r2capp/r2c_fullroute_event_matrix.json"
real_cov="$real_out/r2capp/r2c_fullroute_coverage_report.json"

for f in "$real_report" "$real_wpt" "$real_states" "$real_matrix" "$real_cov"; do
  if [ ! -f "$f" ]; then
    echo "[verify-r2c-chromium-equivalence-full] missing r2c artifact: $f" >&2
    echo "[verify-r2c-chromium-equivalence-full] run verify_r2c_real_project_closed_loop.sh first" >&2
    exit 1
  fi
done

python3 - "$report_wpt" "$real_wpt" "$real_report" "$real_states" "$real_matrix" "$real_cov" <<'PY'
import json
import re
import sys

chromium_wpt_path, r2c_wpt_path, r2c_report_path, states_path, matrix_path, coverage_path = sys.argv[1:7]

text = open(chromium_wpt_path, "r", encoding="utf-8").read()
match = re.search(r"pass_rate=([0-9]+(?:\.[0-9]+)?)", text)
if not match:
    print("[verify-r2c-chromium-equivalence-full] missing pass_rate in WPT report", file=sys.stderr)
    sys.exit(1)
rate = float(match.group(1))
if rate < 90.0:
    print(f"[verify-r2c-chromium-equivalence-full] WPT rate below threshold: {rate}", file=sys.stderr)
    sys.exit(1)

r2c_wpt = json.load(open(r2c_wpt_path, "r", encoding="utf-8"))
r2c_rate = float(r2c_wpt.get("pass_rate", 0.0))
if r2c_rate < 90.0:
    print(f"[verify-r2c-chromium-equivalence-full] r2c pass_rate below threshold: {r2c_rate}", file=sys.stderr)
    sys.exit(1)

report = json.load(open(r2c_report_path, "r", encoding="utf-8"))
if report.get("generated_ui_mode") != "ir-driven":
    print("[verify-r2c-chromium-equivalence-full] generated_ui_mode != ir-driven", file=sys.stderr)
    sys.exit(1)
if report.get("pixel_tolerance") != 0:
    print("[verify-r2c-chromium-equivalence-full] pixel_tolerance != 0", file=sys.stderr)
    sys.exit(1)
if report.get("replay_profile") != "claude-fullroute":
    print("[verify-r2c-chromium-equivalence-full] replay_profile mismatch", file=sys.stderr)
    sys.exit(1)
if not bool(report.get("strict_no_fallback", False)):
    print("[verify-r2c-chromium-equivalence-full] strict_no_fallback != true", file=sys.stderr)
    sys.exit(1)
if bool(report.get("used_fallback", True)):
    print("[verify-r2c-chromium-equivalence-full] used_fallback != false", file=sys.stderr)
    sys.exit(1)
if int(report.get("compiler_rc", -1)) != 0:
    print("[verify-r2c-chromium-equivalence-full] compiler_rc != 0", file=sys.stderr)
    sys.exit(1)

states_doc = json.load(open(states_path, "r", encoding="utf-8"))
matrix_doc = json.load(open(matrix_path, "r", encoding="utf-8"))
coverage_doc = json.load(open(coverage_path, "r", encoding="utf-8"))
states = states_doc.get("states", [])
matrix = matrix_doc.get("states", [])
if len(states) < 30:
    print(f"[verify-r2c-chromium-equivalence-full] fullroute states too small: {len(states)}", file=sys.stderr)
    sys.exit(1)
if len(matrix) != len(states):
    print("[verify-r2c-chromium-equivalence-full] event matrix count mismatch", file=sys.stderr)
    sys.exit(1)
if int(coverage_doc.get("routes_required", -1)) != len(states):
    print("[verify-r2c-chromium-equivalence-full] coverage routes_required mismatch", file=sys.stderr)
    sys.exit(1)
PY

"$ROOT/scripts/verify_r2c_wpt_core.sh"
echo "[verify-r2c-strict] no-fallback=true"
echo "[verify-r2c-strict] compiler-rc=0"
echo "[verify-r2c-chromium-equivalence-full] ok"
