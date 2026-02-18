#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export CHENG_GUI_ROOT="$ROOT"

host="$(uname -s)"
if [ "$host" != "Darwin" ]; then
  echo "[verify-r2c-compiler-matrix] skip: host=$host (compiler matrix currently validated on macOS)"
  exit 0
fi

for bin in bash python3; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "[verify-r2c-compiler-matrix] missing dependency: $bin" >&2
    exit 2
  fi
done

bash "$ROOT/scripts/sync_claude_fixture.sh" || true

out_root="$ROOT/build/r2c_compiler_matrix"
mkdir -p "$out_root"

run_one() {
  local name="$1"
  local fixture="$2"
  local entry="$3"

  if [ ! -f "$fixture/index.html" ] || [ ! -f "$fixture/${entry#/}" ]; then
    echo "[verify-r2c-compiler-matrix] missing fixture files: $fixture" >&2
    exit 1
  fi

  local out_dir="$out_root/$name"
  mkdir -p "$out_dir"
  export CHENG_R2C_PROFILE="$name"
  export CHENG_R2C_PROJECT_NAME="$name"
  export CHENG_R2C_TARGET_MATRIX="macos,windows,linux,android,ios,web"
  export CHENG_R2C_NO_JS_RUNTIME="1"
  export CHENG_R2C_WPT_PROFILE="core"
  export CHENG_R2C_EQUIVALENCE_MODE="wpt+e2e"
  export CHENG_STRICT_GATE_CONTEXT=1

  bash "$ROOT/scripts/r2c_compile_react_project.sh" --project "$fixture" --entry "$entry" --out "$out_dir" --strict

  local pkg="$out_dir/r2capp"
  local report="$pkg/r2capp_compile_report.json"
  for f in "$pkg/src/entry.cheng" "$pkg/src/runtime_generated.cheng" "$pkg/src/dom_generated.cheng" "$pkg/src/events_generated.cheng" "$pkg/src/webapi_generated.cheng" "$pkg/r2capp_manifest.json" "$report"; do
    if [ ! -f "$f" ]; then
      echo "[verify-r2c-compiler-matrix] missing artifact: $f" >&2
      exit 1
    fi
  done

  if ! grep -q '"generated_runtime_path"' "$report"; then
    echo "[verify-r2c-compiler-matrix] missing generated runtime field in report: $report" >&2
    exit 1
  fi
  if ! grep -q '"adapter_coverage"' "$report"; then
    echo "[verify-r2c-compiler-matrix] missing adapter coverage field in report: $report" >&2
    exit 1
  fi
  if ! grep -q '"platform_artifacts"' "$report"; then
    echo "[verify-r2c-compiler-matrix] missing platform artifact field in report: $report" >&2
    exit 1
  fi
  if ! grep -q 'platform-macos-bin' "$report"; then
    echo "[verify-r2c-compiler-matrix] missing concrete platform artifact entries in report: $report" >&2
    exit 1
  fi

  echo "[verify-r2c-compiler-matrix] ok: $name"
}

run_one "unimaker" "$ROOT/tests/unimaker_fixture" "/app/main.tsx"
run_one "claude" "$ROOT/tests/claude_fixture" "/app/main.tsx"

echo "[verify-r2c-compiler-matrix] ok"
