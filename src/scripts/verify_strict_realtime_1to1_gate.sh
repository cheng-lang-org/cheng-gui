#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$ROOT/.." && pwd)"
export GUI_ROOT="$ROOT"

marker_dir="$ROOT/build/strict_realtime_gate"
marker_path="$marker_dir/claude_strict_gate.ok.json"
mkdir -p "$marker_dir"

strict_export() {
  local name="$1"
  local required="$2"
  local current="${!name-}"
  if [ -n "$current" ] && [ "$current" != "$required" ]; then
    echo "[verify-strict-realtime-1to1-gate] strict env violation: $name=$current (expected $required)" >&2
    exit 1
  fi
  export "$name=$required"
}

strict_export R2C_LEGACY_UNIMAKER 0
strict_export R2C_SKIP_COMPILER_RUN 0
strict_export R2C_TRY_COMPILER_FIRST 1
strict_export R2C_REUSE_COMPILER_BIN 0
strict_export R2C_REUSE_RUNTIME_BINS 1
strict_export R2C_REBUILD_DESKTOP 0
strict_export R2C_FORCE_DESKTOP_REBUILD 0
strict_export R2C_STRICT_ALLOW_RUNTIME_BIN_REUSE 1
strict_export R2C_USE_PRECOMPUTED_BATCH 0
strict_export R2C_BATCH_SINGLE_RUN 1
strict_export R2C_FULLROUTE_CONSISTENCY_RUNS 3
strict_export R2C_FULLROUTE_BLESS 0
strict_export R2C_TARGET_MATRIX macos
strict_export R2C_MAX_SEMANTIC_NODES 4000
strict_export R2C_REAL_PROJECT /Users/lbcheng/UniMaker/ClaudeDesign
strict_export R2C_REAL_ENTRY /app/main.tsx
strict_export R2C_REAL_SKIP_DESKTOP_SMOKE 1
strict_export R2C_REAL_SKIP_RUNNER_SMOKE 1
strict_export R2C_RUNTIME_FRONTEND stage1
strict_export R2C_DESKTOP_FRONTEND auto
strict_export R2C_RUNTIME_TEXT_SOURCE project
strict_export R2C_RUNTIME_ROUTE_TITLE_SOURCE project

if [ -z "${R2C_DESKTOP_DRIVER:-}" ]; then
  if [ -n "${BACKEND_DRIVER:-}" ] && [ -x "${BACKEND_DRIVER}" ]; then
    export R2C_DESKTOP_DRIVER="${BACKEND_DRIVER}"
  elif [ -x "/Users/lbcheng/cheng-lang/dist/releases/current/cheng" ]; then
    export R2C_DESKTOP_DRIVER="/Users/lbcheng/cheng-lang/dist/releases/current/cheng"
  elif [ -x "/Users/lbcheng/cheng-lang/dist/releases/2026-02-12T11_25_54Z_2e8781b/cheng" ]; then
    export R2C_DESKTOP_DRIVER="/Users/lbcheng/cheng-lang/dist/releases/2026-02-12T11_25_54Z_2e8781b/cheng"
  elif [ -x "/Users/lbcheng/cheng-lang/dist/releases/2026-02-06T16_08_31Z_a4d11ef/cheng" ]; then
    export R2C_DESKTOP_DRIVER="/Users/lbcheng/cheng-lang/dist/releases/2026-02-06T16_08_31Z_a4d11ef/cheng"
  fi
fi

real_project="${R2C_REAL_PROJECT}"
real_entry="${R2C_REAL_ENTRY}"
if [ ! -d "$real_project" ]; then
  echo "[verify-strict-realtime-1to1-gate] missing project: $real_project" >&2
  exit 1
fi

export STRICT_GATE_CONTEXT=1

status=1
trap 'if [ "$status" != "0" ]; then rm -f "'"$marker_path"'"; fi' EXIT
rm -f "$marker_path"

echo "== strict realtime: r2c real project =="
"$ROOT/scripts/verify_r2c_real_project_closed_loop.sh" --project "$real_project" --entry "$real_entry"

echo "== strict realtime: claude utfzh ime strict =="
"$ROOT/scripts/verify_claude_utfzh_ime_strict.sh"

