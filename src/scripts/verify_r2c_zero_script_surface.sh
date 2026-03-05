#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"

BIN_DIR="${CHENG_GUI_DISPATCHER_BIN_DIR:-$ROOT/bin}"
BIN_NAME="${CHENG_GUI_DISPATCHER_BIN_NAME:-cheng_gui_scripts}"
COMPILE_CMD="$BIN_DIR/r2c_compile_react_project"

ensure_native_cmd() {
  if [ -x "$COMPILE_CMD" ]; then
    return 0
  fi
  "$ROOT/scripts/build_script_dispatcher.sh" --out-dir "$BIN_DIR" --bin-name "$BIN_NAME" >/dev/null
  if [ ! -x "$COMPILE_CMD" ]; then
    echo "[verify-r2c-zero-script] missing native compile command: $COMPILE_CMD" >&2
    exit 1
  fi
}

fail=0
check_forbidden() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if rg -n "$pattern" "$file" >/tmp/verify_r2c_zero_script_hit.$$ 2>/dev/null; then
    echo "[verify-r2c-zero-script] forbidden $label in $file" >&2
    sed -n '1,20p' /tmp/verify_r2c_zero_script_hit.$$ >&2 || true
    fail=1
  fi
  rm -f /tmp/verify_r2c_zero_script_hit.$$ || true
}

check_absent() {
  local pattern="$1"
  local scope="$2"
  if rg -n "$pattern" $scope 2>/dev/null | rg -v "verify_r2c_zero_script_surface\\.sh" >/tmp/verify_r2c_zero_script_hit.$$; then
    echo "[verify-r2c-zero-script] forbidden pattern detected: $pattern" >&2
    sed -n '1,40p' /tmp/verify_r2c_zero_script_hit.$$ >&2 || true
    fail=1
  fi
  rm -f /tmp/verify_r2c_zero_script_hit.$$ || true
}

check_forbidden "$ROOT/tools/native_r2c_compile_react_project.c" "python3" "python runtime"
check_forbidden "$ROOT/tools/native_r2c_compile_react_project.c" "sh -lc" "shell command string"
check_forbidden "$ROOT/tools/native_r2c_compile_react_project.c" "execl\\(\"/bin/sh\"" "shell exec"
check_forbidden "$ROOT/tools/native_r2c_compile_react_project.c" "r2c_compile_report_postfix" "python postfix bridge"
check_forbidden "$ROOT/tools/native_verify_android_claude_1to1_gate.c" "CHENG_NATIVE_GATE_ALLOW_SCRIPT_DISPATCH|allow_script_dispatch_wrapper" "script-dispatch backdoor"
check_forbidden "$ROOT/scripts/verify_android_claude_1to1_gate.sh" "python3|perl|sh -lc|/bin/sh -c" "interpreter runtime"
check_forbidden "$ROOT/scripts/verify_android_fullroute_visual_pixel.sh" "python3|perl|sh -lc|/bin/sh -c" "interpreter runtime"
check_absent "\\$ROOT/scripts/r2c_compile_react_project\\.sh" "$ROOT/scripts/*.sh"
check_absent "scripts/verify_r2c_equivalence_all_native\\.sh" "$ROOT/scripts/*.sh"
check_absent "scripts/verify_android_claude_1to1_gate\\.sh" "$ROOT/scripts/*.sh"
check_absent "scripts/verify_android_fullroute_visual_pixel\\.sh" "$ROOT/scripts/*.sh"
check_absent "python3" "$ROOT/scripts/r2c_compile_react_project.sh $ROOT/scripts/verify_r2c_equivalence_*_native.sh"

if [ "$fail" -ne 0 ]; then
  exit 1
fi

if [ "${R2C_ZERO_SCRIPT_SKIP_RUNTIME:-0}" = "1" ]; then
  echo "[verify-r2c-zero-script] ok (surface-only)"
  exit 0
fi

ensure_native_cmd

tmp_out="$(mktemp -d "$ROOT/build/.r2c_zero_script.XXXXXX")"
trap 'rm -rf "$tmp_out"' EXIT

"$COMPILE_CMD" \
  --project "$ROOT/tests/unimaker_fixture" \
  --entry "/app/main.tsx" \
  --out "$tmp_out" \
  --strict

report_json="$tmp_out/r2capp/r2capp_compile_report.json"
actions_json="$tmp_out/r2capp/r2c_route_actions_android.json"

if [ ! -f "$report_json" ]; then
  echo "[verify-r2c-zero-script] missing compile report: $report_json" >&2
  exit 1
fi
if [ ! -f "$actions_json" ]; then
  echo "[verify-r2c-zero-script] missing route actions: $actions_json" >&2
  exit 1
fi
if rg -n '"action_script"' "$actions_json" >/dev/null 2>&1; then
  echo "[verify-r2c-zero-script] route actions still contain action_script" >&2
  exit 1
fi
if ! rg -n '"strict_no_fallback"\s*:\s*true' "$report_json" >/dev/null 2>&1; then
  echo "[verify-r2c-zero-script] strict_no_fallback != true" >&2
  exit 1
fi
if ! rg -n '"semantic_mapping_mode"\s*:\s*"source-node-map"' "$report_json" >/dev/null 2>&1; then
  echo "[verify-r2c-zero-script] semantic_mapping_mode != source-node-map" >&2
  exit 1
fi

echo "[verify-r2c-zero-script] ok"
