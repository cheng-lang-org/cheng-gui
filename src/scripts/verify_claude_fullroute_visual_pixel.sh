#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"

host="$(uname -s)"
if [ "$host" != "Darwin" ]; then
  echo "[verify-claude-fullroute-pixel] skip: host=$host (macOS-only)"
  exit 0
fi

for bin in python3 cmp shasum perl; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "[verify-claude-fullroute-pixel] missing dependency: $bin" >&2
    exit 2
  fi
done

run_with_timeout() {
  local timeout_sec="$1"
  shift
  perl -e '
    use POSIX qw(setsid WNOHANG);
    my $timeout = shift @ARGV;
    my $pid = fork();
    if (!defined $pid) {
      exit 127;
    }
    if ($pid == 0) {
      setsid();
      exec @ARGV;
      exit 127;
    }
    my $end = time() + $timeout;
    while (1) {
      my $res = waitpid($pid, WNOHANG);
      if ($res == $pid) {
        my $status = $?;
        if (($status & 127) != 0) {
          exit(128 + ($status & 127));
        }
        exit($status >> 8);
      }
      if (time() >= $end) {
        kill "TERM", -$pid;
        select(undef, undef, undef, 0.3);
        kill "KILL", -$pid;
        exit 124;
      }
      select(undef, undef, undef, 0.05);
    }
  ' "$timeout_sec" "$@"
}

bash "$ROOT/scripts/sync_claude_fixture.sh" || true
fixture_root="$ROOT/tests/claude_fixture"
strict_default_project="/Users/lbcheng/UniMaker/ClaudeDesign"
strict_default_entry="/app/main.tsx"
if [ -n "${R2C_REAL_PROJECT:-}" ] && [ "${R2C_REAL_PROJECT}" != "$strict_default_project" ]; then
  echo "[verify-claude-fullroute-pixel] strict mode requires R2C_REAL_PROJECT=$strict_default_project" >&2
  exit 1
fi
if [ -n "${R2C_REAL_ENTRY:-}" ] && [ "${R2C_REAL_ENTRY}" != "$strict_default_entry" ]; then
  echo "[verify-claude-fullroute-pixel] strict mode requires R2C_REAL_ENTRY=$strict_default_entry" >&2
  exit 1
fi
compile_project_root="$strict_default_project"
compile_project_entry="$strict_default_entry"

if [ ! -f "$fixture_root/index.html" ] || [ ! -f "$fixture_root/app/main.tsx" ]; then
  echo "[verify-claude-fullroute-pixel] missing fixture under: $fixture_root" >&2
  exit 1
fi
if [ ! -d "$compile_project_root" ]; then
  echo "[verify-claude-fullroute-pixel] missing strict compile project: $compile_project_root" >&2
  exit 1
fi
if [ ! -f "$compile_project_root/$compile_project_entry" ]; then
  echo "[verify-claude-fullroute-pixel] missing strict compile entry: $compile_project_root/$compile_project_entry" >&2
  exit 1
fi

golden_dir="$fixture_root/golden/fullroute"
if [ ! -d "$golden_dir" ]; then
  echo "[verify-claude-fullroute-pixel] missing golden dir: $golden_dir" >&2
  exit 1
fi
"$ROOT/scripts/verify_claude_chromium_truth_baseline.sh"

out_dir="$ROOT/build/r2c_fullroute_pixel"
mkdir -p "$out_dir"
compile_out="$out_dir/claude_fullroute"
batch_single_run="${R2C_BATCH_SINGLE_RUN:-1}"
rebuild_desktop="${R2C_REBUILD_DESKTOP:-1}"
consistency_runs="${R2C_FULLROUTE_CONSISTENCY_RUNS:-3}"
app_launch_timeout_sec="${R2C_APP_LAUNCH_TIMEOUT_SEC:-25}"
batch_timeout_sec="${R2C_APP_BATCH_TIMEOUT_SEC:-900}"

export R2C_PROFILE="claude"
export R2C_REUSE_RUNTIME_BINS="${R2C_REUSE_RUNTIME_BINS:-0}"
export R2C_REUSE_COMPILER_BIN="${R2C_REUSE_COMPILER_BIN:-0}"
export R2C_FORCE_DESKTOP_REBUILD="${R2C_FORCE_DESKTOP_REBUILD:-1}"
export R2C_USE_PRECOMPUTED_BATCH=0
export BACKEND_JOBS="${BACKEND_JOBS:-16}"
export BACKEND_WHOLE_PROGRAM="${BACKEND_WHOLE_PROGRAM:-0}"
export R2C_RUNTIME_FRONTEND="${R2C_RUNTIME_FRONTEND:-stage1}"
export R2C_DESKTOP_FRONTEND="${R2C_DESKTOP_FRONTEND:-stage1}"
export R2C_RUNTIME_TEXT_SOURCE="${R2C_RUNTIME_TEXT_SOURCE:-project}"
export R2C_RUNTIME_ROUTE_TITLE_SOURCE="${R2C_RUNTIME_ROUTE_TITLE_SOURCE:-project}"
export R2C_MAX_SEMANTIC_NODES="${R2C_MAX_SEMANTIC_NODES:-4000}"
# Strict fullroute forbids CJK fallback-to-'?': native text is mandatory.
export R2C_DISABLE_NATIVE_CJK_TEXT=0
export GUI_DISABLE_BITMAP_TEXT=1
export R2C_LEGACY_UNIMAKER=0
export R2C_SKIP_COMPILER_RUN=0
export R2C_TRY_COMPILER_FIRST=1
export STRICT_GATE_CONTEXT=1

