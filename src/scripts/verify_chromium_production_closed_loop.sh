#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
export GUI_ROOT="$ROOT"

strict_export() {
  local name="$1"
  local required="$2"
  local current="${!name-}"
  if [ -n "$current" ] && [ "$current" != "$required" ]; then
    echo "[verify-chromium-production-closed-loop] strict env violation: $name=$current (expected $required)" >&2
    exit 1
  fi
  export "$name=$required"
}

strict_export CHROMIUM_RUNTIME_EXEC 1
strict_export CHROMIUM_ENGINE_REUSE_OBJ 0
strict_export CHROMIUM_RUNTIME_REUSE_OBJ 0
strict_export CHROMIUM_NETWORK_REUSE_OBJ 0
strict_export CHROMIUM_NETWORK_REUSE_BIN 0
strict_export CHROMIUM_SECURITY_REUSE_OBJ 0
strict_export CHROMIUM_SECURITY_REUSE_BIN 0
strict_export CHROMIUM_PERF_REUSE_OBJ 0
strict_export CHROMIUM_PERF_REUSE_BIN 0

if [ ! -f "$REPO_ROOT/docs/chromium_closure_spec.md" ]; then
  echo "[verify-chromium-production-closed-loop] missing spec: $REPO_ROOT/docs/chromium_closure_spec.md" >&2
  exit 1
fi

echo "== chromium-closed-loop: engine obj =="
"$ROOT/scripts/verify_chromium_engine_obj.sh" "$@"

echo "== chromium-closed-loop: runtime matrix =="
"$ROOT/scripts/verify_chromium_runtime_matrix.sh"

echo "== chromium-closed-loop: wpt core =="
"$ROOT/scripts/verify_chromium_wpt_core.sh"

echo "== chromium-closed-loop: network features =="
"$ROOT/scripts/verify_chromium_network_features.sh"

echo "== chromium-closed-loop: security =="
"$ROOT/scripts/verify_chromium_security.sh"

echo "== chromium-closed-loop: perf =="
"$ROOT/scripts/verify_chromium_perf.sh"

echo "[verify-chromium-production-closed-loop] ok"
