#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"

project="${R2C_REAL_PROJECT:-/Users/lbcheng/UniMaker/ClaudeDesign}"
entry="${R2C_REAL_ENTRY:-/app/main.tsx}"
out_dir="${R2C_EQ_ANDROID_OUT:-$ROOT/build/r2c_equivalence_android_native}"
android_fullroute="${CHENG_ANDROID_EQ_ENABLE_FULLROUTE:-0}"
android_runtime_required="${CHENG_ANDROID_EQ_REQUIRE_RUNTIME:-1}"

while [ $# -gt 0 ]; do
  case "$1" in
    --project) project="${2:-}"; shift 2 ;;
    --entry) entry="${2:-}"; shift 2 ;;
    --out) out_dir="${2:-}"; shift 2 ;;
    --android-fullroute) android_fullroute="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Usage: verify_r2c_equivalence_android_native.sh [--project <abs>] [--entry </app/main.tsx>] [--out <abs>] [--android-fullroute 0|1]"
      exit 0
      ;;
    *) echo "[verify-r2c-android-native] unknown arg: $1" >&2; exit 2 ;;
  esac
done

case "$android_fullroute" in
  0|1) ;;
  *)
    echo "[verify-r2c-android-native] invalid --android-fullroute: $android_fullroute (expect 0 or 1)" >&2
    exit 2
    ;;
esac

case "$android_runtime_required" in
  0|1) ;;
  *)
    echo "[verify-r2c-android-native] invalid CHENG_ANDROID_EQ_REQUIRE_RUNTIME: $android_runtime_required (expect 0 or 1)" >&2
    exit 2
    ;;
esac

mkdir -p "$out_dir"

echo "== r2c native equivalence: android gate =="
# Readiness phase never runs fullroute.
export CHENG_ANDROID_1TO1_ENABLE_FULLROUTE=0
export CHENG_ANDROID_1TO1_REQUIRE_RUNTIME="$android_runtime_required"
echo "[verify-r2c-android-native] android fullroute(requested)=${android_fullroute}"
echo "[verify-r2c-android-native] android fullroute(readiness-phase)=0"
echo "[verify-r2c-android-native] android runtime(required)=${android_runtime_required}"
bash "$ROOT/scripts/verify_android_claude_1to1_gate.sh" --project "$project" --entry "$entry" --out "$out_dir"

report_json="$out_dir/claude_compile/r2capp/r2capp_compile_report.json"
if [ ! -f "$report_json" ]; then
  echo "[verify-r2c-android-native] missing report: $report_json" >&2
  exit 1
fi

python3 - "$report_json" "$android_fullroute" <<'PY'
import json
import hashlib
import os
import sys

report_path = sys.argv[1]
android_fullroute = str(sys.argv[2]).strip()
data = json.load(open(report_path, "r", encoding="utf-8"))
for key in ("unsupported_syntax", "unsupported_imports", "degraded_features"):
    if len(data.get(key, []) or []) != 0:
        print(f"[verify-r2c-android-native] {key} must be 0", file=sys.stderr)
        sys.exit(1)
if not bool(data.get("strict_no_fallback", False)):
    print("[verify-r2c-android-native] strict_no_fallback != true", file=sys.stderr)
    sys.exit(1)
if bool(data.get("used_fallback", True)):
    print("[verify-r2c-android-native] used_fallback != false", file=sys.stderr)
    sys.exit(1)
if bool(data.get("template_runtime_used", False)):
    print("[verify-r2c-android-native] template_runtime_used != false", file=sys.stderr)
    sys.exit(1)
if str(data.get("semantic_compile_mode", "") or "") not in ("react-semantic-ir-node-compile", "react-semantic-ir-v1"):
    print("[verify-r2c-android-native] semantic_compile_mode invalid", file=sys.stderr)
    sys.exit(1)
if str(data.get("semantic_mapping_mode", "") or "") != "source-node-map":
    print("[verify-r2c-android-native] semantic_mapping_mode != source-node-map", file=sys.stderr)
    sys.exit(1)
semantic_count = int(data.get("semantic_node_count", 0) or 0)
if semantic_count <= 0:
    print("[verify-r2c-android-native] semantic_node_count <= 0", file=sys.stderr)
    sys.exit(1)