if [ "$batch_single_run" != "1" ]; then
  echo "[verify-claude-fullroute-pixel] strict mode requires R2C_BATCH_SINGLE_RUN=1" >&2
  exit 1
fi
if [ "$consistency_runs" != "3" ]; then
  echo "[verify-claude-fullroute-pixel] strict mode requires R2C_FULLROUTE_CONSISTENCY_RUNS=3" >&2
  exit 1
fi
if [ "${R2C_USE_PRECOMPUTED_BATCH:-0}" != "0" ]; then
  echo "[verify-claude-fullroute-pixel] strict mode forbids R2C_USE_PRECOMPUTED_BATCH!=0" >&2
  exit 1
fi
if [ "${R2C_FULLROUTE_BLESS:-0}" != "0" ]; then
  echo "[verify-claude-fullroute-pixel] strict mode forbids R2C_FULLROUTE_BLESS!=0" >&2
  exit 1
fi
if [ "${R2C_RUNTIME_TEXT_SOURCE:-project}" != "project" ]; then
  echo "[verify-claude-fullroute-pixel] strict mode requires R2C_RUNTIME_TEXT_SOURCE=project" >&2
  exit 1
fi
if [ "${R2C_RUNTIME_ROUTE_TITLE_SOURCE:-project}" != "project" ]; then
  echo "[verify-claude-fullroute-pixel] strict mode requires R2C_RUNTIME_ROUTE_TITLE_SOURCE=project" >&2
  exit 1
fi
if [ "$rebuild_desktop" = "1" ]; then
  rm -f "$compile_out/r2c_app_macos" "$compile_out/r2capp_platform_artifacts/macos/r2c_app_macos" "$compile_out/r2capp_platform_artifacts/macos/r2c_app_macos.o"
fi
bash "$ROOT/scripts/r2c_compile_react_project.sh" --project "$compile_project_root" --entry "$compile_project_entry" --out "$compile_out" --strict

report_json="$compile_out/r2capp/r2capp_compile_report.json"
states_json="$compile_out/r2capp/r2c_fullroute_states.json"
matrix_json="$compile_out/r2capp/r2c_fullroute_event_matrix.json"
coverage_json="$compile_out/r2capp/r2c_fullroute_coverage_report.json"
route_graph_json="$compile_out/r2capp/r2c_route_graph.json"
route_matrix_json="$compile_out/r2capp/r2c_route_event_matrix.json"
route_coverage_json="$compile_out/r2capp/r2c_route_coverage_report.json"
truth_manifest_json="$golden_dir/chromium_truth_manifest.json"

python3 - "$report_json" "$states_json" "$matrix_json" "$coverage_json" "$route_graph_json" "$route_matrix_json" "$route_coverage_json" "$truth_manifest_json" <<'PY'
import json
import os
import sys

(
    report_path,
    states_path,
    matrix_path,
    coverage_path,
    route_graph_path,
    route_matrix_path,
    route_coverage_path,
    truth_manifest_path,
) = sys.argv[1:9]

def load_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)

def unique_manifest_states(path):
    doc = load_json(path)
    out = []
    seen = set()
    for row in doc.get("states", []):
        if not isinstance(row, dict):
            continue
        name = str(row.get("name", "")).strip()
        if name and name not in seen:
            seen.add(name)
            out.append(name)
    return out

report = load_json(report_path)

if report.get("generated_ui_mode") != "ir-driven":
    print("[verify-claude-fullroute-pixel] generated_ui_mode != ir-driven", file=sys.stderr)
    sys.exit(1)
if report.get("route_discovery_mode") != "static-runtime-hybrid":
    print("[verify-claude-fullroute-pixel] route_discovery_mode mismatch", file=sys.stderr)
    sys.exit(1)
if len(report.get("unsupported_syntax", [])) != 0:
    print("[verify-claude-fullroute-pixel] unsupported_syntax != 0", file=sys.stderr)
    sys.exit(1)
if len(report.get("unsupported_imports", [])) != 0:
    print("[verify-claude-fullroute-pixel] unsupported_imports != 0", file=sys.stderr)
    sys.exit(1)
if len(report.get("degraded_features", [])) != 0:
    print("[verify-claude-fullroute-pixel] degraded_features != 0", file=sys.stderr)
    sys.exit(1)
if not bool(report.get("strict_no_fallback", False)):
    print("[verify-claude-fullroute-pixel] strict_no_fallback != true", file=sys.stderr)
    sys.exit(1)
if bool(report.get("used_fallback", True)):
    print("[verify-claude-fullroute-pixel] used_fallback != false", file=sys.stderr)
    sys.exit(1)
if int(report.get("compiler_rc", -1)) != 0:
    print("[verify-claude-fullroute-pixel] compiler_rc != 0", file=sys.stderr)
    sys.exit(1)
