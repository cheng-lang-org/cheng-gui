#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"

BIN_DIR="${CHENG_GUI_DISPATCHER_BIN_DIR:-$ROOT/bin}"
BIN_NAME="${CHENG_GUI_DISPATCHER_BIN_NAME:-cheng_gui_scripts}"
CMD="$BIN_DIR/verify_r2c_equivalence_harmony_native"

ensure_native_cmd() {
  if [ -x "$CMD" ]; then
    return 0
  fi
  "$ROOT/scripts/build_script_dispatcher.sh" --out-dir "$BIN_DIR" --bin-name "$BIN_NAME" >/dev/null
  if [ ! -x "$CMD" ]; then
    echo "[verify-r2c-harmony-native] missing native command: $CMD" >&2
    exit 1
  fi
}

ensure_native_cmd
exec "$CMD" "$@"