required_paths = [
    "react_ir_path",
    "hook_graph_path",
    "effect_plan_path",
    "third_party_rewrite_report_path",
    "truth_trace_manifest_android_path",
    "perf_summary_path",
    "semantic_node_map_path",
    "semantic_runtime_map_path",
    "semantic_render_nodes_path",
    "generated_runtime_path",
]
for key in required_paths:
    p = str(data.get(key, "") or "")
    if not p or not os.path.isfile(p):
        print(f"[verify-r2c-android-native] missing {key}: {p}", file=sys.stderr)
        sys.exit(1)
semantic_render_nodes_path = str(data.get("semantic_render_nodes_path", "") or "")
semantic_render_nodes_hash = str(data.get("semantic_render_nodes_hash", "") or "").strip().lower()
semantic_render_nodes_fnv64 = str(data.get("semantic_render_nodes_fnv64", "") or "").strip().lower()
semantic_render_nodes_count = int(data.get("semantic_render_nodes_count", 0) or 0)
if len(semantic_render_nodes_hash) != 64:
    print("[verify-r2c-android-native] invalid semantic_render_nodes_hash", file=sys.stderr)
    sys.exit(1)
if len(semantic_render_nodes_fnv64) != 16:
    print("[verify-r2c-android-native] invalid semantic_render_nodes_fnv64", file=sys.stderr)
    sys.exit(1)
if semantic_render_nodes_count <= 0:
    print("[verify-r2c-android-native] semantic_render_nodes_count <= 0", file=sys.stderr)
    sys.exit(1)
with open(semantic_render_nodes_path, "r", encoding="utf-8", errors="ignore") as fh:
    render_rows = [line.strip() for line in fh if line.strip() and not line.startswith("#")]
if len(render_rows) != semantic_render_nodes_count:
    print("[verify-r2c-android-native] semantic render rows mismatch", file=sys.stderr)
    sys.exit(1)
if len(render_rows) < semantic_count:
    print("[verify-r2c-android-native] semantic render rows too small", file=sys.stderr)
    sys.exit(1)
actual_render_hash = hashlib.sha256(open(semantic_render_nodes_path, "rb").read()).hexdigest().lower()
if actual_render_hash != semantic_render_nodes_hash:
    print("[verify-r2c-android-native] semantic render hash mismatch", file=sys.stderr)
    sys.exit(1)
payload = open(semantic_render_nodes_path, "rb").read()
fnv = 1469598103934665603
for b in payload:
    fnv ^= int(b)
    fnv = (fnv * 1099511628211) & 0xFFFFFFFFFFFFFFFF
actual_render_fnv64 = f"{fnv:016x}"
if actual_render_fnv64 != semantic_render_nodes_fnv64:
    print("[verify-r2c-android-native] semantic render fnv64 mismatch", file=sys.stderr)
    sys.exit(1)
generated_runtime_path = str(data.get("generated_runtime_path", "") or "")
runtime_src = open(generated_runtime_path, "r", encoding="utf-8").read()
append_count = runtime_src.count("appendSemanticNode(")
if append_count < semantic_count:
    print(
        f"[verify-r2c-android-native] generated runtime semantic nodes insufficient: append={append_count} expected={semantic_count}",
        file=sys.stderr,
    )
    sys.exit(1)
if "# appendSemanticNode(" in runtime_src:
    print("[verify-r2c-android-native] generated runtime contains template semantic marker comments", file=sys.stderr)
    sys.exit(1)
full_states_path = str(data.get("full_route_states_path", "") or "")
if not full_states_path or not os.path.isfile(full_states_path):
    print("[verify-r2c-android-native] missing full_route_states_path", file=sys.stderr)
    sys.exit(1)
states_doc = json.load(open(full_states_path, "r", encoding="utf-8"))
route_states = states_doc.get("states", [])
if not isinstance(route_states, list) or len(route_states) <= 0:
    print("[verify-r2c-android-native] full_route_states is empty", file=sys.stderr)
    sys.exit(1)
