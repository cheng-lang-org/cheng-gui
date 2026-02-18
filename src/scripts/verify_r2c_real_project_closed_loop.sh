#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export CHENG_GUI_ROOT="$ROOT"
STRICT_PROJECT="/Users/lbcheng/UniMaker/ClaudeDesign"
STRICT_ENTRY="/app/main.tsx"

usage() {
  cat <<'EOF'
Usage:
  verify_r2c_real_project_closed_loop.sh --project <abs_path> [--entry </app/main.tsx>] [--out <abs_path>] [--event-script <path>]

Description:
  Compile and run a real React project through the R2C no-Node/no-JS-runtime pipeline.
  Gate conditions (default):
  - strict compile succeeds
  - compile report has zero unsupported_syntax
  - compile report has zero unsupported_imports
  - compile report has zero degraded_features
  - runner and desktop binaries both execute and emit mounted/draw outputs
EOF
}

slugify() {
  printf '%s' "$1" | sed 's/[^A-Za-z0-9._-]/_/g'
}

project=""
entry=""
out_dir=""
event_script=""

while [ $# -gt 0 ]; do
  case "$1" in
    --project) project="${2:-}"; shift 2 ;;
    --entry) entry="${2:-}"; shift 2 ;;
    --out) out_dir="${2:-}"; shift 2 ;;
    --event-script) event_script="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[verify-r2c-real] unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$project" ]; then
  usage
  exit 2
fi
if [ ! -d "$project" ]; then
  echo "[verify-r2c-real] missing project dir: $project" >&2
  exit 2
fi
if [ -n "$event_script" ] && [ ! -f "$event_script" ]; then
  echo "[verify-r2c-real] missing event script: $event_script" >&2
  exit 2
fi

host="$(uname -s)"
if [ "$host" != "Darwin" ]; then
  echo "[verify-r2c-real] skip: host=$host (runtime check currently macOS-only)"
  exit 0
fi

project="$(CDPATH= cd -- "$project" && pwd)"
if [ "${CHENG_STRICT_GATE_CONTEXT:-0}" = "1" ]; then
  if [ "$project" != "$STRICT_PROJECT" ]; then
    echo "[verify-r2c-real] strict mode requires --project $STRICT_PROJECT" >&2
    exit 1
  fi
  if [ -z "$entry" ]; then
    entry="$STRICT_ENTRY"
  fi
  if [ "$entry" != "$STRICT_ENTRY" ]; then
    echo "[verify-r2c-real] strict mode requires --entry $STRICT_ENTRY" >&2
    exit 1
  fi
fi
if [ -z "$out_dir" ]; then
  base_name="$(basename "$project")"
  out_dir="$ROOT/build/r2c_real_project_closed_loop/$(slugify "$base_name")"
fi
mkdir -p "$out_dir"
out_dir="$(CDPATH= cd -- "$out_dir" && pwd)"

compile_args=(--project "$project" --out "$out_dir" --strict)
if [ -n "$entry" ]; then
  compile_args+=(--entry "$entry")
fi

export CHENG_R2C_LEGACY_UNIMAKER=0
export CHENG_R2C_SKIP_COMPILER_RUN=0
export CHENG_R2C_TRY_COMPILER_FIRST=1
export CHENG_STRICT_GATE_CONTEXT=1
export CHENG_R2C_REUSE_RUNTIME_BINS="${CHENG_R2C_REUSE_RUNTIME_BINS:-0}"
export CHENG_R2C_REBUILD_DESKTOP="${CHENG_R2C_REBUILD_DESKTOP:-1}"
export CHENG_R2C_RUNTIME_FRONTEND="${CHENG_R2C_RUNTIME_FRONTEND:-stage1}"
export CHENG_R2C_DESKTOP_FRONTEND="${CHENG_R2C_DESKTOP_FRONTEND:-auto}"
export CHENG_R2C_RUNTIME_TEXT_SOURCE="${CHENG_R2C_RUNTIME_TEXT_SOURCE:-project}"
export CHENG_R2C_RUNTIME_ROUTE_TITLE_SOURCE="${CHENG_R2C_RUNTIME_ROUTE_TITLE_SOURCE:-project}"
export CHENG_R2C_MAX_SEMANTIC_NODES="${CHENG_R2C_MAX_SEMANTIC_NODES:-1600}"
if [ "${CHENG_R2C_RUNTIME_TEXT_SOURCE:-project}" != "project" ]; then
  echo "[verify-r2c-real] strict mode requires CHENG_R2C_RUNTIME_TEXT_SOURCE=project" >&2
  exit 1
