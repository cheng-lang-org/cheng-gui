#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"

project="${R2C_REAL_PROJECT:-/Users/lbcheng/UniMaker/ClaudeDesign}"
entry="${R2C_REAL_ENTRY:-/app/main.tsx}"
out_dir="${R2C_EQ_ANDROID_OUT:-$ROOT/build/r2c_equivalence_android_native}"
android_fullroute="${CHENG_ANDROID_EQ_ENABLE_FULLROUTE:-1}"

while [ $# -gt 0 ]; do
  case "$1" in
    --project) project="${2:-}"; shift 2 ;;
    --entry) entry="${2:-}"; shift 2 ;;
    --out) out_dir="${2:-}"; shift 2 ;;
    --android-fullroute) android_fullroute="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Usage: verify_r2c_equivalence_android_native.sh [--project <abs>] [--entry </app/main.tsx>] [--out <abs>] [--android-fullroute 0|1]"
      exit 0
      ;;
    *) echo "[verify-r2c-android-native] unknown arg: $1" >&2; exit 2 ;;
  esac
done

case "$android_fullroute" in
  0|1) ;;
  *)
    echo "[verify-r2c-android-native] invalid --android-fullroute: $android_fullroute (expect 0 or 1)" >&2
    exit 2
    ;;
esac

mkdir -p "$out_dir"

echo "== r2c native equivalence: android gate =="
if [ -z "${CHENG_ANDROID_1TO1_ENABLE_FULLROUTE+x}" ]; then
  export CHENG_ANDROID_1TO1_ENABLE_FULLROUTE="$android_fullroute"
fi
echo "[verify-r2c-android-native] android fullroute=${CHENG_ANDROID_1TO1_ENABLE_FULLROUTE}"
bash "$ROOT/scripts/verify_android_claude_1to1_gate.sh" --project "$project" --entry "$entry" --out "$out_dir"

report_json="$out_dir/claude_compile/r2capp/r2capp_compile_report.json"
if [ ! -f "$report_json" ]; then
  echo "[verify-r2c-android-native] missing report: $report_json" >&2
  exit 1
fi

python3 - "$report_json" <<'PY'
import json
import os
import sys

report_path = sys.argv[1]
data = json.load(open(report_path, "r", encoding="utf-8"))
for key in ("unsupported_syntax", "unsupported_imports", "degraded_features"):
    if len(data.get(key, []) or []) != 0:
        print(f"[verify-r2c-android-native] {key} must be 0", file=sys.stderr)
        sys.exit(1)
required_paths = [
    "react_ir_path",
    "hook_graph_path",
    "effect_plan_path",
    "third_party_rewrite_report_path",
    "truth_trace_manifest_android_path",
    "perf_summary_path",
]
for key in required_paths:
    p = str(data.get(key, "") or "")
    if not p or not os.path.isfile(p):
        print(f"[verify-r2c-android-native] missing {key}: {p}", file=sys.stderr)
        sys.exit(1)
print("[verify-r2c-android-native] report fields ok")
PY

echo "[verify-r2c-android-native] ok"