semantic_runtime_map_path = str(data.get("semantic_runtime_map_path", "") or "")
semantic_map_path = str(data.get("semantic_node_map_path", "") or "")
semantic_map_doc = json.load(open(semantic_map_path, "r", encoding="utf-8"))
runtime_map_doc = json.load(open(semantic_runtime_map_path, "r", encoding="utf-8"))
semantic_map_nodes = semantic_map_doc.get("nodes", [])
runtime_map_nodes = runtime_map_doc.get("nodes", [])
if not isinstance(semantic_map_nodes, list) or len(semantic_map_nodes) != semantic_count:
    print("[verify-r2c-android-native] semantic source map count mismatch", file=sys.stderr)
    sys.exit(1)
if not isinstance(runtime_map_nodes, list) or len(runtime_map_nodes) <= 0:
    print("[verify-r2c-android-native] semantic runtime map nodes empty", file=sys.stderr)
    sys.exit(1)
if len(runtime_map_nodes) != semantic_count:
    print("[verify-r2c-android-native] semantic runtime map count mismatch", file=sys.stderr)
    sys.exit(1)
if not all(isinstance(row, dict) for row in semantic_map_nodes):
    print("[verify-r2c-android-native] semantic source map item type invalid (require object schema)", file=sys.stderr)
    sys.exit(1)
if not all(isinstance(row, dict) for row in runtime_map_nodes):
    print("[verify-r2c-android-native] semantic runtime map item type invalid (require object schema)", file=sys.stderr)
    sys.exit(1)
def route_match(hint: str, state: str) -> bool:
    h = str(hint or "").strip()
    s = str(state or "").strip()
    if not h or not s:
        return False
    if h == s:
        return True
    if s.startswith(h + "_"):
        return True
    if h == "home" and s.startswith("home_"):
        return True
    if h == "publish" and s.startswith("publish_"):
        return True
    if h == "trading" and s.startswith("trading_"):
        return True
    return False
coverage_states = route_states
if android_fullroute != "1":
    preferred = [state for state in route_states if state in ("lang_select", "home_default")]
    if preferred:
        coverage_states = preferred
    elif route_states:
        coverage_states = [route_states[0]]
missing_semantic_states = []
for state in coverage_states:
    state_count = 0
    renderable_count = 0
    for row in runtime_map_nodes:
        if not isinstance(row, dict):
            continue
        hint = str(row.get("route_hint", "") or "").strip()
        bucket = str(row.get("render_bucket", "") or "").strip()
        matched = route_match(hint, state) or route_match(bucket, state)
        if not matched:
            continue
        state_count += 1
        role = str(row.get("role", "") or "").strip().lower()
        text = str(row.get("text", "") or "").strip()
        prop_id = str((row.get("props", {}) or {}).get("id", "") if isinstance(row.get("props", {}), dict) else "").strip()
        test_id = str((row.get("props", {}) or {}).get("dataTestId", "") if isinstance(row.get("props", {}), dict) else "").strip()
        event_binding = str(row.get("event_binding", "") or "").strip()
        if role in ("element", "text", "event"):
            renderable_count += 1
        elif text or prop_id or test_id or event_binding:
            renderable_count += 1
    if state_count <= 0:
        missing_semantic_states.append(state)
        continue
    if renderable_count <= 0:
        missing_semantic_states.append(state)
if missing_semantic_states:
    print(
        "[verify-r2c-android-native] semantic render coverage missing states: {}".format(
            ",".join(missing_semantic_states[:10])
        ),
        file=sys.stderr,
    )
    if android_fullroute == "1":
        sys.exit(1)
    sys.exit(1)
compiler_origin = str(data.get("compiler_report_origin", "") or "").strip()
if compiler_origin != "cheng-compiler":
    print(
        "[verify-r2c-android-native] compiler_report_origin={} (require cheng-compiler)".format(
            compiler_origin
        ),
        file=sys.stderr,
    )
    sys.exit(1)
print("[verify-r2c-android-native] report fields ok")
PY

if [ "$android_fullroute" = "1" ]; then
  echo "== r2c native equivalence: android fullroute visual gate =="
  bash "$ROOT/scripts/verify_android_fullroute_visual_pixel.sh" \
    --compile-out "$out_dir/claude_compile" \
    --out "$out_dir/fullroute" \
    --manifest "$ROOT/tests/claude_fixture/golden/android_fullroute/chromium_truth_manifest_android.json"
fi

echo "[verify-r2c-android-native] ok"