fi
if [ "${CHENG_R2C_RUNTIME_ROUTE_TITLE_SOURCE:-project}" != "project" ]; then
  echo "[verify-r2c-real] strict mode requires CHENG_R2C_RUNTIME_ROUTE_TITLE_SOURCE=project" >&2
  exit 1
fi
if [ "${CHENG_STRICT_GATE_CONTEXT:-0}" = "1" ] && [ "${CHENG_R2C_RUNTIME_FRONTEND:-stage1}" != "stage1" ]; then
  echo "[verify-r2c-real] strict mode requires CHENG_R2C_RUNTIME_FRONTEND=stage1" >&2
  exit 1
fi
if [ "${CHENG_STRICT_GATE_CONTEXT:-0}" = "1" ] && [ "${CHENG_R2C_DESKTOP_FRONTEND:-auto}" != "auto" ]; then
  echo "[verify-r2c-real] strict mode requires CHENG_R2C_DESKTOP_FRONTEND=auto" >&2
  exit 1
fi

bash "$ROOT/scripts/r2c_compile_react_project.sh" "${compile_args[@]}"

report_json="$out_dir/r2capp/r2capp_compile_report.json"
if [ ! -f "$report_json" ]; then
  echo "[verify-r2c-real] missing compile report: $report_json" >&2
  exit 1
fi

python3 - "$report_json" <<'PY'
import json
import os
import sys

report_path = sys.argv[1]
with open(report_path, "r", encoding="utf-8") as fh:
    data = json.load(fh)

unsup_syntax = data.get("unsupported_syntax", [])
unsup_imports = data.get("unsupported_imports", [])
degraded = data.get("degraded_features", [])

if unsup_syntax:
    print(f"[verify-r2c-real] unsupported_syntax={len(unsup_syntax)}", file=sys.stderr)
    for item in unsup_syntax[:8]:
        print(f"  - {item}", file=sys.stderr)
    sys.exit(1)
if unsup_imports:
    print(f"[verify-r2c-real] unsupported_imports={len(unsup_imports)}", file=sys.stderr)
    for item in unsup_imports[:8]:
        print(f"  - {item}", file=sys.stderr)
    sys.exit(1)
if degraded:
    print(f"[verify-r2c-real] degraded_features={len(degraded)}", file=sys.stderr)
    for item in degraded[:8]:
        print(f"  - {item}", file=sys.stderr)
    sys.exit(1)

if data.get("generated_ui_mode") != "ir-driven":
    print(f"[verify-r2c-real] generated_ui_mode != ir-driven: {data.get('generated_ui_mode')}", file=sys.stderr)
    sys.exit(1)
if data.get("route_discovery_mode") != "static-runtime-hybrid":
    print(f"[verify-r2c-real] route_discovery_mode mismatch: {data.get('route_discovery_mode')}", file=sys.stderr)
    sys.exit(1)
if int(data.get("pixel_tolerance", -1)) != 0:
    print(f"[verify-r2c-real] pixel_tolerance != 0: {data.get('pixel_tolerance')}", file=sys.stderr)
    sys.exit(1)
if data.get("replay_profile") != "claude-fullroute":
    print(f"[verify-r2c-real] replay_profile mismatch: {data.get('replay_profile')}", file=sys.stderr)
    sys.exit(1)
