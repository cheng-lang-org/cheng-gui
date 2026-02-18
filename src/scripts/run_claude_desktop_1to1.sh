#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPILE_SCRIPT="$ROOT/scripts/r2c_compile_react_project.sh"
DEFAULT_PROJECT="/Users/lbcheng/UniMaker/ClaudeDesign"
DEFAULT_ENTRY="/app/main.tsx"
DEFAULT_OUT="$ROOT/build/claude_desktop_1to1"
STRICT_MARKER="$ROOT/build/strict_realtime_gate/claude_strict_gate.ok.json"
STRICT_FIX_CMD="$ROOT/scripts/verify_strict_realtime_1to1_gate.sh"

project="$DEFAULT_PROJECT"
entry="$DEFAULT_ENTRY"
out_dir="$DEFAULT_OUT"
rebuild=0
debug=0
autoclose_ms=""
capture=0

usage() {
  cat <<'USAGE'
Usage:
  run_claude_desktop_1to1.sh [options] [-- app_args...]

Options:
  --project <abs_path>     React project path (default: /Users/lbcheng/UniMaker/ClaudeDesign)
  --entry <path>           Entry module (default: /app/main.tsx)
  --out <abs_path>         Output directory (default: src/build/claude_desktop_1to1)
  --rebuild                Force recompile before launch
  --debug                  Enable CHENG_GUI_DEBUG=1
  --autoclose-ms <ms>      Auto-close desktop app after ms
  --capture                Export snapshot/state/drawlist into out_dir/run_capture
  -h, --help               Show this help
USAGE
}

require_strict_gate_marker() {
  local project_path="$1"
  local entry_path="$2"
  if [ "${CHENG_STRICT_GATE_CONTEXT:-0}" = "1" ]; then
    return 0
  fi
  if [ ! -f "$STRICT_MARKER" ]; then
    echo "[run-claude-1to1] strict realtime gate required" >&2
    echo "[run-claude-1to1] run: $STRICT_FIX_CMD" >&2
    exit 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "[run-claude-1to1] missing dependency: python3" >&2
    exit 2
  fi
  local current_head
  current_head="$(git -C "$ROOT/.." rev-parse HEAD 2>/dev/null || true)"
  if [ -z "$current_head" ]; then
    echo "[run-claude-1to1] failed to resolve git HEAD" >&2
    exit 1
  fi
  if ! python3 - "$STRICT_MARKER" "$current_head" "$project_path" "$entry_path" <<'PY'
import json
import os
import sys

marker_path, current_head, project_path, entry_path = sys.argv[1:5]
doc = json.load(open(marker_path, "r", encoding="utf-8"))
required_project = "/Users/lbcheng/UniMaker/ClaudeDesign"
required_entry = "/app/main.tsx"

checks = [
    doc.get("git_head", "") == current_head,
    doc.get("project", "") == required_project,
    doc.get("entry", "") == required_entry,
    int(doc.get("routes", 0)) > 0,
    int(doc.get("pixel_tolerance", -1)) == 0,
    doc.get("gate_mode", "") == "claude-semantic-visual-1to1",
    bool(doc.get("visual_passed", False)) is True,
    doc.get("semantic_mapping_mode", "") == "source-node-map",
    int(doc.get("semantic_node_count", 0)) > 0,
    bool(str(doc.get("visual_golden_hash_manifest", "")).strip()),
    bool(str(doc.get("visual_golden_manifest_path", "")).strip()),
    os.path.abspath(project_path) == os.path.abspath(required_project),
    entry_path == required_entry,
]
if all(checks):
    sys.exit(0)
sys.exit(1)
PY
  then
    echo "[run-claude-1to1] strict gate marker mismatch or stale" >&2
    echo "[run-claude-1to1] run: $STRICT_FIX_CMD" >&2
    exit 1
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --project)
      project="${2:-}"
      shift 2
      ;;
    --entry)
      entry="${2:-}"
      shift 2
      ;;
    --out)
      out_dir="${2:-}"
      shift 2
      ;;
    --rebuild)
      rebuild=1
      shift
      ;;
    --debug)
      debug=1
      shift
      ;;
    --autoclose-ms)
      autoclose_ms="${2:-}"
      shift 2
      ;;
    --capture)
      capture=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "[run-claude-1to1] unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ ! -d "$project" ]; then
  echo "[run-claude-1to1] project not found: $project" >&2
  exit 2
fi

project="$(CDPATH= cd -- "$project" && pwd)"
require_strict_gate_marker "$project" "$entry"

app_bin="$out_dir/r2c_app_macos"
launcher_bin="$out_dir/run_r2c_app_macos.sh"

if [ "$rebuild" -eq 1 ] || [ ! -x "$app_bin" ] || [ ! -x "$launcher_bin" ]; then
  "$COMPILE_SCRIPT" \
    --project "$project" \
    --entry "$entry" \
    --out "$out_dir" \
    --strict
fi

if [ ! -x "$launcher_bin" ]; then
  echo "[run-claude-1to1] launcher missing after compile: $launcher_bin" >&2
  exit 1
fi

export CHENG_GUI_USE_REAL_MAC=1
export CHENG_GUI_FORCE_FALLBACK=0
export CHENG_GUI_DISABLE_BITMAP_TEXT=0
export CHENG_R2C_APP_URL="${CHENG_R2C_APP_URL:-about:blank}"

if [ "$debug" -eq 1 ]; then
  export CHENG_GUI_DEBUG=1
fi

if [ -n "$autoclose_ms" ]; then
  export CHENG_R2C_DESKTOP_AUTOCLOSE_MS="$autoclose_ms"
fi

if [ "$capture" -eq 1 ]; then
  capture_dir="$out_dir/run_capture"
  mkdir -p "$capture_dir"
  export CHENG_R2C_APP_SNAPSHOT_OUT="$capture_dir/snapshot.txt"
  export CHENG_R2C_APP_STATE_OUT="$capture_dir/state.txt"
  export CHENG_R2C_APP_DRAWLIST_OUT="$capture_dir/drawlist.txt"
  echo "[run-claude-1to1] capture dir: $capture_dir"
fi

echo "[run-claude-1to1] launcher: $launcher_bin"
echo "[run-claude-1to1] project: $project"
echo "[run-claude-1to1] entry: $entry"
echo "[run-claude-1to1] fallback: $CHENG_GUI_FORCE_FALLBACK"
echo "[run-claude-1to1] url: $CHENG_R2C_APP_URL"

exec "$launcher_bin" "$@"