if report.get("semantic_mapping_mode") != "source-node-map":
    print("[verify-claude-fullroute-pixel] semantic_mapping_mode mismatch", file=sys.stderr)
    sys.exit(1)
semantic_map_path = report.get("semantic_node_map_path", "")
if not semantic_map_path or not os.path.isfile(semantic_map_path):
    print(f"[verify-claude-fullroute-pixel] missing semantic node map: {semantic_map_path}", file=sys.stderr)
    sys.exit(1)
semantic_runtime_map_path = report.get("semantic_runtime_map_path", "")
if not semantic_runtime_map_path or not os.path.isfile(semantic_runtime_map_path):
    print(f"[verify-claude-fullroute-pixel] missing semantic runtime map: {semantic_runtime_map_path}", file=sys.stderr)
    sys.exit(1)
text_profile_path = report.get("text_profile_path", "")
if not text_profile_path or not os.path.isfile(text_profile_path):
    print(f"[verify-claude-fullroute-pixel] missing runtime text profile: {text_profile_path}", file=sys.stderr)
    sys.exit(1)
text_profile = load_json(text_profile_path)
if str(text_profile.get("mode", "") or "") != "project":
    print("[verify-claude-fullroute-pixel] text profile mode != project", file=sys.stderr)
    sys.exit(1)
if str(text_profile.get("route_title_mode", "") or "") != "project":
    print("[verify-claude-fullroute-pixel] text profile route_title_mode != project", file=sys.stderr)
    sys.exit(1)
if "claude_fixture" in str(text_profile.get("welcome", "") or ""):
    print("[verify-claude-fullroute-pixel] text profile welcome still templated", file=sys.stderr)
    sys.exit(1)
if int(text_profile.get("route_title_count", 0)) <= 0:
    print("[verify-claude-fullroute-pixel] text profile route_title_count invalid", file=sys.stderr)
    sys.exit(1)
semantic_count = int(report.get("semantic_node_count", 0))
if semantic_count <= 0:
    print(f"[verify-claude-fullroute-pixel] semantic_node_count <= 0: {semantic_count}", file=sys.stderr)
    sys.exit(1)
with open(semantic_map_path, "r", encoding="utf-8") as fh:
    semantic_doc = json.load(fh)
with open(semantic_runtime_map_path, "r", encoding="utf-8") as fh:
    semantic_runtime_doc = json.load(fh)
semantic_nodes = semantic_doc.get("nodes", [])
if not isinstance(semantic_nodes, list) or len(semantic_nodes) <= 0:
    print("[verify-claude-fullroute-pixel] semantic node map nodes empty", file=sys.stderr)
    sys.exit(1)
semantic_runtime_nodes = semantic_runtime_doc.get("nodes", [])
if not isinstance(semantic_runtime_nodes, list) or len(semantic_runtime_nodes) <= 0:
    print("[verify-claude-fullroute-pixel] semantic runtime map nodes empty", file=sys.stderr)
    sys.exit(1)
if int(semantic_doc.get("count", -1)) != len(semantic_nodes):
    print("[verify-claude-fullroute-pixel] semantic node map count mismatch", file=sys.stderr)
    sys.exit(1)
if int(semantic_runtime_doc.get("count", -1)) != len(semantic_runtime_nodes):
    print("[verify-claude-fullroute-pixel] semantic runtime map count mismatch", file=sys.stderr)
    sys.exit(1)
if semantic_count != len(semantic_nodes):
    print(f"[verify-claude-fullroute-pixel] semantic_node_count mismatch: report={semantic_count} map={len(semantic_nodes)}", file=sys.stderr)
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
source_keys = [semantic_node_key(item) for item in semantic_nodes if isinstance(item, dict)]
runtime_keys = [semantic_node_key(item) for item in semantic_runtime_nodes if isinstance(item, dict)]
if len(source_keys) != len(semantic_nodes) or len(runtime_keys) != len(semantic_runtime_nodes):
    print("[verify-claude-fullroute-pixel] semantic map item type invalid", file=sys.stderr)
    sys.exit(1)
if len(set(source_keys)) != len(source_keys):
    print("[verify-claude-fullroute-pixel] semantic source node keys are not unique", file=sys.stderr)
    sys.exit(1)
if len(set(runtime_keys)) != len(runtime_keys):
    print("[verify-claude-fullroute-pixel] semantic runtime node keys are not unique", file=sys.stderr)
    sys.exit(1)
if set(source_keys) != set(runtime_keys):
    source_only = sorted(set(source_keys) - set(runtime_keys))
    runtime_only = sorted(set(runtime_keys) - set(source_keys))
    print(f"[verify-claude-fullroute-pixel] semantic runtime map mismatch source_only={len(source_only)} runtime_only={len(runtime_only)}", file=sys.stderr)
    sys.exit(1)
for path in (states_path, matrix_path, coverage_path, route_graph_path, route_matrix_path, route_coverage_path):
    if not os.path.isfile(path):
        print(f"[verify-claude-fullroute-pixel] missing artifact: {path}", file=sys.stderr)
        sys.exit(1)