required_modes = {
    "utfzh_mode": "strict",
    "ime_mode": "cangwu-global",
    "cjk_render_backend": "native-text-first",
    "cjk_render_gate": "no-garbled-cjk",
}
for key, expected in required_modes.items():
    got = str(data.get(key, "") or "")
    if got != expected:
        print(f"[verify-r2c-real] {key} mismatch: {got} != {expected}", file=sys.stderr)
        sys.exit(1)
if data.get("semantic_mapping_mode") != "source-node-map":
    print(f"[verify-r2c-real] semantic_mapping_mode mismatch: {data.get('semantic_mapping_mode')}", file=sys.stderr)
    sys.exit(1)
semantic_map_path = data.get("semantic_node_map_path", "")
if not semantic_map_path or not os.path.isfile(semantic_map_path):
    print(f"[verify-r2c-real] missing semantic_node_map_path: {semantic_map_path}", file=sys.stderr)
    sys.exit(1)
semantic_runtime_map_path = data.get("semantic_runtime_map_path", "")
if not semantic_runtime_map_path or not os.path.isfile(semantic_runtime_map_path):
    print(f"[verify-r2c-real] missing semantic_runtime_map_path: {semantic_runtime_map_path}", file=sys.stderr)
    sys.exit(1)
text_profile_path = data.get("text_profile_path", "")
if not text_profile_path or not os.path.isfile(text_profile_path):
    print(f"[verify-r2c-real] missing text_profile_path: {text_profile_path}", file=sys.stderr)
    sys.exit(1)
try:
    text_profile_doc = json.load(open(text_profile_path, "r", encoding="utf-8"))
except Exception as exc:
    print(f"[verify-r2c-real] failed to parse text_profile: {exc}", file=sys.stderr)
    sys.exit(1)
if str(text_profile_doc.get("mode", "") or "") != "project":
    print("[verify-r2c-real] text profile mode must be project", file=sys.stderr)
    sys.exit(1)
if str(text_profile_doc.get("route_title_mode", "") or "") != "project":
    print("[verify-r2c-real] text profile route_title_mode must be project", file=sys.stderr)
    sys.exit(1)
if "claude_fixture" in str(text_profile_doc.get("welcome", "") or ""):
    print("[verify-r2c-real] text profile welcome still templated", file=sys.stderr)
    sys.exit(1)
if int(text_profile_doc.get("route_title_count", 0)) <= 0:
    print("[verify-r2c-real] text profile route_title_count invalid", file=sys.stderr)
    sys.exit(1)
semantic_count = int(data.get("semantic_node_count", 0))
if semantic_count <= 0:
    print(f"[verify-r2c-real] semantic_node_count <= 0: {semantic_count}", file=sys.stderr)
    sys.exit(1)
try:
    semantic_doc = json.load(open(semantic_map_path, "r", encoding="utf-8"))
except Exception as exc:
    print(f"[verify-r2c-real] failed to parse semantic node map: {exc}", file=sys.stderr)
    sys.exit(1)
try:
    semantic_runtime_doc = json.load(open(semantic_runtime_map_path, "r", encoding="utf-8"))
except Exception as exc:
    print(f"[verify-r2c-real] failed to parse semantic runtime map: {exc}", file=sys.stderr)
    sys.exit(1)
nodes = semantic_doc.get("nodes", [])
if not isinstance(nodes, list) or len(nodes) == 0:
    print("[verify-r2c-real] semantic node map nodes empty", file=sys.stderr)
    sys.exit(1)
runtime_nodes = semantic_runtime_doc.get("nodes", [])
if not isinstance(runtime_nodes, list) or len(runtime_nodes) == 0:
    print("[verify-r2c-real] semantic runtime map nodes empty", file=sys.stderr)
    sys.exit(1)
if int(semantic_doc.get("count", -1)) != len(nodes):
    print("[verify-r2c-real] semantic node map count mismatch", file=sys.stderr)
    sys.exit(1)
