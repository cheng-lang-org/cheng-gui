#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"

host="$(uname -s)"
if [ "$host" != "Darwin" ]; then
  echo "[verify-r2c-platform-matrix] skip: host=$host (platform artifact packaging currently macOS-only)"
  exit 0
fi

out_dir="$ROOT/build/r2c_platform_matrix"
mkdir -p "$out_dir"

bash "$ROOT/scripts/sync_claude_fixture.sh" || true
export R2C_PROFILE="claude-platform"
export R2C_PROJECT_NAME="claude-platform"
export R2C_TARGET_MATRIX="macos,windows,linux,android,ios,web"
export R2C_NO_JS_RUNTIME="1"
export R2C_WPT_PROFILE="core"
export R2C_EQUIVALENCE_MODE="wpt+e2e"
export STRICT_GATE_CONTEXT=1
bash "$ROOT/scripts/r2c_compile_react_project.sh" --project "$ROOT/tests/claude_fixture" --entry "/app/main.tsx" --out "$out_dir/claude" --strict

artifacts_dir="$out_dir/claude/r2capp_platform_artifacts"
for path in \
  "$artifacts_dir/macos/r2c_app_macos" \
  "$artifacts_dir/macos/r2c_app_macos.o" \
  "$artifacts_dir/windows/r2c_app_windows.o" \
  "$artifacts_dir/linux/r2c_app_linux.o" \
  "$artifacts_dir/android/r2c_app_android.o" \
  "$artifacts_dir/ios/r2c_app_ios.o" \
  "$artifacts_dir/web/r2c_app_web.o"; do
  if [ ! -f "$path" ]; then
    echo "[verify-r2c-platform-matrix] missing platform artifact: $path" >&2
    exit 1
  fi
done

report="$out_dir/claude/r2capp/r2capp_compile_report.json"
artifacts_report="$out_dir/claude/r2capp/r2capp_platform_artifacts.json"
if ! grep -q '\"platform_artifacts\"' "$report"; then
  echo "[verify-r2c-platform-matrix] missing platform_artifacts field in report: $report" >&2
  exit 1
fi
if ! grep -q 'platform-windows-obj' "$report"; then
  echo "[verify-r2c-platform-matrix] missing windows artifact entry in report: $report" >&2
  exit 1
fi
if [ ! -f "$artifacts_report" ]; then
  echo "[verify-r2c-platform-matrix] missing artifacts report: $artifacts_report" >&2
  exit 1
fi

echo "[verify-r2c-platform-matrix] ok"