states_doc = load_json(states_path)
states = states_doc.get("states", [])
if not isinstance(states, list) or len(states) <= 0:
    print(f"[verify-claude-fullroute-pixel] states count invalid: {len(states) if isinstance(states, list) else 'invalid'}", file=sys.stderr)
    sys.exit(1)
if int(report.get("full_route_state_count", 0)) != len(states):
    print("[verify-claude-fullroute-pixel] full_route_state_count mismatch", file=sys.stderr)
    sys.exit(1)
if report.get("route_graph_path", "") != route_graph_path:
    print("[verify-claude-fullroute-pixel] route_graph_path mismatch", file=sys.stderr)
    sys.exit(1)
if report.get("route_event_matrix_path", "") != route_matrix_path:
    print("[verify-claude-fullroute-pixel] route_event_matrix_path mismatch", file=sys.stderr)
    sys.exit(1)
if report.get("route_coverage_path", "") != route_coverage_path:
    print("[verify-claude-fullroute-pixel] route_coverage_path mismatch", file=sys.stderr)
    sys.exit(1)

truth_path = report.get("visual_golden_manifest_path", "")
if not truth_path or not os.path.isfile(truth_path):
    print(f"[verify-claude-fullroute-pixel] missing visual_golden_manifest_path: {truth_path}", file=sys.stderr)
    sys.exit(1)
if os.path.abspath(truth_path) != os.path.abspath(truth_manifest_path):
    print("[verify-claude-fullroute-pixel] visual_golden_manifest_path mismatch", file=sys.stderr)
    sys.exit(1)
manifest_states = unique_manifest_states(truth_manifest_path)
if len(manifest_states) <= 0:
    print("[verify-claude-fullroute-pixel] truth manifest states empty", file=sys.stderr)
    sys.exit(1)
if len(states) != len(set(states)):
    print("[verify-claude-fullroute-pixel] states contains duplicates", file=sys.stderr)
    sys.exit(1)
if len(states) != len(manifest_states) or set(states) != set(manifest_states):
    missing = sorted([s for s in manifest_states if s not in set(states)])
    extra = sorted([s for s in states if s not in set(manifest_states)])
    print(f"[verify-claude-fullroute-pixel] states mismatch vs truth manifest (missing={len(missing)} extra={len(extra)})", file=sys.stderr)
    sys.exit(1)

matrix_doc = load_json(matrix_path)
matrix_states = matrix_doc.get("states", [])
if len(matrix_states) != len(states):
    print("[verify-claude-fullroute-pixel] matrix states count mismatch", file=sys.stderr)
    sys.exit(1)
if matrix_states and isinstance(matrix_states[0], dict):
    names = {item.get("name", "") for item in matrix_states}
    if set(states) != names:
        print("[verify-claude-fullroute-pixel] matrix state names mismatch", file=sys.stderr)
        sys.exit(1)
    missing_scripts = [item.get("name", "") for item in matrix_states if "event_script" not in item]
    if missing_scripts:
        print(f"[verify-claude-fullroute-pixel] matrix missing event_script: {missing_scripts[:5]}", file=sys.stderr)
        sys.exit(1)

coverage_doc = load_json(coverage_path)
if int(coverage_doc.get("routes_total", -1)) != len(states):
    print("[verify-claude-fullroute-pixel] coverage routes_total mismatch", file=sys.stderr)
    sys.exit(1)
if int(coverage_doc.get("routes_required", -1)) != len(manifest_states):
    print("[verify-claude-fullroute-pixel] coverage routes_required mismatch", file=sys.stderr)
    sys.exit(1)
routes_verified = coverage_doc.get("routes_verified", len(states))
if int(routes_verified) != len(states):
    print("[verify-claude-fullroute-pixel] coverage routes_verified mismatch", file=sys.stderr)
    sys.exit(1)
if int(coverage_doc.get("pixel_tolerance", -1)) != 0:
    print("[verify-claude-fullroute-pixel] coverage pixel_tolerance mismatch", file=sys.stderr)
    sys.exit(1)
if coverage_doc.get("replay_profile") != "claude-fullroute":
    print("[verify-claude-fullroute-pixel] coverage replay_profile mismatch", file=sys.stderr)
    sys.exit(1)
required_modes = {
    "utfzh_mode": "strict",
    "ime_mode": "cangwu-global",
    "cjk_render_backend": "native-text-first",
    "cjk_render_gate": "no-garbled-cjk",
}
for key, expected in required_modes.items():
    got = str(report.get(key, "") or "")
    if got != expected:
        print(f"[verify-claude-fullroute-pixel] report {key} mismatch: {got} != {expected}", file=sys.stderr)
        sys.exit(1)
if len(coverage_doc.get("missing_states", [])) != 0 or len(coverage_doc.get("extra_states", [])) != 0:
    print("[verify-claude-fullroute-pixel] coverage has missing/extra states", file=sys.stderr)
    sys.exit(1)

route_graph_doc = load_json(route_graph_path)
if route_graph_doc.get("route_discovery_mode") != "static-runtime-hybrid":
    print("[verify-claude-fullroute-pixel] route graph discovery mode mismatch", file=sys.stderr)
    sys.exit(1)
