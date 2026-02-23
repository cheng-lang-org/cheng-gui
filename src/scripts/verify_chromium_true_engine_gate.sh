#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$ROOT/.." && pwd)"
export GUI_ROOT="$ROOT"

forward_args=("$@")

strict_export() {
  local name="$1"
  local required="$2"
  local current="${!name-}"
  if [ -n "$current" ] && [ "$current" != "$required" ]; then
    echo "[verify-chromium-true-engine-gate] strict env violation: $name=$current (expected $required)" >&2
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

if [ "$(uname -s)" != "Darwin" ]; then
  echo "[verify-chromium-true-engine-gate] blocking platform is macOS; current=$(uname -s)" >&2
  exit 1
fi

marker_dir="$ROOT/build/chromium_strict_gate"
marker_path="$marker_dir/chromium_true_engine_gate.ok.json"
mkdir -p "$marker_dir"

status=1
trap 'if [ "$status" != "0" ]; then rm -f "'"$marker_path"'"; fi' EXIT
rm -f "$marker_path"

echo "== chromium true gate: production closure =="
"$ROOT/scripts/verify_chromium_production_closed_loop.sh" "${forward_args[@]}"

echo "== chromium true gate: runtime wpt =="
"$ROOT/scripts/verify_chromium_wpt_core.sh" "${forward_args[@]}"

wpt_json="$ROOT/build/chromium_wpt/wpt_core_runtime_report.json"
runtime_log="$ROOT/build/chromium_runtime_matrix/chromium_engine_smoke_macos.run.log"
network_log="$ROOT/build/chromium_network_features/chromium_network_features_smoke_macos.run.log"
security_log="$ROOT/build/chromium_security/chromium_security_smoke_macos.run.log"
perf_log="$ROOT/build/chromium_perf/chromium_perf_smoke_macos.run.log"

for f in "$wpt_json" "$runtime_log" "$network_log" "$security_log" "$perf_log"; do
  if [ ! -f "$f" ]; then
    echo "[verify-chromium-true-engine-gate] missing runtime artifact: $f" >&2
    exit 1
  fi
done

for f in "$runtime_log" "$network_log" "$security_log" "$perf_log"; do
  if ! [ -s "$f" ]; then
    echo "[verify-chromium-true-engine-gate] empty runtime log: $f" >&2
    exit 1
  fi
  if rg -n "runtime skipped|compile-only" "$f" >/dev/null 2>&1; then
    echo "[verify-chromium-true-engine-gate] invalid runtime log marker in $f" >&2
    exit 1
  fi
done

if ! command -v python3 >/dev/null 2>&1; then
  echo "[verify-chromium-true-engine-gate] missing dependency: python3" >&2
  exit 2
fi

git_head="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)"
if [ -z "$git_head" ]; then
  echo "[verify-chromium-true-engine-gate] failed to resolve git HEAD" >&2
  exit 1
fi

epoch_now="$(date +%s)"
python3 - "$marker_path" "$wpt_json" "$git_head" "$epoch_now" <<'PY'
import json
import sys

marker_path, wpt_path, git_head, epoch_now = sys.argv[1:5]
min_cases = 80
min_pass_rate = 90.0
doc = json.load(open(wpt_path, "r", encoding="utf-8"))
total = int(doc.get("total", 0))
passed = int(doc.get("pass", 0))
failed = int(doc.get("fail", 0))
pass_rate = float(doc.get("pass_rate", 0.0))

if total < min_cases:
    raise SystemExit(f"[verify-chromium-true-engine-gate] wpt total below gate: total={total} min={min_cases}")
if pass_rate < min_pass_rate:
    raise SystemExit(f"[verify-chromium-true-engine-gate] wpt pass_rate below gate: pass_rate={pass_rate:.2f} min={min_pass_rate:.2f}")
if passed + failed != total:
    raise SystemExit("[verify-chromium-true-engine-gate] wpt totals mismatch")

payload = {
    "git_head": git_head,
    "generated_at_epoch": int(epoch_now),
    "gate_mode": "chromium-true-engine",
    "platform": "macos",
    "wpt_runtime_pass_rate": pass_rate,
    "wpt_runtime_total": total,
    "wpt_runtime_pass": passed,
    "network_ok": True,
    "security_ok": True,
    "perf_ok": True,
    "runtime_matrix_ok": True,
    "pixel_tolerance": 0,
}
with open(marker_path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY

status=0
echo "[verify-chromium-true-engine-gate] ok"