echo "== strict realtime: claude fullroute visual pixel =="
"$ROOT/scripts/verify_claude_fullroute_visual_pixel.sh"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[verify-strict-realtime-1to1-gate] missing dependency: python3" >&2
  exit 2
fi

git_head="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)"
if [ -z "$git_head" ]; then
  echo "[verify-strict-realtime-1to1-gate] failed to resolve git HEAD" >&2
  exit 1
fi

report_json="$ROOT/build/r2c_real_project_closed_loop/ClaudeDesign/r2capp/r2capp_compile_report.json"
if [ ! -f "$report_json" ]; then
  echo "[verify-strict-realtime-1to1-gate] missing strict compile report: $report_json" >&2
  exit 1
fi

golden_dir="$ROOT/tests/claude_fixture/golden/fullroute"
if [ ! -d "$golden_dir" ]; then
  echo "[verify-strict-realtime-1to1-gate] missing visual golden directory: $golden_dir" >&2
  exit 1
fi

epoch_now="$(date +%s)"
python3 - "$marker_path" "$git_head" "$epoch_now" "$real_project" "$real_entry" "$report_json" "$golden_dir" <<'PY'
import json
import hashlib
import os
import sys

path, git_head, epoch_now, project, entry, report_path, golden_dir = sys.argv[1:8]
report = json.load(open(report_path, "r", encoding="utf-8"))
route_count = int(report.get("full_route_state_count", 0))
pixel_tolerance = int(report.get("pixel_tolerance", 0))
semantic_mode = str(report.get("semantic_mapping_mode", "") or "")
semantic_count = int(report.get("semantic_node_count", 0))
if route_count <= 0:
    raise SystemExit("invalid route_count in report")
if pixel_tolerance != 0:
    raise SystemExit("pixel_tolerance mismatch in report")
if semantic_mode != "source-node-map":
    raise SystemExit("semantic_mapping_mode mismatch in report")
if semantic_count <= 0:
    raise SystemExit("semantic_node_count must be > 0")
required_modes = {
    "utfzh_mode": "strict",
    "ime_mode": "cangwu-global",
    "cjk_render_backend": "native-text-first",
    "cjk_render_gate": "no-garbled-cjk",
}
for key, expected in required_modes.items():
    got = str(report.get(key, "") or "")
    if got != expected:
        raise SystemExit(f"{key} mismatch in report: {got} != {expected}")
semantic_map_path = str(report.get("semantic_node_map_path", "") or "")
if not semantic_map_path or not os.path.isfile(semantic_map_path):
    raise SystemExit("semantic_node_map_path missing in report")
semantic_runtime_map_path = str(report.get("semantic_runtime_map_path", "") or "")
if not semantic_runtime_map_path or not os.path.isfile(semantic_runtime_map_path):
    raise SystemExit("semantic_runtime_map_path missing in report")
semantic_doc = json.load(open(semantic_map_path, "r", encoding="utf-8"))
semantic_runtime_doc = json.load(open(semantic_runtime_map_path, "r", encoding="utf-8"))
semantic_nodes = semantic_doc.get("nodes", [])
semantic_runtime_nodes = semantic_runtime_doc.get("nodes", [])
if not isinstance(semantic_nodes, list) or not isinstance(semantic_runtime_nodes, list):
    raise SystemExit("semantic map nodes invalid")
if len(semantic_nodes) <= 0 or len(semantic_runtime_nodes) <= 0:
    raise SystemExit("semantic map nodes empty")
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
    raise SystemExit("semantic map item type invalid")
if len(set(source_keys)) != len(source_keys):
    raise SystemExit("semantic source node keys are not unique")
if len(set(runtime_keys)) != len(runtime_keys):
    raise SystemExit("semantic runtime node keys are not unique")
if set(source_keys) != set(runtime_keys):
    raise SystemExit("semantic source/runtime node map mismatch")
if semantic_count != len(semantic_nodes):
    raise SystemExit("semantic_node_count mismatch in report")
if str(report.get("route_discovery_mode", "") or "") != "static-runtime-hybrid":
    raise SystemExit("route_discovery_mode mismatch in report")
visual_manifest_path = str(report.get("visual_golden_manifest_path", "") or "")
if not visual_manifest_path or not os.path.isfile(visual_manifest_path):
    raise SystemExit("visual_golden_manifest_path missing in report")