graph_states = route_graph_doc.get("final_states", [])
if not isinstance(graph_states, list):
    print("[verify-claude-fullroute-pixel] route graph final_states invalid", file=sys.stderr)
    sys.exit(1)
if len(graph_states) != len(states) or set(graph_states) != set(states):
    print("[verify-claude-fullroute-pixel] route graph final_states mismatch", file=sys.stderr)
    sys.exit(1)
if os.path.abspath(route_graph_doc.get("baseline_manifest_path", "")) != os.path.abspath(truth_manifest_path):
    print("[verify-claude-fullroute-pixel] route graph baseline manifest mismatch", file=sys.stderr)
    sys.exit(1)

route_matrix_doc = load_json(route_matrix_path)
route_matrix_states = route_matrix_doc.get("states", [])
if not isinstance(route_matrix_states, list) or len(route_matrix_states) != len(states):
    print("[verify-claude-fullroute-pixel] route matrix states count mismatch", file=sys.stderr)
    sys.exit(1)
if route_matrix_states and isinstance(route_matrix_states[0], dict):
    route_names = {item.get("name", "") for item in route_matrix_states}
    if set(states) != route_names:
        print("[verify-claude-fullroute-pixel] route matrix state names mismatch", file=sys.stderr)
        sys.exit(1)

route_coverage_doc = load_json(route_coverage_path)
if int(route_coverage_doc.get("routes_total", -1)) != len(states):
    print("[verify-claude-fullroute-pixel] route coverage routes_total mismatch", file=sys.stderr)
    sys.exit(1)
if int(route_coverage_doc.get("routes_required", -1)) != len(manifest_states):
    print("[verify-claude-fullroute-pixel] route coverage routes_required mismatch", file=sys.stderr)
    sys.exit(1)
if int(route_coverage_doc.get("routes_verified", -1)) != len(states):
    print("[verify-claude-fullroute-pixel] route coverage routes_verified mismatch", file=sys.stderr)
    sys.exit(1)
if len(route_coverage_doc.get("missing_states", [])) != 0 or len(route_coverage_doc.get("extra_states", [])) != 0:
    print("[verify-claude-fullroute-pixel] route coverage has missing/extra states", file=sys.stderr)
    sys.exit(1)
PY

app_bin="$compile_out/r2c_app_macos"
if [ ! -x "$app_bin" ]; then
  echo "[verify-claude-fullroute-pixel] missing desktop app binary: $app_bin" >&2
  exit 1
fi
manifest_path="$compile_out/r2capp/r2capp_manifest.json"
if [ ! -f "$manifest_path" ]; then
  echo "[verify-claude-fullroute-pixel] missing manifest: $manifest_path" >&2
  exit 1
fi

write_events_for_state() {
  local state="$1"
  local out_file="$2"
  local matrix_file="$3"
  python3 - "$state" "$out_file" "$matrix_file" <<'PY'
import json
import sys

state, out_file, matrix_file = sys.argv[1:4]
doc = json.load(open(matrix_file, "r", encoding="utf-8"))
items = doc.get("states", [])
event_script = None

if items and isinstance(items[0], dict):
    for item in items:
        if item.get("name", "") == state:
            event_script = item.get("event_script", "")
            break
else:
    events = []
    if state != "lang_select":
        events.extend(["click|#lang-en|", "click|#confirm|"])
    map_click = {
        "home_default": "click|#tab-home|",
        "home_search_open": "click|#tab-home-search-open|",
        "home_sort_open": "click|#tab-home-sort-open|",
        "home_channel_manager_open": "click|#tab-home-channel-manager-open|",
        "home_content_detail_open": "click|#tab-home-content-detail-open|",
        "home_ecom_overlay_open": "click|#tab-home-ecom-overlay-open|",
        "home_bazi_overlay_open": "click|#tab-home-bazi-overlay-open|",
        "home_ziwei_overlay_open": "click|#tab-home-ziwei-overlay-open|",
        "tab_messages": "click|#tab-messages|",
        "tab_profile": "click|#tab-profile|",
        "publish_selector": "click|#tab-publish|",
        "publish_content": "click|#tab-publish-content|",
        "publish_product": "click|#tab-publish-product|",
        "publish_live": "click|#tab-publish-live|",
        "publish_app": "click|#tab-publish-app|",
        "publish_food": "click|#tab-publish-food|",
        "publish_ride": "click|#tab-publish-ride|",
        "publish_job": "click|#tab-publish-job|",
        "publish_hire": "click|#tab-publish-hire|",
        "publish_rent": "click|#tab-publish-rent|",
        "publish_sell": "click|#tab-publish-sell|",
        "publish_secondhand": "click|#tab-publish-secondhand|",
        "publish_crowdfunding": "click|#tab-publish-crowdfunding|",
        "trading_main": "click|#tab-trading|",
        "trading_crosshair": "click|#tab-trading|",
        "ecom_main": "click|#tab-ecom|",
        "marketplace_main": "click|#tab-marketplace|",
        "update_center_main": "click|#tab-update-center|",
    }
    if state == "tab_nodes":
        events.append("click|#tab-nodes|")
        events.append("drag-end|#nodes|from=0;to=2")
    elif state == "tab_profile":
        events.append("click|#tab-profile|")
        events.append("click|#clipboard-copy|")
        events.append("click|#geo-request|")
        events.append("click|#cookie-set|")
    elif state == "trading_crosshair":
        events.append("click|#tab-trading|")
        events.append("pointer-move|#chart|x=160;y=96")
    elif state in map_click:
        events.append(map_click[state])
    elif state not in ("lang_select",):
        events.append("click|#tab-" + state.replace("_", "-") + "|")
    event_script = "\n".join(events)

if event_script is None:
    print(f"missing state in event matrix: {state}", file=sys.stderr)
    sys.exit(1)

with open(out_file, "w", encoding="utf-8") as fh:
    for raw in event_script.splitlines():
        line = raw.strip()
        if line:
            fh.write(line + "\n")
PY
}

