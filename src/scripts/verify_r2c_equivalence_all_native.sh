#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"

project="${R2C_REAL_PROJECT:-/Users/lbcheng/UniMaker/ClaudeDesign}"
entry="${R2C_REAL_ENTRY:-/app/main.tsx}"
out_dir="${R2C_EQ_ALL_OUT:-$ROOT/build/r2c_equivalence_all_native}"
android_fullroute="${CHENG_ANDROID_EQ_ENABLE_FULLROUTE:-1}"

while [ $# -gt 0 ]; do
  case "$1" in
    --project) project="${2:-}"; shift 2 ;;
    --entry) entry="${2:-}"; shift 2 ;;
    --out) out_dir="${2:-}"; shift 2 ;;
    --android-fullroute) android_fullroute="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Usage: verify_r2c_equivalence_all_native.sh [--project <abs>] [--entry </app/main.tsx>] [--out <abs>] [--android-fullroute 0|1]"
      exit 0
      ;;
    *) echo "[verify-r2c-all-native] unknown arg: $1" >&2; exit 2 ;;
  esac
done

case "$android_fullroute" in
  0|1) ;;
  *)
    echo "[verify-r2c-all-native] invalid --android-fullroute: $android_fullroute (expect 0 or 1)" >&2
    exit 2
    ;;
esac

mkdir -p "$out_dir"

echo "== all-native equivalence: android =="
android_cmd=(
  bash "$ROOT/scripts/verify_r2c_equivalence_android_native.sh"
  --project "$project"
  --entry "$entry"
  --out "$out_dir/android"
  --android-fullroute "$android_fullroute"
)
"${android_cmd[@]}"

echo "== all-native equivalence: ios =="
bash "$ROOT/scripts/verify_r2c_equivalence_ios_native.sh" --project "$project" --entry "$entry" --out "$out_dir/ios"

echo "== all-native equivalence: harmony =="
bash "$ROOT/scripts/verify_r2c_equivalence_harmony_native.sh" --project "$project" --entry "$entry" --out "$out_dir/harmony"

echo "[verify-r2c-all-native] ok"
