#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"

project="${R2C_REAL_PROJECT:-/Users/lbcheng/UniMaker/ClaudeDesign}"
entry="${R2C_REAL_ENTRY:-/app/main.tsx}"
out_dir="${R2C_EQ_HARMONY_OUT:-$ROOT/build/r2c_equivalence_harmony_native}"

while [ $# -gt 0 ]; do
  case "$1" in
    --project) project="${2:-}"; shift 2 ;;
    --entry) entry="${2:-}"; shift 2 ;;
    --out) out_dir="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Usage: verify_r2c_equivalence_harmony_native.sh [--project <abs>] [--entry </app/main.tsx>] [--out <abs>]"
      exit 0
      ;;
    *) echo "[verify-r2c-harmony-native] unknown arg: $1" >&2; exit 2 ;;
  esac
done

compile_out="$out_dir/compile"
native_out="$out_dir/native"
mkdir -p "$compile_out" "$native_out"

export STRICT_GATE_CONTEXT=1
export R2C_TARGET_MATRIX="harmony"
export R2C_RUNTIME_TEXT_SOURCE="project"
export R2C_RUNTIME_ROUTE_TITLE_SOURCE="project"
export R2C_SKIP_HOST_RUNTIME_BIN_BUILD=1
export CHENG_HARMONY_REQUIRE_HAP="${CHENG_HARMONY_REQUIRE_HAP:-1}"

echo "== r2c native equivalence: harmony compile =="
bash "$ROOT/scripts/r2c_compile_react_project.sh" --project "$project" --entry "$entry" --out "$compile_out" --strict

report_json="$compile_out/r2capp/r2capp_compile_report.json"
if [ ! -f "$report_json" ]; then
  echo "[verify-r2c-harmony-native] missing report: $report_json" >&2
  exit 1
fi

python3 - "$report_json" "$project" <<'PY'
import json
import os
import sys

report_path, project_root = sys.argv[1:3]
data = json.load(open(report_path, "r", encoding="utf-8"))
for key in ("unsupported_syntax", "unsupported_imports", "degraded_features"):
    if len(data.get(key, []) or []) != 0:
        print(f"[verify-r2c-harmony-native] {key} must be 0", file=sys.stderr)
        sys.exit(1)
if not bool(data.get("strict_no_fallback", False)):
    print("[verify-r2c-harmony-native] strict_no_fallback != true", file=sys.stderr)
    sys.exit(1)
if bool(data.get("used_fallback", True)):
    print("[verify-r2c-harmony-native] used_fallback != false", file=sys.stderr)
    sys.exit(1)
if str(data.get("semantic_mapping_mode", "") or "") != "source-node-map":
    print("[verify-r2c-harmony-native] semantic_mapping_mode != source-node-map", file=sys.stderr)
    sys.exit(1)
semantic_count = int(data.get("semantic_node_count", 0) or 0)
if semantic_count <= 0:
    print("[verify-r2c-harmony-native] semantic_node_count <= 0", file=sys.stderr)
    sys.exit(1)
required_paths = [
    "react_ir_path",
    "hook_graph_path",
    "effect_plan_path",
    "third_party_rewrite_report_path",
    "truth_trace_manifest_harmony_path",
    "perf_summary_path",
]
for key in required_paths:
    p = str(data.get(key, "") or "")
    if not p or not os.path.isfile(p):
        print(f"[verify-r2c-harmony-native] missing {key}: {p}", file=sys.stderr)
        sys.exit(1)
semantic_map_path = str(data.get("semantic_node_map_path", "") or "")
semantic_runtime_map_path = str(data.get("semantic_runtime_map_path", "") or "")
semantic_render_nodes_path = str(data.get("semantic_render_nodes_path", "") or "")
semantic_render_nodes_hash = str(data.get("semantic_render_nodes_hash", "") or "").strip().lower()
semantic_render_nodes_fnv64 = str(data.get("semantic_render_nodes_fnv64", "") or "").strip().lower()
semantic_render_nodes_count = int(data.get("semantic_render_nodes_count", 0) or 0)
generated_runtime_path = str(data.get("generated_runtime_path", "") or "")
if not semantic_map_path or not os.path.isfile(semantic_map_path):
    print(f"[verify-r2c-harmony-native] missing semantic_node_map_path: {semantic_map_path}", file=sys.stderr)
    sys.exit(1)
if not semantic_runtime_map_path or not os.path.isfile(semantic_runtime_map_path):
    print(f"[verify-r2c-harmony-native] missing semantic_runtime_map_path: {semantic_runtime_map_path}", file=sys.stderr)
    sys.exit(1)
if not semantic_render_nodes_path or not os.path.isfile(semantic_render_nodes_path):
    print(f"[verify-r2c-harmony-native] missing semantic_render_nodes_path: {semantic_render_nodes_path}", file=sys.stderr)
    sys.exit(1)
if len(semantic_render_nodes_hash) != 64:
    print(f"[verify-r2c-harmony-native] invalid semantic_render_nodes_hash: {semantic_render_nodes_hash}", file=sys.stderr)
    sys.exit(1)
