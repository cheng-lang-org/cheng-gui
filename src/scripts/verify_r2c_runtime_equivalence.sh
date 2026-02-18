#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export CHENG_GUI_ROOT="$ROOT"

host="$(uname -s)"
if [ "$host" != "Darwin" ]; then
  echo "[verify-r2c-runtime-equivalence] skip: host=$host (runtime equivalence currently macOS-only)"
  exit 0
fi

echo "== r2c-runtime-equivalence: unimaker fixture =="
"$ROOT/scripts/verify_unimaker_react_aot_closed_loop.sh"

echo "== r2c-runtime-equivalence: claude fixture =="
"$ROOT/scripts/verify_claude_react_aot_closed_loop.sh"

echo "== r2c-runtime-equivalence: executable runner =="
"$ROOT/scripts/verify_r2c_executable_runtime.sh"

echo "[verify-r2c-runtime-equivalence] ok"
