#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"

host="$(uname -s)"
if [ "$host" != "Darwin" ]; then
  echo "[verify-r2c-exec] skip: host=$host (runtime smoke currently macOS-only)"
  exit 0
fi

for bin in python3; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "[verify-r2c-exec] missing dependency: $bin" >&2
    exit 2
  fi
done

bash "$ROOT/scripts/sync_claude_fixture.sh" || true

fixture_root="$ROOT/tests/claude_fixture"
if [ ! -f "$fixture_root/index.html" ] || [ ! -f "$fixture_root/app/main.tsx" ]; then
  echo "[verify-r2c-exec] missing fixture under: $fixture_root" >&2
  exit 1
fi

out_dir="$ROOT/build/r2c_executable_runtime"
mkdir -p "$out_dir"
compile_out="$out_dir/claude_exec"

export R2C_PROFILE="claude"
export STRICT_GATE_CONTEXT=1
bash "$ROOT/scripts/r2c_compile_react_project.sh" --project "$fixture_root" --out "$compile_out" --strict

app_bin="$compile_out/r2c_app_runner_macos"
if [ ! -x "$app_bin" ]; then
  echo "[verify-r2c-exec] missing app binary: $app_bin" >&2
  exit 1
fi

events_file="$out_dir/events.txt"
cat > "$events_file" <<'EOF'
click|#lang-en|
click|#confirm|
click|#tab-trading|
pointer-move|#chart|x=160;y=96
click|#tab-publish|
click|#file-select|
EOF

snapshot_out="$out_dir/app_snapshot.txt"
state_out="$out_dir/app_state.txt"
R2C_APP_URL="about:blank" \
R2C_RUNNER_MODE="1" \
R2C_APP_EVENT_SCRIPT="$events_file" \
R2C_APP_SNAPSHOT_OUT="$snapshot_out" \
R2C_APP_STATE_OUT="$state_out" \
  "$app_bin" >/dev/null 2>&1

if [ ! -f "$state_out" ]; then
  echo "[verify-r2c-exec] missing state output: $state_out" >&2
  exit 1
fi
if [ ! -f "$snapshot_out" ]; then
  echo "[verify-r2c-exec] missing snapshot output: $snapshot_out" >&2
  exit 1
fi

if ! grep -q "mounted=true" "$state_out"; then
  echo "[verify-r2c-exec] missing mounted flag" >&2
  exit 1
fi
if ! grep -q "profile=claude" "$state_out"; then
  echo "[verify-r2c-exec] unexpected compile profile" >&2
  exit 1
fi
if ! grep -q "module_count=" "$state_out"; then
  echo "[verify-r2c-exec] missing module count" >&2
  exit 1
fi
if ! grep -q "draw_commands=" "$state_out"; then
  echo "[verify-r2c-exec] missing draw command count" >&2
  exit 1
fi
if ! grep -q "APP:claude" "$snapshot_out" && ! grep -q "APP:claude_fixture" "$snapshot_out"; then
  echo "[verify-r2c-exec] missing home snapshot token" >&2
  exit 1
fi
if ! grep -q "FILE_PREVIEW_OK" "$snapshot_out"; then
  echo "[verify-r2c-exec] missing file preview snapshot token" >&2
  exit 1
fi

echo "[verify-r2c-exec] ok: $app_bin"