if int(semantic_runtime_doc.get("count", -1)) != len(runtime_nodes):
    print("[verify-r2c-real] semantic runtime map count mismatch", file=sys.stderr)
    sys.exit(1)
if semantic_count != len(nodes):
    print(f"[verify-r2c-real] semantic_node_count mismatch: report={semantic_count}, map={len(nodes)}", file=sys.stderr)
    sys.exit(1)
def semantic_node_key(item):
    if not isinstance(item, dict):
        return ("", "", "", "", "", "", "", "")
    return (
        str(item.get("node_id", "") or "").strip(),
        str(item.get("source_module", "") or "").strip(),
        str(item.get("jsx_path", "") or "").strip(),
        str(item.get("role", "") or "").strip(),
        str(item.get("event_binding", "") or "").strip(),
        str(item.get("hook_slot", "") or "").strip(),
        str(item.get("route_hint", "") or "").strip(),
        str(item.get("text", "") or "").strip(),
    )
source_keys = [semantic_node_key(item) for item in nodes if isinstance(item, dict)]
runtime_keys = [semantic_node_key(item) for item in runtime_nodes if isinstance(item, dict)]
if len(source_keys) != len(nodes) or len(runtime_keys) != len(runtime_nodes):
    print("[verify-r2c-real] semantic map item type invalid", file=sys.stderr)
    sys.exit(1)
if len(set(source_keys)) != len(source_keys):
    print("[verify-r2c-real] semantic source node keys are not unique", file=sys.stderr)
    sys.exit(1)
if len(set(runtime_keys)) != len(runtime_keys):
    print("[verify-r2c-real] semantic runtime node keys are not unique", file=sys.stderr)
    sys.exit(1)
if set(source_keys) != set(runtime_keys):
    source_only = sorted(set(source_keys) - set(runtime_keys))
    runtime_only = sorted(set(runtime_keys) - set(source_keys))
    print(f"[verify-r2c-real] semantic runtime map mismatch source_only={len(source_only)} runtime_only={len(runtime_only)}", file=sys.stderr)
    sys.exit(1)
if not bool(data.get("strict_no_fallback", False)):
    print("[verify-r2c-real] strict_no_fallback != true", file=sys.stderr)
    sys.exit(1)
if bool(data.get("used_fallback", True)):
    print("[verify-r2c-real] used_fallback != false", file=sys.stderr)
    sys.exit(1)
if int(data.get("compiler_rc", -1)) != 0:
    print(f"[verify-r2c-real] compiler_rc != 0: {data.get('compiler_rc')}", file=sys.stderr)
    sys.exit(1)

state_count = int(data.get("full_route_state_count", 0))
states = data.get("visual_states", [])
if state_count <= 0 or state_count != len(states):
    print(f"[verify-r2c-real] full_route_state_count mismatch: count={state_count} len(states)={len(states)}", file=sys.stderr)
    sys.exit(1)

required_paths = [
    data.get("route_graph_path", ""),
    data.get("route_event_matrix_path", ""),
    data.get("route_coverage_path", ""),
    data.get("full_route_states_path", ""),
    data.get("full_route_event_matrix_path", ""),
    data.get("full_route_coverage_report_path", ""),
]
for p in required_paths:
    if not p or not os.path.isfile(p):
        print(f"[verify-r2c-real] missing full-route artifact: {p}", file=sys.stderr)
        sys.exit(1)

visual_manifest_path = data.get("visual_golden_manifest_path", "")
if not visual_manifest_path or not os.path.isfile(visual_manifest_path):
    print(f"[verify-r2c-real] missing visual_golden_manifest_path: {visual_manifest_path}", file=sys.stderr)
    sys.exit(1)
try:
    manifest_doc = json.load(open(visual_manifest_path, "r", encoding="utf-8"))
except Exception as exc:
    print(f"[verify-r2c-real] failed to parse visual manifest: {exc}", file=sys.stderr)
    sys.exit(1)