assert_state_tokens() {
  local state="$1"
  local snapshot_file="$2"
  case "$state" in
    lang_select)
      grep -Fq "Please select your preferred language" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] lang_select snapshot mismatch" >&2; exit 1; }
      ;;
    home_default)
      grep -Fq "TAB:home" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] home_default snapshot mismatch" >&2; exit 1; }
      ;;
    tab_nodes)
      grep -Fq "TAB:nodes" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] tab_nodes snapshot missing TAB:nodes" >&2; exit 1; }
      grep -Fq "DRAG_ORDER:B,C,A" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] tab_nodes snapshot missing DRAG_ORDER:B,C,A" >&2; exit 1; }
      ;;
    tab_profile)
      grep -Fq "TAB:profile" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] tab_profile snapshot missing TAB:profile" >&2; exit 1; }
      grep -Fq "CLIPBOARD:CLIPBOARD_OK" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] tab_profile snapshot missing CLIPBOARD marker" >&2; exit 1; }
      grep -Fq "GEO:37.7749" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] tab_profile snapshot missing GEO marker" >&2; exit 1; }
      grep -Fq "COOKIE:a=1" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] tab_profile snapshot missing COOKIE marker" >&2; exit 1; }
      ;;
    publish_product)
      grep -Fq "TAB:publish_product" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] publish_product snapshot mismatch" >&2; exit 1; }
      ;;
    trading_main)
      grep -Fq "TAB:trading" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] trading_main snapshot mismatch" >&2; exit 1; }
      ;;
    trading_crosshair)
      grep -Fq "TAB:trading" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] trading_crosshair snapshot mismatch" >&2; exit 1; }
      grep -Fq "CANVAS_OK:true" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] trading_crosshair snapshot missing CANVAS_OK:true" >&2; exit 1; }
      grep -Fq "CROSSHAIR:160,96" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] trading_crosshair snapshot missing CROSSHAIR:160,96" >&2; exit 1; }
      ;;
    ecom_main)
      grep -Fq "TAB:ecom_main" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] ecom_main snapshot mismatch" >&2; exit 1; }
      ;;
    marketplace_main)
      grep -Fq "TAB:marketplace_main" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] marketplace_main snapshot mismatch" >&2; exit 1; }
      ;;
    update_center_main)
      grep -Fq "TAB:update_center_main" "$snapshot_file" || { echo "[verify-claude-fullroute-pixel] update_center_main snapshot mismatch" >&2; exit 1; }
      ;;
  esac
}

