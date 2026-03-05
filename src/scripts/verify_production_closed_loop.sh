#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"
BIN_DIR="${CHENG_GUI_DISPATCHER_BIN_DIR:-$ROOT/bin}"
BIN_NAME="${CHENG_GUI_DISPATCHER_BIN_NAME:-cheng_gui_scripts}"
ALL_EQ_CMD="$BIN_DIR/verify_r2c_equivalence_all_native"

ensure_all_eq_cmd() {
  if [ -x "$ALL_EQ_CMD" ]; then
    return 0
  fi
  "$ROOT/scripts/build_script_dispatcher.sh" --out-dir "$BIN_DIR" --bin-name "$BIN_NAME" >/dev/null
  if [ ! -x "$ALL_EQ_CMD" ]; then
    echo "[verify-production-closed-loop] missing native all-platform command: $ALL_EQ_CMD" >&2
    exit 1
  fi
}

if [ "${CHENG_ANDROID_1TO1_REQUIRE_RUNTIME:-1}" != "1" ]; then
  echo "[verify-production-closed-loop] strict mode requires CHENG_ANDROID_1TO1_REQUIRE_RUNTIME=1" >&2
  exit 1
fi
export CHENG_ANDROID_1TO1_REQUIRE_RUNTIME=1

if [ -z "${CHENG_ANDROID_1TO1_ENABLE_FULLROUTE+x}" ]; then
  export CHENG_ANDROID_1TO1_ENABLE_FULLROUTE="${CHENG_ANDROID_EQ_ENABLE_FULLROUTE:-1}"
fi
if [ "${CHENG_PRODUCTION_REQUIRE_ANDROID_FULLROUTE:-1}" = "1" ] && [ "${CHENG_ANDROID_1TO1_ENABLE_FULLROUTE}" != "1" ]; then
  echo "[verify-production-closed-loop] CHENG_PRODUCTION_REQUIRE_ANDROID_FULLROUTE=1 requires CHENG_ANDROID_1TO1_ENABLE_FULLROUTE=1" >&2
  exit 1
fi

echo "== closed-loop: native equivalence (android + ios + harmony) =="
echo "[verify-production-closed-loop] android fullroute=${CHENG_ANDROID_1TO1_ENABLE_FULLROUTE}"
"$ROOT/scripts/verify_r2c_zero_script_surface.sh"
ensure_all_eq_cmd
"$ALL_EQ_CMD" "$@"

echo "[verify-production-closed-loop] ok"