text_profile_path = str(report.get("text_profile_path", "") or "")
if not text_profile_path or not os.path.isfile(text_profile_path):
    raise SystemExit("text_profile_path missing in report")
text_profile = json.load(open(text_profile_path, "r", encoding="utf-8"))
if str(text_profile.get("mode", "") or "") != "project":
    raise SystemExit("text profile mode must be project")
if str(text_profile.get("route_title_mode", "") or "") != "project":
    raise SystemExit("text profile route_title_mode must be project")
if "claude_fixture" in str(text_profile.get("welcome", "") or ""):
    raise SystemExit("text profile welcome still templated")
golden_items = []
for name in sorted(os.listdir(golden_dir)):
    if not (name.endswith(".rgba") or name.endswith(".framehash")):
        continue
    p = os.path.join(golden_dir, name)
    if not os.path.isfile(p):
        continue
    h = hashlib.sha256(open(p, "rb").read()).hexdigest()
    golden_items.append(f"{name}:{h}")
if not golden_items:
    raise SystemExit("missing visual golden files")
golden_hash_manifest = hashlib.sha256("\n".join(golden_items).encode("utf-8")).hexdigest()
strict_flags = {
    "R2C_LEGACY_UNIMAKER": os.environ.get("R2C_LEGACY_UNIMAKER", ""),
    "R2C_SKIP_COMPILER_RUN": os.environ.get("R2C_SKIP_COMPILER_RUN", ""),
    "R2C_TRY_COMPILER_FIRST": os.environ.get("R2C_TRY_COMPILER_FIRST", ""),
    "R2C_REUSE_COMPILER_BIN": os.environ.get("R2C_REUSE_COMPILER_BIN", ""),
    "R2C_REUSE_RUNTIME_BINS": os.environ.get("R2C_REUSE_RUNTIME_BINS", ""),
    "R2C_REBUILD_DESKTOP": os.environ.get("R2C_REBUILD_DESKTOP", ""),
    "R2C_USE_PRECOMPUTED_BATCH": os.environ.get("R2C_USE_PRECOMPUTED_BATCH", ""),
    "R2C_BATCH_SINGLE_RUN": os.environ.get("R2C_BATCH_SINGLE_RUN", ""),
    "R2C_FULLROUTE_CONSISTENCY_RUNS": os.environ.get("R2C_FULLROUTE_CONSISTENCY_RUNS", ""),
    "R2C_FULLROUTE_BLESS": os.environ.get("R2C_FULLROUTE_BLESS", ""),
    "R2C_RUNTIME_TEXT_SOURCE": os.environ.get("R2C_RUNTIME_TEXT_SOURCE", ""),
    "R2C_RUNTIME_ROUTE_TITLE_SOURCE": os.environ.get("R2C_RUNTIME_ROUTE_TITLE_SOURCE", ""),
}
payload = {
    "git_head": git_head,
    "generated_at_epoch": int(epoch_now),
    "project": project,
    "entry": entry,
    "strict_flags": strict_flags,
    "gate_mode": "claude-semantic-visual-1to1",
    "generated_ui_mode": str(report.get("generated_ui_mode", "")),
    "route_discovery_mode": str(report.get("route_discovery_mode", "")),
    "semantic_mapping_mode": semantic_mode,
    "semantic_node_count": semantic_count,
    "semantic_node_map_path": semantic_map_path,
    "semantic_runtime_map_path": semantic_runtime_map_path,
    "utfzh_mode": str(report.get("utfzh_mode", "")),
    "ime_mode": str(report.get("ime_mode", "")),
    "cjk_render_backend": str(report.get("cjk_render_backend", "")),
    "cjk_render_gate": str(report.get("cjk_render_gate", "")),
    "visual_fullroute_routes": route_count,
    "visual_pixel_tolerance": pixel_tolerance,
    "visual_golden_manifest_path": visual_manifest_path,
    "text_profile_path": text_profile_path,
    "visual_golden_hash_manifest": golden_hash_manifest,
    "visual_passed": True,
    "routes": route_count,
    "pixel_tolerance": pixel_tolerance,
}
with open(path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY

status=0
echo "[verify-strict-realtime-1to1-gate] ok"