assert_state_semantics() {
  local state="$1"
  local snapshot_file="$2"
  local state_file="$3"
  local route_file="$4"
  local drawlist_file="$5"
  local framehash_file="$6"
  python3 - "$state" "$snapshot_file" "$state_file" "$route_file" "$drawlist_file" "$framehash_file" <<'PY'
import re
import sys
from pathlib import Path

state, snapshot_path, state_path, route_path, drawlist_path, framehash_path = sys.argv[1:7]
snapshot = Path(snapshot_path).read_text(encoding="utf-8", errors="ignore")
state_text = Path(state_path).read_text(encoding="utf-8", errors="ignore")
route_text = Path(route_path).read_text(encoding="utf-8", errors="ignore").strip()
drawlist_lines = [line.strip() for line in Path(drawlist_path).read_text(encoding="utf-8", errors="ignore").splitlines() if line.strip()]
framehash_text = Path(framehash_path).read_text(encoding="utf-8", errors="ignore").strip()

expected_runtime_route = {
    "lang_select": "home_default",
    "trading_crosshair": "trading_main",
}.get(state, state)
expected_snapshot_route = {
    "trading_crosshair": "trading_main",
}.get(state, state)

def must(pattern: str, text: str, label: str) -> str:
    m = re.search(pattern, text, flags=re.M)
    if not m:
        raise SystemExit(f"[verify-claude-fullroute-pixel] missing {label} for state={state}")
    return m.group(1).strip()

snapshot_route = must(r"^ROUTE:([^\n]+)$", snapshot, "snapshot route")
state_route = must(r"^route_state=([^\n]+)$", state_text, "state route")
state_hash = must(r"^frame_hash=([0-9a-fA-F]+)$", state_text, "state frame hash")
event_applied = must(r"^event_applied=(true|false)$", state_text, "event_applied")
profile = must(r"^profile=([^\n]+)$", state_text, "profile")
mounted = must(r"^mounted=(true|false)$", state_text, "mounted")

allowed_runtime_routes = [expected_runtime_route]
allowed_snapshot_routes = [expected_snapshot_route]
if state == "trading_crosshair":
    if "trading_crosshair" not in allowed_runtime_routes:
        allowed_runtime_routes.append("trading_crosshair")
    if "trading_crosshair" not in allowed_snapshot_routes:
        allowed_snapshot_routes.append("trading_crosshair")

if route_text not in allowed_runtime_routes:
    raise SystemExit(
        f"[verify-claude-fullroute-pixel] route file mismatch state={state} expected={allowed_runtime_routes} got={route_text}"
    )
if state_route not in allowed_runtime_routes:
    raise SystemExit(
        f"[verify-claude-fullroute-pixel] route_state mismatch state={state} expected={allowed_runtime_routes} got={state_route}"
    )
if snapshot_route not in allowed_snapshot_routes:
    raise SystemExit(
        f"[verify-claude-fullroute-pixel] snapshot ROUTE mismatch state={state} expected={allowed_snapshot_routes} got={snapshot_route}"
    )
if profile != "claude":
    raise SystemExit(f"[verify-claude-fullroute-pixel] profile mismatch state={state} got={profile}")
if mounted != "true":
    raise SystemExit(f"[verify-claude-fullroute-pixel] mounted mismatch state={state} got={mounted}")
if state_hash.lower() != framehash_text.lower():
    raise SystemExit(
        f"[verify-claude-fullroute-pixel] frame hash mismatch between state/frame file state={state} state_hash={state_hash} file_hash={framehash_text}"
    )

expected_event_applied = "false" if state == "lang_select" else "true"
if event_applied != expected_event_applied:
    raise SystemExit(
        f"[verify-claude-fullroute-pixel] event_applied mismatch state={state} expected={expected_event_applied} got={event_applied}"
    )

if len(drawlist_lines) < 2:
    raise SystemExit(f"[verify-claude-fullroute-pixel] drawlist too small state={state} lines={len(drawlist_lines)}")
kinds = {line.split("|", 1)[0] for line in drawlist_lines if "|" in line}
if "rect" not in kinds:
    raise SystemExit(f"[verify-claude-fullroute-pixel] drawlist missing rect command state={state}")
if "text" not in kinds:
    raise SystemExit(f"[verify-claude-fullroute-pixel] drawlist missing text command state={state}")
PY
}

run_state() {
  local state="$1"
  local snapshot_out="$out_dir/${state}.snapshot.txt"
  local state_out="$out_dir/${state}.state.txt"
  local drawlist_out="$out_dir/${state}.drawlist.txt"
  local framehash_out="$out_dir/${state}.framehash.txt"
  local frame_rgba_out="$out_dir/${state}.rgba.out"
  local route_out="$out_dir/${state}.route.txt"

  if [ ! -f "$snapshot_out" ] || [ ! -f "$state_out" ] || [ ! -f "$drawlist_out" ] || [ ! -f "$framehash_out" ] || [ ! -f "$frame_rgba_out" ] || [ ! -f "$route_out" ]; then
    echo "[verify-claude-fullroute-pixel] missing output for state=$state" >&2
    exit 1
  fi

  assert_state_tokens "$state" "$snapshot_out"
  assert_state_semantics "$state" "$snapshot_out" "$state_out" "$route_out" "$drawlist_out" "$framehash_out"

  local golden_hash="$golden_dir/${state}.framehash"
  local golden_rgba="$golden_dir/${state}.rgba"
  if [ ! -f "$golden_hash" ] || [ ! -f "$golden_rgba" ]; then
    echo "[verify-claude-fullroute-pixel] missing fullroute golden for state=$state" >&2
    exit 1
  fi
  local expected_hash
  expected_hash="$(tr -d '\r\n ' < "$golden_hash")"
  local actual_hash
  actual_hash="$(tr -d '\r\n ' < "$framehash_out")"
  if [ "$expected_hash" != "$actual_hash" ]; then
    echo "[verify-claude-fullroute-pixel] frame hash mismatch state=$state" >&2
    echo "expected=$expected_hash" >&2
    echo "actual=$actual_hash" >&2
    exit 1
  fi
  if ! cmp -s "$golden_rgba" "$frame_rgba_out"; then
    echo "[verify-claude-fullroute-pixel] pixel rgba mismatch state=$state" >&2
    exit 1
  fi
}

