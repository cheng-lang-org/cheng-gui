#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"

if [ "${ENABLE_CLAUDE_OBSERVABILITY:-0}" != "1" ]; then
  echo "[verify-optional-claude-observability] skip (set ENABLE_CLAUDE_OBSERVABILITY=1 to enable)"
  exit 0
fi

run_soft_check() {
  local script="$1"
  local label="$2"
  set +e
  "$script"
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "[verify-optional-claude-observability] warn: $label failed rc=$rc"
    return 0
  fi
  echo "[verify-optional-claude-observability] ok: $label"
  return 0
}

run_soft_check "$ROOT/scripts/verify_strict_realtime_1to1_gate.sh" "strict-realtime-1to1"
run_soft_check "$ROOT/scripts/verify_claude_utfzh_ime_strict.sh" "claude-utfzh-ime"
run_soft_check "$ROOT/scripts/verify_claude_fullroute_visual_pixel.sh" "claude-fullroute-visual-pixel"
echo "[verify-optional-claude-observability] done"