manifest_states = []
for row in manifest_doc.get("states", []):
    if not isinstance(row, dict):
        continue
    name = str(row.get("name", "")).strip()
    if name and name not in manifest_states:
        manifest_states.append(name)
if len(manifest_states) == 0:
    print("[verify-r2c-real] visual manifest states empty", file=sys.stderr)
    sys.exit(1)
if len(states) != len(set(states)):
    print("[verify-r2c-real] visual_states contains duplicates", file=sys.stderr)
    sys.exit(1)
if len(states) != len(manifest_states) or set(states) != set(manifest_states):
    missing = sorted([s for s in manifest_states if s not in set(states)])
    extra = sorted([s for s in states if s not in set(manifest_states)])
    print(f"[verify-r2c-real] route set mismatch vs visual manifest (missing={len(missing)} extra={len(extra)})", file=sys.stderr)
    sys.exit(1)

route_graph_doc = json.load(open(data.get("route_graph_path"), "r", encoding="utf-8"))
graph_states = route_graph_doc.get("final_states", [])
if not isinstance(graph_states, list):
    print("[verify-r2c-real] route graph final_states invalid", file=sys.stderr)
    sys.exit(1)
if len(graph_states) != len(states) or set(graph_states) != set(states):
    print("[verify-r2c-real] route graph final_states mismatch", file=sys.stderr)
    sys.exit(1)

route_matrix_doc = json.load(open(data.get("route_event_matrix_path"), "r", encoding="utf-8"))
route_matrix_states = route_matrix_doc.get("states", [])
if not isinstance(route_matrix_states, list) or len(route_matrix_states) != len(states):
    print("[verify-r2c-real] route event matrix states count mismatch", file=sys.stderr)
    sys.exit(1)
if route_matrix_states and isinstance(route_matrix_states[0], dict):
    names = [str(item.get("name", "")).strip() for item in route_matrix_states if isinstance(item, dict)]
    if names != states:
        print("[verify-r2c-real] route event matrix names mismatch", file=sys.stderr)
        sys.exit(1)

route_cov_doc = json.load(open(data.get("route_coverage_path"), "r", encoding="utf-8"))
if int(route_cov_doc.get("routes_total", -1)) != len(states):
    print("[verify-r2c-real] route_coverage routes_total mismatch", file=sys.stderr)
    sys.exit(1)
if int(route_cov_doc.get("routes_required", -1)) != len(manifest_states):
    print("[verify-r2c-real] route_coverage routes_required mismatch", file=sys.stderr)
    sys.exit(1)
if int(route_cov_doc.get("routes_verified", -1)) != len(states):
    print("[verify-r2c-real] route_coverage routes_verified mismatch", file=sys.stderr)
    sys.exit(1)
if len(route_cov_doc.get("missing_states", [])) != 0 or len(route_cov_doc.get("extra_states", [])) != 0:
    print("[verify-r2c-real] route_coverage has missing/extra states", file=sys.stderr)
    sys.exit(1)
PY

runner_bin="$out_dir/r2c_app_runner_macos"
desktop_bin="$out_dir/r2c_app_macos"
if [ ! -x "$runner_bin" ] || [ ! -x "$desktop_bin" ]; then
  echo "[verify-r2c-real] missing runtime binaries under: $out_dir" >&2
  exit 1
fi

runner_snapshot="$out_dir/runner_snapshot.txt"
runner_state="$out_dir/runner_state.txt"
desktop_snapshot="$out_dir/desktop_snapshot.txt"
desktop_state="$out_dir/desktop_state.txt"
desktop_drawlist="$out_dir/desktop_drawlist.txt"
skip_desktop_smoke="${CHENG_R2C_REAL_SKIP_DESKTOP_SMOKE:-0}"
skip_runner_smoke="${CHENG_R2C_REAL_SKIP_RUNNER_SMOKE:-0}"