run_state_legacy() {
  local state="$1"
  local event_file="$out_dir/events_${state}.txt"
  local snapshot_out="$out_dir/${state}.snapshot.txt"
  local state_out="$out_dir/${state}.state.txt"
  local drawlist_out="$out_dir/${state}.drawlist.txt"
  local framehash_out="$out_dir/${state}.framehash.txt"
  local frame_rgba_out="$out_dir/${state}.rgba.out"
  local route_out="$out_dir/${state}.route.txt"

  write_events_for_state "$state" "$event_file" "$matrix_json"

  if ! run_with_timeout "$app_launch_timeout_sec" env \
    GUI_FORCE_FALLBACK=0 \
    GUI_USE_REAL_MAC=1 \
    R2CAPP_MANIFEST="$manifest_path" \
    R2C_APP_URL="about:blank" \
    R2C_APP_EVENT_SCRIPT="$event_file" \
    R2C_APP_EVENT_MATRIX="$event_file" \
    R2C_APP_ROUTE_STATE="$state" \
    R2C_APP_SNAPSHOT_OUT="$snapshot_out" \
    R2C_APP_STATE_OUT="$state_out" \
    R2C_APP_DRAWLIST_OUT="$drawlist_out" \
    R2C_APP_ROUTE_STATE_OUT="$route_out" \
    R2C_APP_FRAME_HASH_OUT="$framehash_out" \
    R2C_APP_FRAME_RGBA_OUT="$frame_rgba_out" \
    R2C_DESKTOP_AUTOCLOSE_MS="140" \
    "$app_bin" >/dev/null 2>&1; then
    echo "[verify-claude-fullroute-pixel] app run failed state=$state (timeout=${app_launch_timeout_sec}s)" >&2
    exit 1
  fi

  run_state "$state"
}

states_list="$out_dir/fullroute_states.list"
python3 - "$states_json" > "$states_list" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    data = json.load(fh)
for state in data.get("states", []):
    if state:
        print(state)
PY

batch_matrix="$out_dir/fullroute_event_matrix.txt"
: > "$batch_matrix"
while IFS= read -r state; do
  [ -z "$state" ] && continue
  event_file="$out_dir/events_${state}.txt"
  write_events_for_state "$state" "$event_file" "$matrix_json"
  printf '@state %s\n' "$state" >> "$batch_matrix"
  if [ -s "$event_file" ]; then
    cat "$event_file" >> "$batch_matrix"
  fi
  printf '\n' >> "$batch_matrix"
done < "$states_list"

if ! run_with_timeout "$batch_timeout_sec" env \
  GUI_FORCE_FALLBACK=0 \
  GUI_USE_REAL_MAC=1 \
  R2CAPP_MANIFEST="$manifest_path" \
  R2C_STRICT_RUNTIME=1 \
  R2C_APP_URL="about:blank" \
  R2C_APP_EVENT_MATRIX="$batch_matrix" \
  R2C_APP_BATCH_OUT_DIR="$out_dir" \
  R2C_DESKTOP_AUTOCLOSE_MS="1" \
  "$app_bin" >/dev/null 2>&1; then
  echo "[verify-claude-fullroute-pixel] app batch run failed (timeout=${batch_timeout_sec}s)" >&2
  exit 1
fi

route_count=0
while IFS= read -r state; do
  [ -z "$state" ] && continue
  run_state "$state"
  route_count=$((route_count + 1))
done < "$states_list"

if [ "$route_count" -le 0 ]; then
  echo "[verify-claude-fullroute-pixel] route count invalid: $route_count" >&2
  exit 1
fi

if [ "$consistency_runs" -gt 1 ]; then
  baseline_dir="$out_dir/consistency_baseline"
  rm -rf "$baseline_dir"
  mkdir -p "$baseline_dir"
  while IFS= read -r state; do
    [ -z "$state" ] && continue
    cp "$out_dir/${state}.framehash.txt" "$baseline_dir/${state}.framehash.txt"
  done < "$states_list"
  run_idx=2
  while [ "$run_idx" -le "$consistency_runs" ]; do
    if ! run_with_timeout "$batch_timeout_sec" env \
      GUI_FORCE_FALLBACK=0 \
      GUI_USE_REAL_MAC=1 \
      R2CAPP_MANIFEST="$manifest_path" \
      R2C_STRICT_RUNTIME=1 \
      R2C_APP_URL="about:blank" \
      R2C_APP_EVENT_MATRIX="$batch_matrix" \
      R2C_APP_BATCH_OUT_DIR="$out_dir" \
      R2C_DESKTOP_AUTOCLOSE_MS="1" \
      "$app_bin" >/dev/null 2>&1; then
      echo "[verify-claude-fullroute-pixel] consistency batch run failed run=$run_idx (timeout=${batch_timeout_sec}s)" >&2
      exit 1
    fi
    while IFS= read -r state; do
      [ -z "$state" ] && continue
      baseline="$(tr -d '\r\n ' < "$baseline_dir/${state}.framehash.txt")"
      tmp_hash="$out_dir/${state}.framehash.txt"
      if [ ! -f "$tmp_hash" ]; then
        echo "[verify-claude-fullroute-pixel] consistency output missing state=$state run=$run_idx" >&2
        exit 1
      fi
      actual="$(tr -d '\r\n ' < "$tmp_hash")"
      if [ "$actual" != "$baseline" ]; then
        echo "[verify-claude-fullroute-pixel] non-deterministic frame hash state=$state run=$run_idx" >&2
        echo "baseline=$baseline" >&2
        echo "actual=$actual" >&2
        exit 1
      fi
    done < "$states_list"
    run_idx=$((run_idx + 1))
  done
fi

echo "[verify-claude-fullroute-pixel] ok routes=$route_count"
echo "[verify-r2c-strict] no-fallback=true"
echo "[verify-r2c-strict] compiler-rc=0"