if len(semantic_render_nodes_fnv64) != 16:
    print(f"[verify-r2c-harmony-native] invalid semantic_render_nodes_fnv64: {semantic_render_nodes_fnv64}", file=sys.stderr)
    sys.exit(1)
if semantic_render_nodes_count <= 0:
    print("[verify-r2c-harmony-native] semantic_render_nodes_count <= 0", file=sys.stderr)
    sys.exit(1)
if not generated_runtime_path or not os.path.isfile(generated_runtime_path):
    print(f"[verify-r2c-harmony-native] missing generated_runtime_path: {generated_runtime_path}", file=sys.stderr)
    sys.exit(1)
semantic_doc = json.load(open(semantic_map_path, "r", encoding="utf-8"))
runtime_doc = json.load(open(semantic_runtime_map_path, "r", encoding="utf-8"))
nodes = semantic_doc.get("nodes", [])
runtime_nodes = runtime_doc.get("nodes", [])
if not isinstance(nodes, list) or len(nodes) != semantic_count:
    print("[verify-r2c-harmony-native] semantic source map count mismatch", file=sys.stderr)
    sys.exit(1)
if not isinstance(runtime_nodes, list) or len(runtime_nodes) != semantic_count:
    print("[verify-r2c-harmony-native] semantic runtime map count mismatch", file=sys.stderr)
    sys.exit(1)
with open(semantic_render_nodes_path, "r", encoding="utf-8", errors="ignore") as fh:
    render_rows = [line.strip() for line in fh if line.strip() and not line.startswith("#")]
if len(render_rows) != semantic_render_nodes_count:
    print(
        f"[verify-r2c-harmony-native] semantic render rows mismatch: rows={len(render_rows)} report={semantic_render_nodes_count}",
        file=sys.stderr,
    )
    sys.exit(1)
if len(render_rows) < semantic_count:
    print(
        f"[verify-r2c-harmony-native] semantic render rows too small: rows={len(render_rows)} semantic_count={semantic_count}",
        file=sys.stderr,
    )
    sys.exit(1)
import hashlib
actual_render_hash = hashlib.sha256(open(semantic_render_nodes_path, "rb").read()).hexdigest().lower()
if actual_render_hash != semantic_render_nodes_hash:
    print(
        f"[verify-r2c-harmony-native] semantic render hash mismatch: report={semantic_render_nodes_hash} actual={actual_render_hash}",
        file=sys.stderr,
    )
    sys.exit(1)
payload = open(semantic_render_nodes_path, "rb").read()
fnv = 1469598103934665603
for b in payload:
    fnv ^= int(b)
    fnv = (fnv * 1099511628211) & 0xFFFFFFFFFFFFFFFF
actual_render_fnv64 = f"{fnv:016x}"
if actual_render_fnv64 != semantic_render_nodes_fnv64:
    print(
        f"[verify-r2c-harmony-native] semantic render fnv64 mismatch: report={semantic_render_nodes_fnv64} actual={actual_render_fnv64}",
        file=sys.stderr,
    )
    sys.exit(1)
runtime_src = open(generated_runtime_path, "r", encoding="utf-8").read()
append_count = runtime_src.count("appendSemanticNode(")
if append_count < semantic_count:
    print(
        f"[verify-r2c-harmony-native] generated runtime semantic nodes insufficient: append={append_count} expected={semantic_count}",
        file=sys.stderr,
    )
    sys.exit(1)
source_modules = sorted({
    str((row or {}).get("source_module", "") or "").strip()
    for row in nodes
    if isinstance(row, dict)
})
project_modules = [m for m in source_modules if m.startswith("/app/")]
if len(project_modules) < 10:
    print(f"[verify-r2c-harmony-native] semantic source_module too small: {len(project_modules)}", file=sys.stderr)
    sys.exit(1)
missing = []
for mod in project_modules:
    rel = mod.lstrip("/")
    local = os.path.join(project_root, rel)
    if not os.path.isfile(local):
        missing.append(mod)
missing_ratio = (len(missing) / len(project_modules)) if project_modules else 1.0
if missing_ratio > 0.05:
    print(
        f"[verify-r2c-harmony-native] semantic source_module mismatch vs project files: missing={len(missing)}/{len(project_modules)} ratio={missing_ratio:.3f}",
        file=sys.stderr,
    )
    sys.exit(1)
print("[verify-r2c-harmony-native] report fields ok")
PY

entry_cheng="$compile_out/r2capp/src/entry.cheng"
if [ ! -f "$entry_cheng" ]; then
  echo "[verify-r2c-harmony-native] missing generated entry: $entry_cheng" >&2
  exit 1
fi

echo "== r2c native equivalence: harmony native release build =="
/Users/lbcheng/.cheng-packages/cheng-mobile/scripts/build_native_harmony_release.sh --file:"$entry_cheng" --name:r2c_harmony_native_equivalence --out:"$native_out"

echo "[verify-r2c-harmony-native] ok"