if [ "$skip_runner_smoke" != "1" ]; then
  runner_env=(
    "CHENG_R2C_APP_URL=about:blank"
    "CHENG_R2C_RUNNER_MODE=1"
    "CHENG_R2CAPP_MANIFEST=$out_dir/r2capp/r2capp_manifest.json"
    "CHENG_R2C_APP_SNAPSHOT_OUT=$runner_snapshot"
    "CHENG_R2C_APP_STATE_OUT=$runner_state"
  )
  if [ -n "$event_script" ]; then
    runner_env+=("CHENG_R2C_APP_EVENT_SCRIPT=$event_script")
  fi
  if ! perl -e 'my $t=shift @ARGV; alarm $t; exec @ARGV or die $!;' 20 env "${runner_env[@]}" "$runner_bin" >/dev/null 2>&1; then
    echo "[verify-r2c-real] runner timeout/failure: $runner_bin" >&2
    exit 1
  fi
fi

desktop_env=(
  "CHENG_R2C_APP_URL=about:blank"
  "CHENG_R2CAPP_MANIFEST=$out_dir/r2capp/r2capp_manifest.json"
  "CHENG_R2C_APP_SNAPSHOT_OUT=$desktop_snapshot"
  "CHENG_R2C_APP_STATE_OUT=$desktop_state"
  "CHENG_R2C_APP_DRAWLIST_OUT=$desktop_drawlist"
  "CHENG_R2C_DESKTOP_AUTOCLOSE_MS=180"
)
if [ -n "$event_script" ]; then
  desktop_env+=("CHENG_R2C_APP_EVENT_SCRIPT=$event_script")
fi
if [ "$skip_desktop_smoke" != "1" ]; then
  if ! perl -e 'my $t=shift @ARGV; alarm $t; exec @ARGV or die $!;' 20 env "${desktop_env[@]}" "$desktop_bin" >/dev/null 2>&1; then
    echo "[verify-r2c-real] desktop timeout/failure: $desktop_bin" >&2
    exit 1
  fi
fi

required_files_text=""
if [ "$skip_runner_smoke" != "1" ]; then
  required_files_text="$required_files_text
$runner_snapshot
$runner_state"
fi
if [ "$skip_desktop_smoke" != "1" ]; then
  required_files_text="$required_files_text
$desktop_snapshot
$desktop_state
$desktop_drawlist"
fi
while IFS= read -r f; do
  if [ -z "$f" ]; then
    continue
  fi
  if [ ! -f "$f" ]; then
    echo "[verify-r2c-real] missing output: $f" >&2
    exit 1
  fi
done <<EOF
$required_files_text
EOF

echo "[verify-r2c-strict] no-fallback=true"
echo "[verify-r2c-strict] compiler-rc=0"

if [ "$skip_runner_smoke" != "1" ]; then
  if ! grep -q "mounted=true" "$runner_state"; then
    echo "[verify-r2c-real] runner missing mounted=true" >&2
    exit 1
  fi
fi
if [ "$skip_desktop_smoke" != "1" ]; then
  if ! grep -q "mounted=true" "$desktop_state"; then
    echo "[verify-r2c-real] desktop missing mounted=true" >&2
    exit 1
  fi
fi
if [ "$skip_runner_smoke" != "1" ]; then
  if ! grep -q "draw_commands=" "$runner_state"; then
    echo "[verify-r2c-real] runner missing draw_commands" >&2
    exit 1
  fi
fi
if [ "$skip_desktop_smoke" != "1" ]; then
  if ! grep -q "draw_commands=" "$desktop_state"; then
    echo "[verify-r2c-real] desktop missing draw_commands" >&2
    exit 1
  fi
fi
if [ "$skip_desktop_smoke" != "1" ]; then
  if [ ! -s "$desktop_drawlist" ]; then
    echo "[verify-r2c-real] desktop drawlist is empty" >&2
    exit 1
  fi
fi

echo "[verify-r2c-real] ok: project=$project out=$out_dir"
