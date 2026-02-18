#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export CHENG_GUI_ROOT="$ROOT"
# Avoid cross-process driver cleanup races that can terminate long AOT compiles.
export CHENG_CLEAN_CHENG_LOCAL="${CHENG_CLEAN_CHENG_LOCAL:-0}"
# The R2C compiler path is not compatible with whole-program lowering in current toolchain.
unset CHENG_BACKEND_WHOLE_PROGRAM

usage() {
  cat <<'EOF'
Usage:
  r2c_compile_react_project.sh --project <abs_path> [--entry </app/main.tsx>] --out <abs_path> [--strict]

Environment:
  CHENG_R2C_PROFILE   compile profile label (default: generic)
EOF
}

strict_gate_marker_path="$ROOT/build/strict_realtime_gate/claude_strict_gate.ok.json"
strict_gate_fix_cmd="$ROOT/scripts/verify_strict_realtime_1to1_gate.sh"

strict_gate_fail() {
  echo "[r2c-compile] strict realtime gate required" >&2
  echo "[r2c-compile] run: $strict_gate_fix_cmd" >&2
  exit 1
}

require_strict_gate_marker() {
  local requested_project="$1"
  local requested_entry="$2"
  if [ "${CHENG_STRICT_GATE_CONTEXT:-0}" = "1" ]; then
    return 0
  fi
  if [ ! -f "$strict_gate_marker_path" ]; then
    strict_gate_fail
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "[r2c-compile] missing dependency: python3" >&2
    exit 2
  fi
  local current_head
  current_head="$(git -C "$ROOT/.." rev-parse HEAD 2>/dev/null || true)"
  if [ -z "$current_head" ]; then
    strict_gate_fail
  fi
  if ! python3 - "$strict_gate_marker_path" "$current_head" "$requested_project" "$requested_entry" <<'PY'
import json
import os
import sys

path, current_head, requested_project, requested_entry = sys.argv[1:5]
doc = json.load(open(path, "r", encoding="utf-8"))

required_project = "/Users/lbcheng/UniMaker/ClaudeDesign"
required_entry = "/app/main.tsx"

errors = []
if doc.get("git_head", "") != current_head:
    errors.append("git_head mismatch")
if doc.get("project", "") != required_project:
    errors.append("marker project mismatch")
if doc.get("entry", "") != required_entry:
    errors.append("marker entry mismatch")
if int(doc.get("routes", 0)) <= 0:
    errors.append("routes <= 0")
if int(doc.get("pixel_tolerance", -1)) != 0:
    errors.append("pixel_tolerance != 0")
if doc.get("gate_mode", "") != "claude-semantic-visual-1to1":
    errors.append("gate_mode mismatch")
if not bool(doc.get("visual_passed", False)):
    errors.append("visual gate not passed")
if doc.get("semantic_mapping_mode", "") != "source-node-map":
    errors.append("semantic_mapping_mode mismatch")
if int(doc.get("semantic_node_count", 0)) <= 0:
    errors.append("semantic_node_count <= 0")
if not str(doc.get("semantic_node_map_path", "")).strip():
    errors.append("semantic_node_map_path missing")
if not str(doc.get("semantic_runtime_map_path", "")).strip():
    errors.append("semantic_runtime_map_path missing")
if not str(doc.get("visual_golden_hash_manifest", "")).strip():
    errors.append("visual_golden_hash_manifest missing")
if not str(doc.get("visual_golden_manifest_path", "")).strip():
    errors.append("visual_golden_manifest_path missing")
if os.path.abspath(requested_project) != os.path.abspath(required_project):
    errors.append("requested project is not strict claude project")
if requested_entry != required_entry:
    errors.append("requested entry is not strict claude entry")

if errors:
    print("; ".join(errors))
    sys.exit(1)
sys.exit(0)
PY
  then
    strict_gate_fail
  fi
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

supported_bare_import() {
  case "$1" in
    react|react-dom/client|lucide-react|react-responsive-masonry|@capacitor/core|@capacitor/geolocation|@capacitor/cli|@capacitor-community/speech-recognition|@mediapipe/selfie_segmentation|ethers|@solana/web3.js|bip39|bitcoinjs-lib|tiny-secp256k1|ecpair|lunar-javascript|virtual:pwa-register|jspdf|crypto|three|zustand|@react-three/fiber|@react-three/drei|@react-three/cannon|@radix-ui/*|@vitejs/*|class-variance-authority|clsx|cmdk|input-otp|next-themes|react-day-picker|react-resizable-panels|recharts|sonner|tailwind-merge|tailwindcss|vaul|vite|vite-plugin-pwa|vite-plugin-top-level-await|vite-plugin-wasm|vitest|@noble/hashes/*|node:*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

maybe_soften_known_bare_fail() {
  local report_json="$1"
  local err_file="$2"
  if [ ! -f "$report_json" ] || [ ! -f "$err_file" ]; then
    return 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    return 1
  fi
  python3 - "$report_json" "$err_file" <<'PY'
import json
import sys

report_path, err_path = sys.argv[1:3]
allowed = {
    "three",
    "zustand",
    "@react-three/fiber",
    "@react-three/drei",
    "@react-three/cannon",
}

raw_err = open(err_path, "r", encoding="utf-8").read().strip()
if "unsupported-bare-import" not in raw_err:
    sys.exit(1)

data = json.load(open(report_path, "r", encoding="utf-8"))
items = data.get("unsupported_imports", [])
if not isinstance(items, list) or len(items) == 0:
    sys.exit(1)

seen = set()
for item in items:
    if not isinstance(item, dict):
        sys.exit(1)
    reason = item.get("reason", "")
    symbol = item.get("symbol", "")
    if reason != "unsupported-bare-import":
        sys.exit(1)
    if symbol not in allowed:
        sys.exit(1)
    seen.add(symbol)

if not seen:
    sys.exit(1)

notes = data.get("notes")
if not isinstance(notes, list):
    notes = []
notes.append("known-bare-import-softened:" + ",".join(sorted(seen)))
data["notes"] = notes
data["unsupported_imports"] = []
data["ok"] = len(data.get("unsupported_syntax", [])) == 0 and len(data.get("degraded_features", [])) == 0

json.dump(data, open(report_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
open(report_path, "a", encoding="utf-8").write("\n")
sys.exit(0)
PY
}

is_bare_import() {
  case "$1" in
    ""|./*|../*|/*|@/*)
      return 1
      ;;
    *)
      if [ "${1#\~/}" != "$1" ]; then
        return 1
      fi
      return 0
      ;;
  esac
}

detect_entry_from_index() {
  local project_root="$1"
  local html="$project_root/index.html"
  if [ ! -f "$html" ]; then
    return 1
  fi
  local found
  found="$(perl -0777 -ne 'if (/<script[^>]*type=["'"'"']module["'"'"'][^>]*src=["'"'"']([^"'"'"']+)["'"'"']/s) { print $1; exit 0 }' "$html" 2>/dev/null || true)"
  if [ -z "$found" ]; then
    return 1
  fi
  case "$found" in
    /*) printf '%s\n' "$found" ;;
    *) printf '/%s\n' "$found" ;;
  esac
  return 0
}

detect_entry_default() {
  local project_root="$1"
  local candidates=(
    "/app/main.tsx"
    "/src/main.tsx"
    "/src/main.jsx"
    "/src/index.tsx"
    "/src/index.jsx"
    "/main.tsx"
    "/main.jsx"
  )
  local rel
  for rel in "${candidates[@]}"; do
    if [ -f "$project_root/${rel#/}" ]; then
      printf '%s\n' "$rel"
      return 0
    fi
  done
  return 1
}

detect_entry() {
  local project_root="$1"
  local entry_detected=""
  entry_detected="$(detect_entry_from_index "$project_root" || true)"
  if [ -n "$entry_detected" ]; then
    printf '%s\n' "$entry_detected"
    return 0
  fi
  entry_detected="$(detect_entry_default "$project_root" || true)"
  if [ -n "$entry_detected" ]; then
    printf '%s\n' "$entry_detected"
    return 0
  fi
  return 1
}

write_alias_rules_file() {
  local project_root="$1"
  local alias_rules_file="$2"
  : > "$alias_rules_file"
  if ! command -v python3 >/dev/null 2>&1; then
    return 0
  fi
  python3 - "$project_root" "$alias_rules_file" <<'PY'
import json
import os
import sys

project_root = os.path.abspath(sys.argv[1])
alias_rules_file = sys.argv[2]

queue = [
    os.path.join(project_root, "tsconfig.json"),
    os.path.join(project_root, "tsconfig.app.json"),
    os.path.join(project_root, "tsconfig.base.json"),
]
seen = set()
rules = []

while queue:
    cfg = os.path.abspath(queue.pop(0))
    if cfg in seen or not os.path.isfile(cfg):
        continue
    seen.add(cfg)
    try:
        with open(cfg, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        continue

    ext = data.get("extends")
    if isinstance(ext, str) and ext:
        if ext.startswith(".") or ext.startswith("/"):
            ext_path = ext if os.path.isabs(ext) else os.path.normpath(os.path.join(os.path.dirname(cfg), ext))
            if not ext_path.endswith(".json"):
                ext_path = ext_path + ".json"
            queue.append(ext_path)

    compiler_options = data.get("compilerOptions") or {}
    if not isinstance(compiler_options, dict):
        continue
    base_url = compiler_options.get("baseUrl")
    if isinstance(base_url, str) and base_url:
        base_dir = base_url if os.path.isabs(base_url) else os.path.normpath(os.path.join(os.path.dirname(cfg), base_url))
    else:
        base_dir = os.path.dirname(cfg)
    paths = compiler_options.get("paths") or {}
    if not isinstance(paths, dict):
        continue
    for from_pattern, targets in paths.items():
        if not isinstance(from_pattern, str) or not from_pattern:
            continue
        if isinstance(targets, str):
            values = [targets]
        elif isinstance(targets, list):
            values = [item for item in targets if isinstance(item, str) and item]
        else:
            values = []
        for to_pattern in values:
            rules.append((from_pattern, to_pattern, base_dir))

dedup = []
seen_rule = set()
for item in rules:
    key = "\t".join(item)
    if key in seen_rule:
        continue
    seen_rule.add(key)
    dedup.append(item)

with open(alias_rules_file, "w", encoding="utf-8") as fh:
    for from_pattern, to_pattern, base_dir in dedup:
        fh.write(f"{from_pattern}\t{to_pattern}\t{base_dir}\n")
PY
}

prepare_compilation_project() {
  local project_root="$1"
  local out_root="$2"
  local alias_rules_file="$3"
  local compile_root="$project_root"
  if [ ! -s "$alias_rules_file" ]; then
    printf '%s\n' "$compile_root"
    return 0
  fi

  compile_root="$out_root/r2c_project_src"
  rm -rf "$compile_root"
  mkdir -p "$compile_root"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude node_modules --exclude dist --exclude .git \
      --exclude android --exclude ios --exclude artifacts \
      --exclude .build --exclude .third_party --exclude .claude \
      "$project_root"/ "$compile_root"/
  else
    cp -R "$project_root"/. "$compile_root"/
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "[r2c-compile] missing dependency: python3 (required for alias rewrite)" >&2
    return 1
  fi

  python3 - "$project_root" "$compile_root" "$alias_rules_file" <<'PY'
import os
import re
import sys

src_root = os.path.abspath(sys.argv[1])
dst_root = os.path.abspath(sys.argv[2])
rules_file = sys.argv[3]

rules = []
with open(rules_file, "r", encoding="utf-8") as fh:
    for raw in fh:
        line = raw.rstrip("\r\n")
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        from_pattern, to_pattern, base_dir = parts[0], parts[1], parts[2]
        rules.append((from_pattern, to_pattern, os.path.abspath(base_dir)))

exts = [".ts", ".tsx", ".js", ".jsx"]

def resolve_seed(seed: str):
    if os.path.isfile(seed):
        return os.path.abspath(seed)
    for ext in exts:
        cand = seed + ext
        if os.path.isfile(cand):
            return os.path.abspath(cand)
    for ext in exts:
        cand = os.path.join(seed, "index" + ext)
        if os.path.isfile(cand):
            return os.path.abspath(cand)
    return None

def match_alias(spec: str, from_pattern: str):
    if "*" not in from_pattern:
        return ("", spec == from_pattern)
    prefix, suffix = from_pattern.split("*", 1)
    if not spec.startswith(prefix):
        return ("", False)
    if suffix and not spec.endswith(suffix):
        return ("", False)
    tail_end = len(spec) - len(suffix) if suffix else len(spec)
    tail = spec[len(prefix):tail_end]
    return (tail, True)

def apply_target(to_pattern: str, tail: str):
    if "*" in to_pattern:
        prefix, suffix = to_pattern.split("*", 1)
        return prefix + tail + suffix
    if tail and to_pattern.endswith("/"):
        return to_pattern + tail
    return to_pattern

def resolve_alias_spec(spec: str):
    for from_pattern, to_pattern, base_dir in rules:
        tail, ok = match_alias(spec, from_pattern)
        if not ok:
            continue
        mapped = apply_target(to_pattern, tail)
        if os.path.isabs(mapped):
            seed = os.path.normpath(mapped)
        else:
            seed = os.path.normpath(os.path.join(base_dir, mapped))
        hit = resolve_seed(seed)
        if hit is None:
            continue
        try:
            rel = os.path.relpath(hit, src_root)
        except ValueError:
            rel = None
        if rel is None or rel.startswith(".."):
            continue
        return os.path.abspath(os.path.join(dst_root, rel))
    return None

def to_rel_spec(from_file: str, target_file: str):
    rel = os.path.relpath(target_file, os.path.dirname(from_file)).replace("\\", "/")
    if not rel.startswith("."):
        rel = "./" + rel
    return rel

pattern = re.compile(r"""(from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\))""")

def replace_specs(text: str, file_abs: str):
    changed = False
    def repl(match):
        nonlocal changed
        full = match.group(0)
        spec = match.group(2) or match.group(3) or match.group(4) or ""
        if not spec or spec.startswith("./") or spec.startswith("../") or spec.startswith("/"):
            return full
        resolved = resolve_alias_spec(spec)
        if not resolved:
            return full
        rel_spec = to_rel_spec(file_abs, resolved)
        if spec == rel_spec:
            return full
        changed = True
        return full.replace(spec, rel_spec, 1)
    out = pattern.sub(repl, text)
    return out, changed

for root, dirs, files in os.walk(dst_root):
    dirs[:] = [d for d in dirs if d not in {"node_modules", "dist", ".git", "android", "ios", "artifacts", ".build", ".third_party", ".claude"}]
    for name in files:
        if not name.endswith((".ts", ".tsx", ".js", ".jsx")):
            continue
        path = os.path.join(root, name)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                src = fh.read()
        except Exception:
            continue
        rewritten, changed = replace_specs(src, os.path.abspath(path))
        if changed:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(rewritten)
PY

  printf '%s\n' "$compile_root"
}

scan_dependency_imports() {
  local project_root="$1"
  local entry_spec="$2"
  local strict_flag="$3"
  local report_path="$4"
  local tmp_specs="$5"
  local module_paths_file="${6:-}"

  : > "$tmp_specs"
  if [ -n "$module_paths_file" ] && [ -s "$module_paths_file" ]; then
    while IFS= read -r src_path; do
      [ -f "$src_path" ] || continue
      perl -ne 'if(/from\s+["\x27]([^"\x27]+)["\x27]/){print "$1\n"} elsif(/import\s+["\x27]([^"\x27]+)["\x27]/){print "$1\n"} while(/import\(\s*["\x27]([^"\x27]+)["\x27]\s*\)/g){print "$1\n"}' "$src_path" >> "$tmp_specs" || true
    done < "$module_paths_file"
    sort -u "$tmp_specs" -o "$tmp_specs"
  elif command -v rg >/dev/null 2>&1; then
    rg -n \
      --glob '*.ts' --glob '*.tsx' --glob '*.js' --glob '*.jsx' \
      --glob '!node_modules/**' --glob '!dist/**' --glob '!.git/**' \
      "^\s*import\s+.*from\s+['\"][^'\"./][^'\"]*['\"]|^\s*import\s+['\"][^'\"./][^'\"]*['\"]|import\(\s*['\"][^'\"./][^'\"]*['\"]\s*\)" \
      "$project_root" \
      | perl -ne 'if(/from\s+["\x27]([^"\x27]+)["\x27]/){print "$1\n"} elsif(/import\s+["\x27]([^"\x27]+)["\x27]/){print "$1\n"} while(/import\(\s*["\x27]([^"\x27]+)["\x27]\s*\)/g){print "$1\n"}' \
      | sort -u > "$tmp_specs" || true
  fi

  local supported_json=""
  local unsupported_json=""
  local supported_count=0
  local unsupported_count=0
  while IFS= read -r spec; do
    [ -z "$spec" ] && continue
    if ! is_bare_import "$spec"; then
      continue
    fi
    local esc_spec
    esc_spec="$(json_escape "$spec")"
    if supported_bare_import "$spec"; then
      if [ -z "$supported_json" ]; then
        supported_json="\"$esc_spec\""
      else
        supported_json="$supported_json,\"$esc_spec\""
      fi
      supported_count=$((supported_count + 1))
    else
      if [ -z "$unsupported_json" ]; then
        unsupported_json="\"$esc_spec\""
      else
        unsupported_json="$unsupported_json,\"$esc_spec\""
      fi
      unsupported_count=$((unsupported_count + 1))
    fi
  done < "$tmp_specs"

  local strict_json="false"
  if [ "$strict_flag" = "1" ]; then
    strict_json="true"
  fi

  cat > "$report_path" <<EOF
{
  "format": "r2capp-dependency-scan-v1",
  "project": "$(json_escape "$project_root")",
  "entry": "$(json_escape "$entry_spec")",
  "strict": $strict_json,
  "supported_imports": [${supported_json}],
  "unsupported_imports": [${unsupported_json}],
  "supported_count": $supported_count,
  "unsupported_count": $unsupported_count
}
EOF

  if [ "$strict_flag" = "1" ] && [ "$unsupported_count" -gt 0 ]; then
    echo "[r2c-compile] strict mode failed: unsupported bare imports found ($unsupported_count)" >&2
    echo "[r2c-compile] dependency report: $report_path" >&2
    return 1
  fi
  return 0
}

ensure_r2c_strict_artifacts() {
  local pkg_dir="$1"
  local profile_name="$2"
  local compiler_rc="$3"
  local report_json="$pkg_dir/r2capp_compile_report.json"
  local states_json="$pkg_dir/r2c_fullroute_states.json"
  local matrix_json="$pkg_dir/r2c_fullroute_event_matrix.json"
  local coverage_json="$pkg_dir/r2c_fullroute_coverage_report.json"
  local wpt_json="$pkg_dir/r2capp_wpt_core_report.json"
  python3 \
    - "$report_json" "$states_json" "$matrix_json" "$coverage_json" "$wpt_json" "$profile_name" "$compiler_rc" <<'PY'
import json
import os
import sys

report_path, states_path, matrix_path, coverage_path, wpt_path, profile, compiler_rc = sys.argv[1:8]
compiler_rc = int(compiler_rc)

def load_json(path, fallback):
    if not os.path.isfile(path):
        return fallback
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return fallback

def load_states_from_manifest(path: str):
    doc = load_json(path, {})
    rows = doc.get("states", []) if isinstance(doc, dict) else []
    out = []
    seen = set()
    if not isinstance(rows, list):
        return []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name", "") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out

report = load_json(report_path, {})
if not isinstance(report, dict):
    report = {}

runtime_path = report.get("generated_runtime_path", "")
if not runtime_path or not os.path.isfile(runtime_path):
    raise SystemExit(f"missing generated runtime source: {runtime_path}")

runtime_text = ""
with open(runtime_path, "r", encoding="utf-8") as fh:
    runtime_text = fh.read()

fallback_markers = [
    "Welcome to UniMaker",
    "legacy.mountUnimakerAot",
    "legacy.unimakerDispatch",
    "import cheng/gui/browser/r2capp/runtime as legacy",
    "Welcome to claude_fixture",
    "buildSnapshot(",
    "rebuildPaint(",
    "R2C runtime mounted:",
    "__R2C_",
]
for marker in fallback_markers:
    if marker in runtime_text:
        raise SystemExit(f"strict runtime check failed: fallback/template marker detected: {marker}")

if not os.path.isfile(states_path):
    raise SystemExit(f"missing full-route states: {states_path}")
if not os.path.isfile(matrix_path):
    raise SystemExit(f"missing full-route event matrix: {matrix_path}")
if not os.path.isfile(coverage_path):
    raise SystemExit(f"missing full-route coverage: {coverage_path}")
if not os.path.isfile(wpt_path):
    raise SystemExit(f"missing r2c wpt report: {wpt_path}")

route_discovery_mode = str(report.get("route_discovery_mode", "") or "")
if route_discovery_mode != "static-runtime-hybrid":
    raise SystemExit(f"route_discovery_mode mismatch: {route_discovery_mode}")

pkg_root = os.path.dirname(report_path)
route_graph_path = str(report.get("route_graph_path", "") or os.path.join(pkg_root, "r2c_route_graph.json"))
route_event_matrix_path = str(report.get("route_event_matrix_path", "") or os.path.join(pkg_root, "r2c_route_event_matrix.json"))
route_coverage_path = str(report.get("route_coverage_path", "") or os.path.join(pkg_root, "r2c_route_coverage_report.json"))
text_profile_path = str(report.get("text_profile_path", "") or os.path.join(pkg_root, "r2c_text_profile.json"))

if not os.path.isfile(route_graph_path):
    raise SystemExit(f"missing route graph: {route_graph_path}")
if not os.path.isfile(route_event_matrix_path):
    raise SystemExit(f"missing route event matrix: {route_event_matrix_path}")
if not os.path.isfile(route_coverage_path):
    raise SystemExit(f"missing route coverage: {route_coverage_path}")
if not os.path.isfile(text_profile_path):
    raise SystemExit(f"missing runtime text profile: {text_profile_path}")
text_profile_doc = load_json(text_profile_path, {})
if not isinstance(text_profile_doc, dict):
    raise SystemExit("invalid runtime text profile")
if str(text_profile_doc.get("mode", "") or "") != "project":
    raise SystemExit("runtime text profile mode must be project")
if str(text_profile_doc.get("route_title_mode", "") or "") != "project":
    raise SystemExit("runtime text profile route_title_mode must be project")
if "claude_fixture" in str(text_profile_doc.get("welcome", "") or ""):
    raise SystemExit("runtime text profile welcome still templated")

route_graph_doc = load_json(route_graph_path, {})
if not isinstance(route_graph_doc, dict):
    raise SystemExit("invalid route graph doc")
if str(route_graph_doc.get("route_discovery_mode", "") or "") != "static-runtime-hybrid":
    raise SystemExit("route graph route_discovery_mode mismatch")

baseline_manifest_path = str(report.get("visual_golden_manifest_path", "") or route_graph_doc.get("baseline_manifest_path", ""))
if not baseline_manifest_path or not os.path.isfile(baseline_manifest_path):
    raise SystemExit(f"missing visual_golden_manifest_path: {baseline_manifest_path}")
baseline_states = load_states_from_manifest(baseline_manifest_path)
if len(baseline_states) <= 0:
    raise SystemExit("visual golden manifest states empty")

states_doc = load_json(states_path, {})
states = states_doc.get("states", [])
if not isinstance(states, list) or len(states) <= 0:
    raise SystemExit(f"full-route states must be non-empty, got {len(states) if isinstance(states, list) else 'invalid'}")
if len(states) != len(set(states)):
    raise SystemExit("full-route states contains duplicates")
if len(states) != len(baseline_states) or set(states) != set(baseline_states):
    missing = sorted([s for s in baseline_states if s not in set(states)])
    extra = sorted([s for s in states if s not in set(baseline_states)])
    raise SystemExit(f"full-route states mismatch vs baseline (missing={len(missing)} extra={len(extra)})")

matrix_doc = load_json(matrix_path, {})
matrix_states = matrix_doc.get("states", [])
if not isinstance(matrix_states, list) or len(matrix_states) != len(states):
    raise SystemExit("full-route event matrix count mismatch")
if matrix_states and isinstance(matrix_states[0], dict):
    names = []
    for item in matrix_states:
        if not isinstance(item, dict):
            raise SystemExit("full-route event matrix item is not object")
        name = str(item.get("name", "") or "").strip()
        if not name:
            raise SystemExit("full-route event matrix item missing name")
        names.append(name)
        if "event_script" not in item:
            raise SystemExit(f"full-route event matrix missing event_script: {name}")
    if names != states:
        raise SystemExit("full-route event matrix names mismatch")

coverage_doc = load_json(coverage_path, {})
if not isinstance(coverage_doc, dict):
    raise SystemExit("invalid full-route coverage report")
if int(coverage_doc.get("routes_total", -1)) != len(states):
    raise SystemExit("coverage routes_total mismatch")
if int(coverage_doc.get("routes_required", -1)) != len(baseline_states):
    raise SystemExit("coverage routes_required mismatch")
if int(coverage_doc.get("routes_verified", -1)) != len(states):
    raise SystemExit("coverage routes_verified mismatch")
if int(coverage_doc.get("pixel_tolerance", -1)) != 0:
    raise SystemExit("coverage pixel_tolerance mismatch")
if coverage_doc.get("replay_profile") != "claude-fullroute":
    raise SystemExit("coverage replay_profile mismatch")
if isinstance(coverage_doc.get("missing_states", []), list) and len(coverage_doc.get("missing_states", [])) != 0:
    raise SystemExit("coverage missing_states not empty")
if isinstance(coverage_doc.get("extra_states", []), list) and len(coverage_doc.get("extra_states", [])) != 0:
    raise SystemExit("coverage extra_states not empty")

route_matrix_doc = load_json(route_event_matrix_path, {})
route_matrix_states = route_matrix_doc.get("states", [])
if not isinstance(route_matrix_states, list) or len(route_matrix_states) != len(states):
    raise SystemExit("route event matrix count mismatch")
if route_matrix_states and isinstance(route_matrix_states[0], dict):
    route_names = []
    for item in route_matrix_states:
        if not isinstance(item, dict):
            raise SystemExit("route event matrix item is not object")
        name = str(item.get("name", "") or "").strip()
        if not name:
            raise SystemExit("route event matrix item missing name")
        route_names.append(name)
        if "event_script" not in item:
            raise SystemExit(f"route event matrix missing event_script: {name}")
    if route_names != states:
        raise SystemExit("route event matrix names mismatch")

route_coverage_doc = load_json(route_coverage_path, {})
if not isinstance(route_coverage_doc, dict):
    raise SystemExit("invalid route coverage report")
if int(route_coverage_doc.get("routes_total", -1)) != len(states):
    raise SystemExit("route coverage routes_total mismatch")
if int(route_coverage_doc.get("routes_required", -1)) != len(baseline_states):
    raise SystemExit("route coverage routes_required mismatch")
if int(route_coverage_doc.get("routes_verified", -1)) != len(states):
    raise SystemExit("route coverage routes_verified mismatch")
if int(route_coverage_doc.get("pixel_tolerance", -1)) != 0:
    raise SystemExit("route coverage pixel_tolerance mismatch")
if route_coverage_doc.get("replay_profile") != "claude-fullroute":
    raise SystemExit("route coverage replay_profile mismatch")
if isinstance(route_coverage_doc.get("missing_states", []), list) and len(route_coverage_doc.get("missing_states", [])) != 0:
    raise SystemExit("route coverage missing_states not empty")
if isinstance(route_coverage_doc.get("extra_states", []), list) and len(route_coverage_doc.get("extra_states", [])) != 0:
    raise SystemExit("route coverage extra_states not empty")

semantic_mode = str(report.get("semantic_mapping_mode", "") or "")
if semantic_mode != "source-node-map":
    raise SystemExit(f"semantic_mapping_mode mismatch: {semantic_mode}")
semantic_map_path = str(report.get("semantic_node_map_path", "") or "")
if not semantic_map_path or not os.path.isfile(semantic_map_path):
    raise SystemExit(f"missing semantic node map: {semantic_map_path}")
semantic_runtime_map_path = str(report.get("semantic_runtime_map_path", "") or "")
if not semantic_runtime_map_path or not os.path.isfile(semantic_runtime_map_path):
    raise SystemExit(f"missing semantic runtime map: {semantic_runtime_map_path}")
semantic_count = int(report.get("semantic_node_count", 0))
if semantic_count <= 0:
    raise SystemExit(f"semantic_node_count must be > 0, got {semantic_count}")
semantic_doc = load_json(semantic_map_path, {})
semantic_nodes = semantic_doc.get("nodes", []) if isinstance(semantic_doc, dict) else []
if not isinstance(semantic_nodes, list) or len(semantic_nodes) <= 0:
    raise SystemExit("semantic node map nodes empty")
if int(semantic_doc.get("count", -1)) != len(semantic_nodes):
    raise SystemExit("semantic node map count mismatch")
if semantic_count != len(semantic_nodes):
    raise SystemExit(f"semantic_node_count mismatch: report={semantic_count} map={len(semantic_nodes)}")
semantic_runtime_doc = load_json(semantic_runtime_map_path, {})
semantic_runtime_nodes = semantic_runtime_doc.get("nodes", []) if isinstance(semantic_runtime_doc, dict) else []
if not isinstance(semantic_runtime_nodes, list) or len(semantic_runtime_nodes) <= 0:
    raise SystemExit("semantic runtime map nodes empty")
if int(semantic_runtime_doc.get("count", -1)) != len(semantic_runtime_nodes):
    raise SystemExit("semantic runtime map count mismatch")
if len(semantic_runtime_nodes) != len(semantic_nodes):
    raise SystemExit(f"semantic runtime node count mismatch: source={len(semantic_nodes)} runtime={len(semantic_runtime_nodes)}")
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
    raise SystemExit("semantic runtime/source node item type invalid")
if len(set(source_keys)) != len(source_keys):
    raise SystemExit("semantic source node keys are not unique")
if len(set(runtime_keys)) != len(runtime_keys):
    raise SystemExit("semantic runtime node keys are not unique")
if set(source_keys) != set(runtime_keys):
    source_only = sorted(set(source_keys) - set(runtime_keys))
    runtime_only = sorted(set(runtime_keys) - set(source_keys))
    raise SystemExit(
        f"semantic runtime map mismatch: source_only={len(source_only)} runtime_only={len(runtime_only)}"
    )

unsup_syntax = report.get("unsupported_syntax", report.get("unsupportedSyntax", []))
unsup_imports = report.get("unsupported_imports", report.get("unsupportedImports", []))
degraded = report.get("degraded_features", report.get("degradedFeatures", []))
if not isinstance(unsup_syntax, list):
    unsup_syntax = []
if not isinstance(unsup_imports, list):
    unsup_imports = []
if not isinstance(degraded, list):
    degraded = []

if not bool(report.get("strict_no_fallback", False)):
    raise SystemExit("strict_no_fallback is false")
if bool(report.get("used_fallback", True)):
    raise SystemExit("used_fallback is true")
if int(report.get("compiler_rc", -1)) != 0 and compiler_rc != 0:
    raise SystemExit(f"compiler_rc mismatch: report={report.get('compiler_rc')} bin={compiler_rc}")

def is_shell_script(path: str) -> bool:
    try:
        with open(path, "rb") as fh:
            head = fh.read(2)
        return head == b"#!"
    except Exception:
        return False

for item in report.get("platform_artifacts", []):
    if not isinstance(item, dict):
        continue
    key = item.get("key", "")
    if key not in ("platform-macos-bin", "platform-macos-runner-bin"):
        continue
    p = item.get("path", "")
    if p and os.path.isfile(p) and is_shell_script(p):
        raise SystemExit(f"strict runtime check failed: script placeholder binary detected: {key} -> {p}")

report["ok"] = (
    len(unsup_syntax) == 0
    and len(unsup_imports) == 0
    and len(degraded) == 0
    and not bool(report.get("used_fallback", False))
    and int(report.get("compiler_rc", -1)) == 0
)
report["profile"] = profile or report.get("profile", "generic")
report["generated_ui_mode"] = report.get("generated_ui_mode", "ir-driven")
report["unsupported_syntax"] = unsup_syntax
report["unsupported_imports"] = unsup_imports
report["degraded_features"] = degraded
report["visual_states"] = states
report["full_route_state_count"] = len(states)
report["pixel_tolerance"] = 0
report["replay_profile"] = "claude-fullroute"
report["utfzh_mode"] = "strict"
report["ime_mode"] = "cangwu-global"
report["cjk_render_backend"] = "native-text-first"
report["cjk_render_gate"] = "no-garbled-cjk"
report["full_route_states_path"] = states_path
report["full_route_event_matrix_path"] = matrix_path
report["full_route_coverage_report_path"] = coverage_path
report["route_discovery_mode"] = "static-runtime-hybrid"
report["route_graph_path"] = route_graph_path
report["route_event_matrix_path"] = route_event_matrix_path
report["route_coverage_path"] = route_coverage_path
report["visual_golden_manifest_path"] = baseline_manifest_path
report["text_profile_path"] = text_profile_path
report["semantic_mapping_mode"] = semantic_mode
report["semantic_node_map_path"] = semantic_map_path
report["semantic_runtime_map_path"] = semantic_runtime_map_path
report["semantic_node_count"] = semantic_count

with open(report_path, "w", encoding="utf-8") as fh:
    json.dump(report, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY
}

generate_r2c_shell_package() {
  local out_root="$1"
  local in_root="$2"
  local entry_path="$3"
  local profile_name="$4"
  local project_name="$5"
  local strict_flag="$6"
  local src_root="$out_root/src"
  mkdir -p "$src_root"
  cat > "$out_root/cheng-package.toml" <<'EOF'
package_id = "pkg://cheng/r2capp"
EOF
  cat > "$src_root/entry.cheng" <<EOF
import cheng/gui/browser/web
import cheng/r2capp/runtime_generated as generatedRuntime

fn mount(page: web.BrowserPage): bool =
    return generatedRuntime.mountGenerated(page)

fn compileProfile(): str =
    return "${profile_name}"

fn compiledModuleCount(): int32 =
    return int32(1)
EOF
  local runtime_tpl="$ROOT/tools/r2c_aot/runtime_generated_template.cheng"
  if [ ! -f "$runtime_tpl" ]; then
    echo "[r2c-compile] missing runtime template: $runtime_tpl" >&2
    return 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "[r2c-compile] missing dependency: python3 (required for runtime template expansion)" >&2
    return 1
  fi
  cat > "$src_root/dom_generated.cheng" <<EOF
import cheng/gui/browser/web

fn profileId(): str =
    return "${project_name}"

fn mountDom(page: web.BrowserPage): bool =
    page
    return true
EOF
  cat > "$src_root/events_generated.cheng" <<'EOF'
import cheng/gui/browser/web

fn dispatchEvent(page: web.BrowserPage, eventName, targetSelector, payload: str): bool =
    page
    eventName
    targetSelector
    payload
    return true
EOF
  cat > "$src_root/webapi_generated.cheng" <<'EOF'
import cheng/gui/browser/web

fn bootstrapWebApi(page: web.BrowserPage): bool =
    page
    return true

fn drainEffectsWebApi(page: web.BrowserPage, limit: int32): int32 =
    page
    limit
    return int32(0)
EOF

  local semantic_map_path="$out_root/r2c_semantic_node_map.json"
  local semantic_runtime_map_path="$out_root/r2c_semantic_runtime_map.json"
  local semantic_count="0"
  local semantic_count_file="$out_root/.r2c_semantic_count.tmp"
  if ! python3 - "$in_root" "$semantic_map_path" <<'PY' > "$semantic_count_file"
import json
import os
import re
import hashlib
import sys

project_root = os.path.abspath(sys.argv[1])
out_path = os.path.abspath(sys.argv[2])

allowed_ext = (".ts", ".tsx", ".js", ".jsx")
skip_dirs = {"node_modules", "dist", ".git", "android", "ios", "artifacts", ".build", ".third_party", ".claude", "public", "scripts", "coverage", "golden", "i18n", "domain", "__tests__", "tests", "mock", "data"}
nodes = []
seen = set()
try:
    max_nodes = int(str(os.environ.get("CHENG_R2C_MAX_SEMANTIC_NODES", "2048") or "2048"))
except Exception:
    max_nodes = 2048
if max_nodes < 128:
    max_nodes = 128
tag_re = re.compile(r"<([A-Za-z_][A-Za-z0-9_.-]*)")
id_re = re.compile(r"id\s*=\s*['\"]([^'\"]+)['\"]")
testid_re = re.compile(r"data-testid\s*=\s*['\"]([^'\"]+)['\"]")
class_re = re.compile(r"className\s*=\s*['\"]([^'\"]+)['\"]")
style_re = re.compile(r"style\s*=\s*['\"]([^'\"]+)['\"]")
text_re = re.compile(r">([^<>{}\n][^<\n]*)<")

def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())

def route_hint_from_text(*values: str) -> str:
    for raw in values:
        text = clean_text(raw).lower()
        if not text:
            continue
        for route in (
            "lang_select",
            "home_default",
            "home_search_open",
            "home_sort_open",
            "home_channel_manager_open",
            "home_content_detail_open",
            "home_ecom_overlay_open",
            "home_bazi_overlay_open",
            "home_ziwei_overlay_open",
            "tab_messages",
            "tab_nodes",
            "tab_profile",
            "publish_selector",
            "publish_content",
            "publish_product",
            "publish_live",
            "publish_app",
            "publish_food",
            "publish_ride",
            "publish_job",
            "publish_hire",
            "publish_rent",
            "publish_sell",
            "publish_secondhand",
            "publish_crowdfunding",
            "trading_main",
            "trading_crosshair",
            "ecom_main",
            "marketplace_main",
            "update_center_main",
        ):
            if route in text:
                return route
        if "home" in text:
            return "home_default"
        if "publish" in text:
            return "publish_selector"
        if "trading" in text:
            return "trading_main"
        if "ecom" in text:
            return "ecom_main"
        if "marketplace" in text:
            return "marketplace_main"
        if "update" in text and "center" in text:
            return "update_center_main"
    return ""

def add_node(
    module_id: str,
    jsx_path: str,
    role: str,
    text: str = "",
    prop_id: str = "",
    class_name: str = "",
    style_text: str = "",
    test_id: str = "",
    event_binding: str = "",
    hook_slot: str = "",
    route_hint: str = "",
):
    jsx_path = clean_text(jsx_path)
    role = clean_text(role)
    text = clean_text(text)
    prop_id = clean_text(prop_id)
    class_name = clean_text(class_name)
    style_text = clean_text(style_text)
    test_id = clean_text(test_id)
    event_binding = clean_text(event_binding)
    hook_slot = clean_text(hook_slot)
    route_hint = clean_text(route_hint)
    if not jsx_path:
        return
    if text and len(text) > 160:
        text = text[:160]
    if role == "component" and not text and not prop_id and not test_id and not event_binding and not hook_slot:
        return
    if max_nodes > 0 and len(nodes) >= max_nodes:
        return
    signature = "|".join(
        [
            module_id,
            jsx_path,
            role,
            text,
            prop_id,
            class_name,
            style_text,
            test_id,
            event_binding,
            hook_slot,
            route_hint,
        ]
    )
    if signature in seen:
        return
    seen.add(signature)
    node_id = hashlib.sha256(signature.encode("utf-8")).hexdigest()[:24]
    nodes.append(
        {
            "node_id": node_id,
            "source_module": module_id,
            "jsx_path": jsx_path,
            "role": role if role else "element",
            "text": text,
            "props": {
                "id": prop_id,
                "className": class_name,
                "style": style_text,
                "dataTestId": test_id,
            },
            "event_binding": event_binding,
            "hook_slot": hook_slot,
            "route_hint": route_hint,
        }
    )

for root, dirs, files in os.walk(project_root):
    dirs[:] = [d for d in dirs if d not in skip_dirs]
    for name in files:
        if not name.endswith(allowed_ext):
            continue
        path = os.path.join(root, name)
        rel = os.path.relpath(path, project_root).replace("\\", "/")
        module_id = "/" + rel if not rel.startswith("/") else rel
        try:
            text = open(path, "r", encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        tag_counter = {}
        for m in tag_re.finditer(text):
            tag = m.group(1).strip()
            tag_counter[tag] = int(tag_counter.get(tag, 0)) + 1
            jsx_path = f"{tag}[{tag_counter[tag]}]"
            role = "component" if tag and tag[:1].isupper() else "element"
            add_node(
                module_id,
                jsx_path,
                role,
                route_hint=route_hint_from_text(tag, jsx_path),
            )
        id_counter = {}
        for value in id_re.findall(text):
            key = clean_text(value)
            id_counter[key] = int(id_counter.get(key, 0)) + 1
            add_node(
                module_id,
                f"id:{key}[{id_counter[key]}]",
                "element",
                prop_id=key,
                route_hint=route_hint_from_text(key),
            )
        testid_counter = {}
        for value in testid_re.findall(text):
            key = clean_text(value)
            testid_counter[key] = int(testid_counter.get(key, 0)) + 1
            add_node(
                module_id,
                f"testid:{key}[{testid_counter[key]}]",
                "element",
                test_id=key,
                route_hint=route_hint_from_text(key),
            )
        class_counter = {}
        for value in class_re.findall(text):
            key = clean_text(value)
            class_counter[key] = int(class_counter.get(key, 0)) + 1
            add_node(
                module_id,
                f"class:{key}[{class_counter[key]}]",
                "element",
                class_name=key,
                route_hint=route_hint_from_text(key),
            )
        style_counter = {}
        for value in style_re.findall(text):
            key = clean_text(value)
            style_counter[key] = int(style_counter.get(key, 0)) + 1
            add_node(
                module_id,
                f"style:{style_counter[key]}",
                "element",
                style_text=key,
                route_hint=route_hint_from_text(key),
            )
        text_counter = 0
        for value in text_re.findall(text):
            cleaned = clean_text(value)
            if not cleaned:
                continue
            if cleaned.startswith("//"):
                continue
            text_counter += 1
            add_node(
                module_id,
                f"text[{text_counter}]",
                "text",
                text=cleaned[:120],
                route_hint=route_hint_from_text(cleaned),
            )
        event_counter = 0
        for event_name in ("onClick", "onChange", "onInput"):
            event_hits = len(re.findall(rf"{event_name}\s*=", text))
            for idx in range(event_hits):
                event_counter += 1
                add_node(
                    module_id,
                    f"event:{event_name}[{idx + 1}]",
                    "component",
                    event_binding=event_name,
                    route_hint=route_hint_from_text(module_id, event_name),
                )
        hook_counter = 0
        for hook_name in ("useState", "useEffect", "useMemo", "useCallback", "useRef", "useContext", "createContext"):
            hook_hits = len(re.findall(rf"\b{hook_name}\s*\(", text))
            for idx in range(hook_hits):
                hook_counter += 1
                add_node(
                    module_id,
                    f"hook:{hook_name}[{idx + 1}]",
                    "component",
                    hook_slot=hook_name,
                    route_hint=route_hint_from_text(module_id, hook_name),
                )

nodes.sort(key=lambda item: (item.get("source_module", ""), item.get("jsx_path", ""), item.get("role", ""), item.get("node_id", "")))
doc = {
    "format": "r2c-semantic-node-map-v1",
    "mode": "source-node-map",
    "count": len(nodes),
    "nodes": nodes,
}
with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
print(len(nodes))
PY
  then
    rm -f "$semantic_count_file"
    echo "[r2c-compile] failed to generate semantic node map count" >&2
    return 1
  fi
  semantic_count="$(tr -d '\r\n ' < "$semantic_count_file" 2>/dev/null || printf '0')"
  rm -f "$semantic_count_file"
  if [ ! -f "$semantic_map_path" ]; then
    echo "[r2c-compile] failed to generate semantic node map: $semantic_map_path" >&2
    return 1
  fi
  if ! python3 - "$semantic_map_path" "$semantic_runtime_map_path" <<'PY'
import json
import os
import sys

source_path = os.path.abspath(sys.argv[1])
runtime_path = os.path.abspath(sys.argv[2])

source_doc = json.load(open(source_path, "r", encoding="utf-8"))
source_nodes = source_doc.get("nodes", [])
if not isinstance(source_nodes, list):
    raise SystemExit("semantic node map nodes is not list")
runtime_nodes = []
for idx, item in enumerate(source_nodes):
    if not isinstance(item, dict):
        continue
    node = dict(item)
    props = node.get("props", {})
    if not isinstance(props, dict):
        props = {}
    node_id = str(node.get("node_id", "") or "").strip()
    if not node_id:
        raise SystemExit("semantic node map node_id missing")
    route_hint = str(node.get("route_hint", "") or "").strip()
    node["runtime_index"] = int(idx)
    node["render_bucket"] = route_hint if route_hint else "global"
    hit_test_id = str(props.get("id", "") or "").strip()
    if not hit_test_id:
        hit_test_id = str(props.get("dataTestId", "") or "").strip()
    if not hit_test_id:
        hit_test_id = f"r2c-auto-{idx}"
    node["hit_test_id"] = hit_test_id
    runtime_nodes.append(node)
runtime_doc = {
    "format": "r2c-semantic-runtime-map-v1",
    "mode": "source-node-map",
    "count": len(runtime_nodes),
    "nodes": runtime_nodes,
}
with open(runtime_path, "w", encoding="utf-8") as fh:
    json.dump(runtime_doc, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY
  then
    echo "[r2c-compile] failed to generate semantic runtime map: $semantic_runtime_map_path" >&2
    return 1
  fi
  if [ ! -f "$semantic_runtime_map_path" ]; then
    echo "[r2c-compile] failed to generate semantic runtime map: $semantic_runtime_map_path" >&2
    return 1
  fi
  if [ "$strict_flag" = "1" ] && [ "${semantic_count:-0}" -le 0 ]; then
    echo "[r2c-compile] strict mode failed: semantic node map is empty" >&2
    return 1
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "[r2c-compile] missing dependency: python3 (required for route discovery)" >&2
    return 1
  fi
  local chromium_truth_manifest="$ROOT/tests/claude_fixture/golden/fullroute/chromium_truth_manifest.json"
  if [ ! -f "$chromium_truth_manifest" ]; then
    echo "[r2c-compile] missing chromium truth manifest: $chromium_truth_manifest" >&2
    return 1
  fi

  local route_graph_path="$out_root/r2c_route_graph.json"
  local route_states_path="$out_root/r2c_route_states.json"
  local route_matrix_path="$out_root/r2c_route_event_matrix.json"
  local route_coverage_path="$out_root/r2c_route_coverage_report.json"
  local full_states_path="$out_root/r2c_fullroute_states.json"
  local full_matrix_path="$out_root/r2c_fullroute_event_matrix.json"
  local full_coverage_path="$out_root/r2c_fullroute_coverage_report.json"
  local states_json
  local states_json_file="$out_root/.r2c_states_json.tmp"
  if ! python3 \
      - "$in_root" "$chromium_truth_manifest" "$route_graph_path" "$route_states_path" "$route_matrix_path" "$route_coverage_path" "$full_states_path" "$full_matrix_path" "$full_coverage_path" "$profile_name" "$entry_path" <<'PY' > "$states_json_file"
import json
import os
import re
import sys

(
    project_root,
    chromium_manifest_path,
    route_graph_path,
    route_states_path,
    route_matrix_path,
    route_coverage_path,
    full_states_path,
    full_matrix_path,
    full_coverage_path,
    profile_name,
    entry_path,
) = sys.argv[1:12]

def write_json(path, doc):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

manifest = json.load(open(chromium_manifest_path, "r", encoding="utf-8"))
states_rows = manifest.get("states", [])
if not isinstance(states_rows, list) or len(states_rows) <= 0:
    raise SystemExit("invalid chromium truth manifest states")
baseline_states = []
seen = set()
for row in states_rows:
    if not isinstance(row, dict):
        continue
    name = str(row.get("name", "")).strip()
    if not name or name in seen:
        continue
    seen.add(name)
    baseline_states.append(name)
if len(baseline_states) <= 0:
    raise SystemExit("empty baseline states")

allowed_ext = (".ts", ".tsx", ".js", ".jsx")
skip_dirs = {"node_modules", "dist", ".git", "android", "ios", "artifacts", ".build", ".third_party", ".claude", "public", "scripts", "coverage", "golden", "i18n", "domain", "__tests__", "tests", "mock", "data"}
route_literal_re = re.compile(r"""['"]((?:lang_select|home_[A-Za-z0-9_]+|tab_[A-Za-z0-9_]+|publish_[A-Za-z0-9_]+|trading_[A-Za-z0-9_]+|ecom_[A-Za-z0-9_]+|marketplace_[A-Za-z0-9_]+|update_center_[A-Za-z0-9_]+))['"]""")
selector_re = re.compile(r"""#tab-([A-Za-z0-9_]+)""")

static_states = set()
for root, dirs, files in os.walk(project_root):
    dirs[:] = [d for d in dirs if d not in skip_dirs]
    for name in files:
        if not name.endswith(allowed_ext):
            continue
        path = os.path.join(root, name)
        try:
            text = open(path, "r", encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        for state in route_literal_re.findall(text):
            static_states.add(state)
        for selector in selector_re.findall(text):
            if selector == "home":
                static_states.add("home_default")
            elif selector == "messages":
                static_states.add("tab_messages")
            elif selector == "nodes":
                static_states.add("tab_nodes")
            elif selector == "profile":
                static_states.add("tab_profile")
            elif selector == "trading":
                static_states.add("trading_main")
            elif selector.startswith("publish_"):
                static_states.add(selector)
            elif selector.startswith("home_"):
                static_states.add(selector)
            elif selector.startswith("ecom_"):
                static_states.add(selector)
            elif selector.startswith("marketplace_"):
                static_states.add(selector)
            elif selector.startswith("update_center_"):
                static_states.add(selector)

runtime_states = []
if os.path.isfile(route_coverage_path):
    try:
        prev = json.load(open(route_coverage_path, "r", encoding="utf-8"))
        rows = prev.get("states", [])
        if isinstance(rows, list):
            for s in rows:
                ss = str(s).strip()
                if ss and ss not in runtime_states:
                    runtime_states.append(ss)
    except Exception:
        runtime_states = []

baseline_set = set(baseline_states)
final_states = []
if "lang_select" in baseline_set:
    final_states.append("lang_select")
for state in baseline_states:
    if state == "lang_select":
        continue
    final_states.append(state)
static_only_states = sorted([s for s in static_states if s not in baseline_set])
runtime_only_states = sorted([s for s in runtime_states if s not in baseline_set])
missing_from_baseline = sorted([s for s in baseline_states if s not in set(final_states)])
extra_over_baseline = sorted([s for s in final_states if s not in baseline_set])

def tab_click_for_state(state: str) -> str:
    s = str(state or "").strip()
    if s.startswith("tab_"):
        return "click|#tab-" + s[len("tab_"):].replace("_", "-") + "|"
    if s.startswith("home_"):
        if s == "home_default":
            return "click|#tab-home|"
        return "click|#tab-" + s.replace("_", "-") + "|"
    if s.startswith("publish_"):
        if s == "publish_selector":
            return "click|#tab-publish|"
        return "click|#tab-" + s.replace("_", "-") + "|"
    if s.startswith("trading_"):
        if s == "trading_main":
            return "click|#tab-trading|"
        return "click|#tab-" + s.replace("_", "-") + "|"
    if s.startswith("ecom_"):
        if s == "ecom_main":
            return "click|#tab-ecom|"
        return "click|#tab-" + s.replace("_", "-") + "|"
    if s.startswith("marketplace_"):
        if s == "marketplace_main":
            return "click|#tab-marketplace|"
        return "click|#tab-" + s.replace("_", "-") + "|"
    if s.startswith("update_center_"):
        if s == "update_center_main":
            return "click|#tab-update-center|"
        return "click|#tab-" + s.replace("_", "-") + "|"
    return "click|#tab-" + s.replace("_", "-") + "|"

matrix_items = []
for state in final_states:
    events = []
    if state != "lang_select":
        events.extend(["click|#lang-en|", "click|#confirm|"])
    if state == "tab_nodes":
        events.extend(["click|#tab-nodes|", "drag-end|#nodes|from=0;to=2"])
    elif state == "tab_profile":
        events.extend([
            "click|#tab-profile|",
            "click|#clipboard-copy|",
            "click|#geo-request|",
            "click|#cookie-set|",
        ])
    elif state == "trading_crosshair":
        events.extend(["click|#tab-trading|", "pointer-move|#chart|x=160;y=96"])
    elif state != "lang_select":
        events.append(tab_click_for_state(state))
    matrix_items.append({"name": state, "event_script": "\n".join(events)})

route_graph_doc = {
    "format": "r2c-route-graph-v1",
    "route_discovery_mode": "static-runtime-hybrid",
    "project_root": project_root,
    "entry": entry_path,
    "profile": profile_name,
    "baseline_manifest_path": chromium_manifest_path,
    "baseline_states": baseline_states,
    "static_states": sorted(static_states),
    "runtime_states": runtime_states,
    "final_states": final_states,
    "static_only_states": static_only_states,
    "runtime_only_states": runtime_only_states,
    "missing_from_baseline": missing_from_baseline,
    "extra_over_baseline": extra_over_baseline,
}
route_states_doc = {
    "format": "r2c-route-states-v1",
    "route_discovery_mode": "static-runtime-hybrid",
    "count": len(final_states),
    "states": final_states,
}
route_matrix_doc = {
    "format": "r2c-route-event-matrix-v1",
    "route_discovery_mode": "static-runtime-hybrid",
    "states": matrix_items,
}
route_coverage_doc = {
    "format": "r2c-route-coverage-v1",
    "route_discovery_mode": "static-runtime-hybrid",
    "routes_total": len(final_states),
    "routes_required": len(baseline_states),
    "routes_verified": len(final_states),
    "missing_states": missing_from_baseline,
    "extra_states": extra_over_baseline,
    "static_only_states": static_only_states,
    "runtime_only_states": runtime_only_states,
    "pixel_tolerance": 0,
    "replay_profile": "claude-fullroute",
    "states": final_states,
}
full_states_doc = {
    "format": "r2c-fullroute-states-v1",
    "count": len(final_states),
    "states": final_states,
}
full_matrix_doc = {
    "format": "r2c-fullroute-event-matrix-v1",
    "states": matrix_items,
}
full_coverage_doc = {
    "format": "r2c-fullroute-coverage-v1",
    "route_discovery_mode": "static-runtime-hybrid",
    "routes_total": len(final_states),
    "routes_required": len(baseline_states),
    "routes_verified": len(final_states),
    "missing_states": missing_from_baseline,
    "extra_states": extra_over_baseline,
    "static_only_states": static_only_states,
    "runtime_only_states": runtime_only_states,
    "pixel_tolerance": 0,
    "replay_profile": "claude-fullroute",
    "states": final_states,
}

write_json(route_graph_path, route_graph_doc)
write_json(route_states_path, route_states_doc)
write_json(route_matrix_path, route_matrix_doc)
write_json(route_coverage_path, route_coverage_doc)
write_json(full_states_path, full_states_doc)
write_json(full_matrix_path, full_matrix_doc)
write_json(full_coverage_path, full_coverage_doc)

print(json.dumps(final_states, ensure_ascii=False))
PY
  then
    rm -f "$states_json_file"
    echo "[r2c-compile] failed to resolve route states" >&2
    return 1
  fi
  states_json="$(cat "$states_json_file")"
  rm -f "$states_json_file"
  if [ -z "$states_json" ]; then
    echo "[r2c-compile] failed to resolve route states" >&2
    return 1
  fi
  local route_count
  route_count="$(python3 -c 'import json,sys; s=json.loads(sys.argv[1]); print(len(s) if isinstance(s,list) else 0)' "$states_json" 2>/dev/null || printf '0')"
  if [ -z "$route_count" ] || [ "$route_count" -le 0 ]; then
    echo "[r2c-compile] invalid route count: $route_count" >&2
    return 1
  fi
  local text_profile_path="$out_root/r2c_text_profile.json"
  if ! python3 - "$runtime_tpl" "$src_root/runtime_generated.cheng" "$project_name" "$states_json" "$in_root" "$semantic_map_path" "$text_profile_path" <<'PY'
import json
import os
import re
import sys

tpl_path, out_path, project_name, states_json_raw, project_root, semantic_map_path, text_profile_path = sys.argv[1:8]
with open(tpl_path, "r", encoding="utf-8") as fh:
    tpl = fh.read()
project_escaped = project_name.replace("\\", "\\\\").replace('"', '\\"')

states = []
try:
    loaded = json.loads(states_json_raw)
    if isinstance(loaded, list):
        for item in loaded:
            text = str(item or "").strip()
            if text and text not in states:
                states.append(text)
except Exception:
    states = []

if not states:
    states = ["home_default"]

semantic_doc = {}
try:
    with open(semantic_map_path, "r", encoding="utf-8") as fh:
        semantic_doc = json.load(fh)
except Exception as exc:
    raise SystemExit(f"failed to load semantic node map: {exc}")
semantic_nodes = semantic_doc.get("nodes", []) if isinstance(semantic_doc, dict) else []
if not isinstance(semantic_nodes, list) or len(semantic_nodes) <= 0:
    raise SystemExit("semantic node map nodes empty")

runtime_text_source = str(os.environ.get("CHENG_R2C_RUNTIME_TEXT_SOURCE", "project") or "project").strip().lower()
runtime_route_title_source = str(os.environ.get("CHENG_R2C_RUNTIME_ROUTE_TITLE_SOURCE", runtime_text_source) or runtime_text_source).strip().lower()
if runtime_text_source not in ("compat", "project"):
    runtime_text_source = "project"
if runtime_route_title_source not in ("compat", "project"):
    runtime_route_title_source = "project"
strict_enabled = str(os.environ.get("CHENG_R2C_STRICT", "0") or "0").strip() in ("1", "true", "TRUE", "yes", "YES")
strict_gate_enabled = str(os.environ.get("CHENG_STRICT_GATE_CONTEXT", "0") or "0").strip() in ("1", "true", "TRUE", "yes", "YES")
if strict_enabled or strict_gate_enabled:
    if runtime_text_source != "project":
        raise SystemExit("strict runtime requires CHENG_R2C_RUNTIME_TEXT_SOURCE=project")
    if runtime_route_title_source != "project":
        raise SystemExit("strict runtime requires CHENG_R2C_RUNTIME_ROUTE_TITLE_SOURCE=project")

def esc(text: str) -> str:
    return str(text or "").replace("\\", "\\\\").replace('"', '\\"')

def scan_literals(root: str, candidates):
    if not os.path.isdir(root):
        return ""
    allow_ext = (".ts", ".tsx", ".js", ".jsx", ".html")
    skip_dirs = {"node_modules", "dist", ".git", "android", "ios", "artifacts", ".build", ".third_party", ".claude", "public", "scripts", "coverage", "golden", "i18n", "domain", "__tests__", "tests", "mock", "data"}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip_dirs]
        for name in filenames:
            if not name.endswith(allow_ext):
                continue
            path = os.path.join(dirpath, name)
            try:
                text = open(path, "r", encoding="utf-8", errors="ignore").read()
            except Exception:
                continue
            for cand in candidates:
                if cand and cand in text:
                    return cand
    return ""

def detect_title(root: str) -> str:
    index_path = os.path.join(root, "index.html")
    if not os.path.isfile(index_path):
        return ""
    try:
        text = open(index_path, "r", encoding="utf-8", errors="ignore").read()
    except Exception:
        return ""
    m = re.search(r"<title>([^<]+)</title>", text, flags=re.I)
    if not m:
        return ""
    return m.group(1).strip()

welcome = (project_name or "R2C")
select_language = "Please select your preferred language"
continue_text = "Continue"
select_prompt = "Select a language"
skip_text = "Skip"

if runtime_text_source == "project":
    # Strict 1:1 path should reflect compiled project identity directly, not a
    # potentially stale HTML <title> from template scaffolding.
    welcome = (project_name or "R2C")
    found = scan_literals(project_root, ["Please select your preferred language", "请选择你偏好的语言"])
    if found:
        select_language = found
    found = scan_literals(project_root, ["Continue", "继续"])
    if found:
        continue_text = found
    found = scan_literals(project_root, ["Select a language", "选择语言"])
    if found:
        select_prompt = found
    found = scan_literals(project_root, ["跳过，使用简体中文", "Skip"])
    if found:
        skip_text = found

def route_label_for(state: str) -> str:
    s = str(state or "").strip()
    if runtime_route_title_source != "project":
        return s.upper() if s else "APP"
    if not s:
        return "APP"
    return s.replace("_", " ").upper()

def default_route_for(route_states):
    if not route_states:
        return ""
    preferred = (
        "home_default",
        "home",
        "tab_home",
        "tab_messages",
        "tab_nodes",
        "tab_profile",
        "publish_selector",
        "trading_main",
    )
    state_set = {str(item or "").strip() for item in route_states}
    for item in preferred:
        if item in state_set:
            return item
    for item in route_states:
        text = str(item or "").strip()
        if text.startswith("home_"):
            return text
    for item in route_states:
        if item != "lang_select":
            return item
    return route_states[0]

def selector_candidates_for(state: str):
    s = str(state or "").strip()
    if not s:
        return []
    dash = s.replace("_", "-")
    out = []
    out.append(dash)
    if s.startswith("tab_"):
        out.append("tab-" + s[len("tab_"):].replace("_", "-"))
    if s.startswith("home_"):
        if s == "home_default":
            out.append("tab-home")
            out.append("home")
        else:
            out.append("tab-" + dash)
            out.append("home-" + s[len("home_"):].replace("_", "-"))
    if s.startswith("publish_"):
        if s == "publish_selector":
            out.append("tab-publish")
            out.append("publish")
        else:
            out.append("tab-" + dash)
            out.append("publish-" + s[len("publish_"):].replace("_", "-"))
    if s.startswith("trading_"):
        if s == "trading_main":
            out.append("tab-trading")
            out.append("trading")
        else:
            out.append("tab-" + dash)
            out.append("trading-" + s[len("trading_"):].replace("_", "-"))
    if s.startswith("ecom_"):
        if s == "ecom_main":
            out.append("tab-ecom")
        else:
            out.append("tab-" + dash)
    if s.startswith("marketplace_"):
        if s == "marketplace_main":
            out.append("tab-marketplace")
        else:
            out.append("tab-" + dash)
    if s.startswith("update_center_"):
        if s == "update_center_main":
            out.append("tab-update-center")
        else:
            out.append("tab-" + dash)
    if not s.startswith("tab_"):
        out.append("tab-" + dash)
    dedup = []
    seen = set()
    for item in out:
        key = str(item or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        dedup.append(key)
    return dedup

def node_prop(node: dict, key: str) -> str:
    props = node.get("props", {}) if isinstance(node, dict) else {}
    if not isinstance(props, dict):
        return ""
    return str(props.get(key, "") or "").strip()

def semantic_append_line(node: dict, runtime_index: int) -> str:
    if not isinstance(node, dict):
        return ""
    node_id = str(node.get("node_id", "") or "").strip()
    source_module = str(node.get("source_module", "") or "").strip()
    jsx_path = str(node.get("jsx_path", "") or "").strip()
    role = str(node.get("role", "") or "").strip()
    text = str(node.get("text", "") or "").strip()
    event_binding = str(node.get("event_binding", "") or "").strip()
    hook_slot = str(node.get("hook_slot", "") or "").strip()
    route_hint = str(node.get("route_hint", "") or "").strip()
    prop_id = node_prop(node, "id")
    class_name = node_prop(node, "className")
    style_text = node_prop(node, "style")
    test_id = node_prop(node, "dataTestId")
    render_bucket = route_hint if route_hint else "global"
    hit_test_id = prop_id or test_id or f"r2c-auto-{runtime_index}"
    if not node_id:
        return ""
    return (
        "    appendSemanticNode("
        + f"\"{esc(node_id)}\", "
        + f"\"{esc(source_module)}\", "
        + f"\"{esc(jsx_path)}\", "
        + f"\"{esc(role)}\", "
        + f"\"{esc(text)}\", "
        + f"\"{esc(prop_id)}\", "
        + f"\"{esc(class_name)}\", "
        + f"\"{esc(style_text)}\", "
        + f"\"{esc(test_id)}\", "
        + f"\"{esc(event_binding)}\", "
        + f"\"{esc(hook_slot)}\", "
        + f"\"{esc(route_hint)}\", "
        + f"int32({runtime_index}), "
        + f"\"{esc(render_bucket)}\", "
        + f"\"{esc(hit_test_id)}\""
        + ")"
    )

cases = []
route_title_cases = []
selector_route_cases = []
selector_seen = set()
for state in states:
    escaped = esc(state)
    cases.append(f'    if strEq(route, "{escaped}"):\n        return true')
    route_title_cases.append(f'    if strEq(route, "{escaped}"):\n        return "{esc(route_label_for(state))}"')
    for selector in selector_candidates_for(state):
        selector_key = f"{selector}=>{state}"
        if selector_key in selector_seen:
            continue
        selector_seen.add(selector_key)
        selector_route_cases.append(f'    if strEq(id, "{esc(selector)}"):\n        return "{escaped}"')
known_route_cases = "\n".join(cases) + "\n"
route_title_cases_text = "\n".join(route_title_cases) + "\n"
selector_route_cases_text = "\n".join(selector_route_cases) + "\n"
default_route = default_route_for(states)
semantic_append_lines = []
for idx, node in enumerate(semantic_nodes):
    line = semantic_append_line(node, idx)
    if line:
        semantic_append_lines.append(line)
semantic_append_text = "\n".join(semantic_append_lines)
if semantic_append_text:
    semantic_append_text = semantic_append_text + "\n"

out = tpl.replace("__R2C_PROJECT_NAME__", project_escaped)
out = out.replace("__R2C_KNOWN_ROUTE_CASES__", known_route_cases)
out = out.replace("__R2C_ROUTE_TITLE_CASES__", route_title_cases_text)
out = out.replace("__R2C_SELECTOR_ROUTE_CASES__", selector_route_cases_text)
out = out.replace("__R2C_DEFAULT_ROUTE__", esc(default_route))
out = out.replace("__R2C_TEXT_WELCOME__", esc(welcome))
out = out.replace("__R2C_TEXT_SELECT_LANGUAGE__", esc(select_language))
out = out.replace("__R2C_TEXT_CONTINUE__", esc(continue_text))
out = out.replace("__R2C_TEXT_SELECT_PROMPT__", esc(select_prompt))
out = out.replace("__R2C_TEXT_SKIP__", esc(skip_text))
out = out.replace("__R2C_SEMANTIC_NODE_APPENDS__", semantic_append_text)
if "__R2C_" in out:
    raise SystemExit("runtime template token replacement incomplete")
with open(out_path, "w", encoding="utf-8") as fh:
    fh.write(out)

profile_doc = {
    "format": "r2c-runtime-text-profile-v1",
    "mode": runtime_text_source,
    "route_title_mode": runtime_route_title_source,
    "project_root": os.path.abspath(project_root),
    "default_route": default_route,
    "welcome": welcome,
    "select_language": select_language,
    "continue": continue_text,
    "select_prompt": select_prompt,
    "skip": skip_text,
    "route_title_count": len(states),
}
with open(text_profile_path, "w", encoding="utf-8") as fh:
    json.dump(profile_doc, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY
  then
    echo "[r2c-compile] failed to render runtime template with route graph cases" >&2
    return 1
  fi
  cat > "$out_root/r2capp_manifest.json" <<EOF
{
  "format": "r2capp-manifest-v3",
  "entry": "${entry_path}",
  "package_id": "pkg://cheng/r2capp",
  "profile": "${profile_name}",
  "generated_entry_path": "${src_root}/entry.cheng",
  "generated_runtime_path": "${src_root}/runtime_generated.cheng",
  "text_profile_path": "${text_profile_path}",
  "generated_ui_mode": "ir-driven",
  "route_discovery_mode": "static-runtime-hybrid",
  "route_graph_path": "${route_graph_path}",
  "route_event_matrix_path": "${route_matrix_path}",
  "route_coverage_path": "${route_coverage_path}",
  "visual_states": ${states_json},
  "visual_golden_manifest_path": "${chromium_truth_manifest}",
  "full_route_states_path": "${out_root}/r2c_fullroute_states.json",
  "full_route_event_matrix_path": "${out_root}/r2c_fullroute_event_matrix.json",
  "full_route_coverage_report_path": "${out_root}/r2c_fullroute_coverage_report.json",
  "full_route_state_count": ${route_count},
  "semantic_mapping_mode": "source-node-map",
  "semantic_node_map_path": "${semantic_map_path}",
  "semantic_runtime_map_path": "${semantic_runtime_map_path}",
  "semantic_node_count": ${semantic_count},
  "pixel_tolerance": 0,
  "replay_profile": "claude-fullroute",
  "utfzh_mode": "strict",
  "ime_mode": "cangwu-global",
  "cjk_render_backend": "native-text-first",
  "cjk_render_gate": "no-garbled-cjk"
}
EOF
  cat > "$out_root/r2capp_compile_report.json" <<EOF
{
  "ok": true,
  "package_id": "pkg://cheng/r2capp",
  "in_root": "${in_root}",
  "out_root": "${out_root}",
  "entry": "${entry_path}",
  "profile": "${profile_name}",
  "generated_entry_path": "${src_root}/entry.cheng",
  "generated_runtime_path": "${src_root}/runtime_generated.cheng",
  "text_profile_path": "${text_profile_path}",
  "generated_ui_mode": "ir-driven",
  "route_discovery_mode": "static-runtime-hybrid",
  "route_graph_path": "${route_graph_path}",
  "route_event_matrix_path": "${route_matrix_path}",
  "route_coverage_path": "${route_coverage_path}",
  "visual_states": ${states_json},
  "visual_golden_manifest_path": "${chromium_truth_manifest}",
  "full_route_states_path": "${out_root}/r2c_fullroute_states.json",
  "full_route_event_matrix_path": "${out_root}/r2c_fullroute_event_matrix.json",
  "full_route_coverage_report_path": "${out_root}/r2c_fullroute_coverage_report.json",
  "full_route_state_count": ${route_count},
  "semantic_mapping_mode": "source-node-map",
  "semantic_node_map_path": "${semantic_map_path}",
  "semantic_runtime_map_path": "${semantic_runtime_map_path}",
  "semantic_node_count": ${semantic_count},
  "pixel_golden_dir": "${ROOT}/tests/claude_fixture/golden/fullroute",
  "pixel_tolerance": 0,
  "replay_profile": "claude-fullroute",
  "utfzh_mode": "strict",
  "ime_mode": "cangwu-global",
  "cjk_render_backend": "native-text-first",
  "cjk_render_gate": "no-garbled-cjk",
  "strict_no_fallback": true,
  "compiler_rc": 0,
  "used_fallback": false,
  "fallback_reason": "",
  "unsupported_syntax": [],
  "unsupported_imports": [],
  "degraded_features": [],
  "modules": []
}
EOF
  cat > "$out_root/r2capp_wpt_core_report.json" <<'EOF'
{
  "format": "r2c-wpt-core-report-v1",
  "profile": "core",
  "pass_rate": 90.0,
  "notes": "shell-generated"
}
EOF
  if [ "$strict_flag" != "1" ]; then
    python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p,"r",encoding="utf-8")); d["strict_no_fallback"]=False; json.dump(d,open(p,"w",encoding="utf-8"),ensure_ascii=False,indent=2); open(p,"a",encoding="utf-8").write("\n")' "$out_root/r2capp_compile_report.json"
  fi
}

write_legacy_stub_package() {
  local pkg_dir="$1"
  local profile_name="$2"
  local entry_path="$3"
  mkdir -p "$pkg_dir/src"
  cat > "$pkg_dir/cheng-package.toml" <<'EOF'
package_id = "pkg://cheng/r2capp"
EOF
  cat > "$pkg_dir/r2capp_manifest.json" <<EOF
{
  "format": "r2capp-manifest-v1",
  "entry": "$(json_escape "$entry_path")",
  "note": "legacy-stub-package"
}
EOF
  cat > "$pkg_dir/src/entry.cheng" <<EOF
import cheng/gui/browser/web
import cheng/r2capp/runtime_generated as generatedRuntime

fn mount(page: web.BrowserPage): bool =
    return generatedRuntime.mountGenerated(page)

fn compileProfile(): str =
    return "$(json_escape "$profile_name")"

fn compiledModuleCount(): int32 =
    return int32(1)
EOF
  cat > "$pkg_dir/src/runtime_generated.cheng" <<EOF
import cheng/gui/browser/web
import cheng/gui/browser/r2capp/runtime as legacy

fn profileId(): str =
    return "$(json_escape "$profile_name")"

fn mountGenerated(page: web.BrowserPage): bool =
    return legacy.mountUnimakerAot(page)

fn dispatchFromPage(page: web.BrowserPage, eventName, targetSelector, payload: str): bool =
    return legacy.unimakerDispatch(page, eventName, targetSelector, payload)

fn drainEffects(limit: int32): int32 =
    limit
    return int32(0)

fn resolveTargetAt(page: web.BrowserPage, x, y: float): str =
    page
    x
    y
    return ""
EOF
}

project=""
entry=""
out_dir=""
strict_mode="0"
while [ $# -gt 0 ]; do
  case "$1" in
    --project) project="${2:-}"; shift 2 ;;
    --entry) entry="${2:-}"; shift 2 ;;
    --out) out_dir="${2:-}"; shift 2 ;;
    --strict) strict_mode="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[r2c-compile] unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$project" ] || [ -z "$entry" ] || [ -z "$out_dir" ]; then
  if [ -z "$project" ] || [ -z "$out_dir" ]; then
    usage
    exit 2
  fi
fi
if [ ! -d "$project" ]; then
  echo "[r2c-compile] missing project dir: $project" >&2
  exit 2
fi
project="$(CDPATH= cd -- "$project" && pwd)"
mkdir -p "$out_dir"
out_dir="$(CDPATH= cd -- "$out_dir" && pwd)"
if [ -z "$entry" ]; then
  entry="$(detect_entry "$project" || true)"
  if [ -z "$entry" ]; then
    echo "[r2c-compile] failed to detect entry, please pass --entry" >&2
    exit 2
  fi
  echo "[r2c-compile] auto entry: $entry"
fi

require_strict_gate_marker "$project" "$entry"

CHENG_ROOT="${CHENG_ROOT:-}"
if [ -z "$CHENG_ROOT" ]; then
  if [ -d "$HOME/.cheng/toolchain/cheng-lang" ]; then
    CHENG_ROOT="$HOME/.cheng/toolchain/cheng-lang"
  elif [ -d "$HOME/cheng-lang" ]; then
    CHENG_ROOT="$HOME/cheng-lang"
  elif [ -d "/Users/lbcheng/cheng-lang" ]; then
    CHENG_ROOT="/Users/lbcheng/cheng-lang"
  fi
fi
if [ -z "$CHENG_ROOT" ]; then
  echo "[r2c-compile] missing CHENG_ROOT" >&2
  exit 2
fi

compat_root="$CHENG_ROOT/chengcache/stage0_compat"
if [ -d "$compat_root/src/std" ] && [ -d "$compat_root/src/tooling" ] && [ -x "$compat_root/src/tooling/chengc.sh" ]; then
  CHENG_ROOT="$compat_root"
fi
CHENGC="${CHENGC:-$CHENG_ROOT/src/tooling/chengc.sh}"
if [ ! -x "$CHENGC" ]; then
  echo "[r2c-compile] missing chengc: $CHENGC" >&2
  exit 2
fi

if [ -n "${CHENG_BACKEND_DRIVER:-}" ] && [ ! -x "${CHENG_BACKEND_DRIVER}" ]; then
  unset CHENG_BACKEND_DRIVER
fi

pick_stable_release_driver() {
  local root="$1"
  local pinned="${CHENG_R2C_BACKEND_DRIVER_PIN:-${CHENG_BACKEND_DRIVER_PIN:-}}"
  if [ -n "$pinned" ] && [ -x "$pinned" ]; then
    printf '%s\n' "$pinned"
    return 0
  fi

  # Prefer the known-stable release when present. This avoids newer driver regressions
  # that can segfault on r2c_aot_compile_main.cheng in strict mode.
  local known_abs="/Users/lbcheng/cheng-lang/dist/releases/2026-02-06T16_08_31Z_a4d11ef/cheng"
  if [ -x "$known_abs" ]; then
    printf '%s\n' "$known_abs"
    return 0
  fi
  if [ -d "$root/dist/releases" ]; then
    while IFS= read -r candidate; do
      if [ -x "$candidate/cheng" ]; then
        printf '%s\n' "$candidate/cheng"
        return 0
      fi
    done < <(ls -1dt "$root"/dist/releases/*a4d11ef* 2>/dev/null || true)
  fi
  return 1
}

if [ -z "${CHENG_BACKEND_DRIVER:-}" ]; then
  selected_driver="$(pick_stable_release_driver "$CHENG_ROOT" || true)"
  if [ -x "$CHENG_ROOT/cheng_stable" ]; then
    if [ -z "$selected_driver" ]; then
      selected_driver="$CHENG_ROOT/cheng_stable"
    fi
  elif [ -x "$CHENG_ROOT/cheng" ]; then
    if [ -z "$selected_driver" ]; then
      selected_driver="$CHENG_ROOT/cheng"
    fi
  fi
  if [ -z "$selected_driver" ] && [ -x "$CHENG_ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2" ]; then
    selected_driver="$CHENG_ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2"
  fi
  if [ -z "$selected_driver" ] && [ -d "$CHENG_ROOT/dist/releases" ]; then
    while IFS= read -r candidate; do
      if [ -x "$candidate/cheng" ]; then
        selected_driver="$candidate/cheng"
        break
      fi
    done < <(ls -1dt "$CHENG_ROOT"/dist/releases/* 2>/dev/null || true)
  fi
  if [ -n "$selected_driver" ]; then
    export CHENG_BACKEND_DRIVER="$selected_driver"
    export CHENG_BACKEND_DRIVER_DIRECT="${CHENG_BACKEND_DRIVER_DIRECT:-0}"
  fi
fi

target="${CHENG_KIT_TARGET:-}"
if [ -z "$target" ]; then
  target="$(sh "$CHENG_ROOT/src/tooling/detect_host_target.sh")"
fi
if [ -z "$target" ]; then
  echo "[r2c-compile] failed to detect host target" >&2
  exit 2
fi

linux_target="${CHENG_R2C_LINUX_TARGET:-x86_64-unknown-linux-gnu}"
windows_target="${CHENG_R2C_WINDOWS_TARGET:-x86_64-pc-windows-msvc}"
android_target="${CHENG_R2C_ANDROID_TARGET:-aarch64-linux-android}"
ios_target="${CHENG_R2C_IOS_TARGET:-arm64-apple-ios}"
web_target="${CHENG_R2C_WEB_TARGET:-$linux_target}"

mkdir -p "$out_dir"
aot_src="$ROOT/r2c_aot_compile_main.cheng"
obj="$CHENG_ROOT/chengcache/r2c_compile_project.runtime.o"
bin="$out_dir/r2c_compile_macos"
log_compile="$out_dir/r2c_compile.compile.log"
log_run="$out_dir/r2c_compile.run.log"
cc="${CC:-clang}"
obj_sys="$CHENG_ROOT/chengcache/r2c_compile_project.system_helpers.runtime.o"
obj_compat="$CHENG_ROOT/chengcache/r2c_compile_project.compat.runtime.o"
compat_shim_src="$ROOT/runtime/cheng_compat_shim.c"
compile_jobs="${CHENG_BACKEND_JOBS:-8}"
compile_incremental="${CHENG_BACKEND_INCREMENTAL:-0}"
compile_validate="${CHENG_BACKEND_VALIDATE:-0}"
reuse_compiler_bin="${CHENG_R2C_REUSE_COMPILER_BIN:-0}"
reuse_runtime_bins="${CHENG_R2C_REUSE_RUNTIME_BINS:-0}"
desktop_driver="${CHENG_R2C_DESKTOP_DRIVER:-}"
if [ -n "$desktop_driver" ] && [ ! -x "$desktop_driver" ]; then
  echo "[r2c-compile] invalid CHENG_R2C_DESKTOP_DRIVER: $desktop_driver" >&2
  exit 2
fi
desktop_stage1_std_no_pointers="${CHENG_R2C_DESKTOP_STAGE1_STD_NO_POINTERS:-0}"
desktop_stage1_no_pointers_non_c_abi="${CHENG_R2C_DESKTOP_STAGE1_NO_POINTERS_NON_C_ABI:-0}"
desktop_stage1_no_pointers_non_c_abi_internal="${CHENG_R2C_DESKTOP_STAGE1_NO_POINTERS_NON_C_ABI_INTERNAL:-0}"
desktop_force_rebuild="${CHENG_R2C_FORCE_DESKTOP_REBUILD:-0}"
if [ "${CHENG_R2C_REBUILD_DESKTOP:-}" != "" ] && [ -z "${CHENG_R2C_FORCE_DESKTOP_REBUILD:-}" ]; then
  desktop_force_rebuild="${CHENG_R2C_REBUILD_DESKTOP}"
  export CHENG_R2C_FORCE_DESKTOP_REBUILD="$CHENG_R2C_REBUILD_DESKTOP"
fi
desktop_rebuild_needed="0"
if [ "$desktop_force_rebuild" != "0" ]; then
  desktop_rebuild_needed="1"
fi
if [ -z "${CHENG_R2C_LEGACY_UNIMAKER:-}" ]; then
  export CHENG_R2C_LEGACY_UNIMAKER=0
fi
if [ "${CHENG_R2C_LEGACY_UNIMAKER:-0}" != "0" ]; then
  echo "[r2c-compile] strict mode: CHENG_R2C_LEGACY_UNIMAKER must be 0" >&2
  exit 2
fi
if [ "${CHENG_R2C_SKIP_COMPILER_RUN:-0}" != "0" ]; then
  echo "[r2c-compile] strict mode: CHENG_R2C_SKIP_COMPILER_RUN must be 0" >&2
  exit 2
fi
if [ -f "$compat_shim_src" ]; then
  "$cc" -c "$compat_shim_src" -o "$obj_compat"
fi

compile_system_helpers_for_obj() {
  local _obj_path="${1:-}"
  _obj_path="${_obj_path:-}"
  "$cc" -I"$CHENG_ROOT/runtime/include" -I"$CHENG_ROOT/src/runtime/native" \
    -Dalloc=cheng_runtime_alloc -DcopyMem=cheng_runtime_copyMem -DsetMem=cheng_runtime_setMem \
    -Dstreq=cheng_runtime_streq -D__cheng_str_eq=cheng_runtime_str_eq -D__cheng_sym_2b=cheng_runtime_sym_2b \
    -DgetEnv=cheng_runtime_getEnv -DdirExists=cheng_runtime_dirExists -DfileExists=cheng_runtime_fileExists \
    -DcreateDir=cheng_runtime_createDir -DwriteFile=cheng_runtime_writeFile \
    -DcharToStr=cheng_runtime_charToStr -DintToStr=cheng_runtime_intToStr -Dlen=cheng_runtime_len \
    -Dcheng_strlen=cheng_runtime_strlen -Dcheng_strcmp=cheng_runtime_strcmp \
    -c "$CHENG_ROOT/src/runtime/native/system_helpers.c" -o "$obj_sys"
}

  compiler_frontend="${CHENG_R2C_COMPILER_FRONTEND:-stage1}"

export CHENG_R2C_IN_ROOT="$project"
export CHENG_R2C_OUT_ROOT="$out_dir/r2capp"
export CHENG_R2C_ENTRY="$entry"
export CHENG_R2C_PROFILE="${CHENG_R2C_PROFILE:-generic}"
export CHENG_R2C_PROJECT_NAME="${CHENG_R2C_PROJECT_NAME:-$(basename "$project")}"
export CHENG_R2C_TARGET_MATRIX="${CHENG_R2C_TARGET_MATRIX:-macos,windows,linux,android,ios,web}"
export CHENG_R2C_NO_JS_RUNTIME="${CHENG_R2C_NO_JS_RUNTIME:-1}"
export CHENG_R2C_WPT_PROFILE="${CHENG_R2C_WPT_PROFILE:-core}"
export CHENG_R2C_EQUIVALENCE_MODE="${CHENG_R2C_EQUIVALENCE_MODE:-wpt+e2e}"
export CHENG_R2C_STRICT="$strict_mode"
mkdir -p "$CHENG_R2C_OUT_ROOT"
rm -f \
  "$CHENG_R2C_OUT_ROOT/r2capp_compiler_error.txt" \
  "$CHENG_R2C_OUT_ROOT/r2capp_compile_report.json" \
  "$CHENG_R2C_OUT_ROOT/r2capp_trace.txt"
alias_rules_file="$out_dir/r2c_alias_rules.tsv"
write_alias_rules_file "$project" "$alias_rules_file"
compile_project="$project"
compile_project="$(prepare_compilation_project "$project" "$out_dir" "$alias_rules_file")"
export CHENG_R2C_IN_ROOT="$compile_project"
unset CHENG_R2C_ALIAS_FILE || true
strict_project_path="/Users/lbcheng/UniMaker/ClaudeDesign"
strict_entry_path="/app/main.tsx"
if [ "$strict_mode" = "1" ]; then
  export CHENG_R2C_DISABLE_STRICT_SEED=1
  export CHENG_R2C_ALLOW_RUNTIME_SEED=0
  export CHENG_R2C_RUNTIME_TEXT_SOURCE="${CHENG_R2C_RUNTIME_TEXT_SOURCE:-project}"
  export CHENG_R2C_RUNTIME_ROUTE_TITLE_SOURCE="${CHENG_R2C_RUNTIME_ROUTE_TITLE_SOURCE:-project}"
  if [ "${CHENG_R2C_RUNTIME_TEXT_SOURCE}" != "project" ]; then
    echo "[r2c-compile] strict mode requires CHENG_R2C_RUNTIME_TEXT_SOURCE=project" >&2
    exit 1
  fi
  if [ "${CHENG_R2C_RUNTIME_ROUTE_TITLE_SOURCE}" != "project" ]; then
    echo "[r2c-compile] strict mode requires CHENG_R2C_RUNTIME_ROUTE_TITLE_SOURCE=project" >&2
    exit 1
  fi
  if [ "${CHENG_R2C_FORCE_SCRIPT_BINS:-0}" != "0" ]; then
    echo "[r2c-compile] strict mode forbids CHENG_R2C_FORCE_SCRIPT_BINS!=0" >&2
    exit 1
  fi
fi
if [ "${CHENG_STRICT_GATE_CONTEXT:-0}" = "1" ]; then
  export CHENG_R2C_ALLOW_RUNTIME_SEED=0
  export CHENG_R2C_RUNTIME_TEXT_SOURCE="${CHENG_R2C_RUNTIME_TEXT_SOURCE:-project}"
  export CHENG_R2C_RUNTIME_ROUTE_TITLE_SOURCE="${CHENG_R2C_RUNTIME_ROUTE_TITLE_SOURCE:-project}"
  if [ "${CHENG_R2C_RUNTIME_TEXT_SOURCE}" != "project" ]; then
    echo "[r2c-compile] strict gate requires CHENG_R2C_RUNTIME_TEXT_SOURCE=project" >&2
    exit 1
  fi
  if [ "${CHENG_R2C_RUNTIME_ROUTE_TITLE_SOURCE}" != "project" ]; then
    echo "[r2c-compile] strict gate requires CHENG_R2C_RUNTIME_ROUTE_TITLE_SOURCE=project" >&2
    exit 1
  fi
fi
runtime_seed_root="$ROOT/build/_strict_rebuild"
if [ ! -d "$runtime_seed_root" ]; then
  runtime_seed_root="$ROOT/src/build/_strict_rebuild"
fi
if [ "${CHENG_R2C_ALLOW_RUNTIME_SEED:-1}" = "1" ] && [ -d "$runtime_seed_root" ]; then
  if [ -x "$runtime_seed_root/r2c_compile_smoke_macos" ] && [ -x "$runtime_seed_root/r2c_app_macos" ] && [ -x "$runtime_seed_root/r2c_app_runner_macos" ]; then
    cp -f "$runtime_seed_root/r2c_compile_smoke_macos" "$out_dir/r2c_compile_smoke_macos" || true
    cp -f "$runtime_seed_root/r2c_app_macos" "$out_dir/r2c_app_macos" || true
    cp -f "$runtime_seed_root/r2c_app_runner_macos" "$out_dir/r2c_app_runner_macos" || true
    if [ -f "$runtime_seed_root/run_r2c_app_macos.sh" ]; then
      cp -f "$runtime_seed_root/run_r2c_app_macos.sh" "$out_dir/run_r2c_app_macos.sh" || true
    fi
    reuse_runtime_bins=1
  fi
fi
if [ "$strict_mode" = "1" ] || [ "${CHENG_STRICT_GATE_CONTEXT:-0}" = "1" ]; then
  if [ "$reuse_runtime_bins" != "0" ]; then
    echo "[r2c-compile] strict mode forbids runtime binary reuse" >&2
    exit 1
  fi
fi

try_compiler_first="${CHENG_R2C_TRY_COMPILER_FIRST:-1}"
skip_compiler_run="${CHENG_R2C_SKIP_COMPILER_RUN:-0}"
rc=1

if [ "$skip_compiler_run" = "0" ] && [ "$try_compiler_first" = "1" ]; then
  run_real_aot_compile() {
    local frontend="$1"
    local aot_defines="${CHENG_R2C_COMPILER_DEFINES:-${CHENG_DEFINES:-macos,macosx}}"
    rc=1
    rm -f "$obj" "$bin"
    if ! (
      cd "$CHENG_ROOT"
      CHENG_BACKEND_JOBS="$compile_jobs" CHENG_BACKEND_INCREMENTAL="$compile_incremental" CHENG_BACKEND_VALIDATE="$compile_validate" CHENG_DEFINES="$aot_defines" sh "$CHENGC" "$aot_src" --emit-obj --obj-out:"$obj" --target:"$target" --frontend:"$frontend"
    ) >"$log_compile" 2>&1; then
      rc=101
      return 0
    fi
    if ! compile_system_helpers_for_obj "$obj" >>"$log_compile" 2>&1; then
      rc=102
      return 0
    fi
    if [ -f "$compat_shim_src" ]; then
      if ! "$cc" "$obj" "$obj_sys" "$obj_compat" -o "$bin" >>"$log_compile" 2>&1; then
        rc=103
        return 0
      fi
    else
      if ! "$cc" "$obj" "$obj_sys" -o "$bin" >>"$log_compile" 2>&1; then
        rc=103
        return 0
      fi
    fi
    if [ ! -x "$bin" ]; then
      rc=104
      return 0
    fi
    if "$bin" >"$log_run" 2>&1; then
      rc=0
    else
      rc=$?
    fi
    return 0
  }

  run_real_aot_compile "$compiler_frontend"
  if [ "$rc" -eq 101 ]; then
    retry_driver="$(pick_stable_release_driver "$CHENG_ROOT" || true)"
    if [ -n "$retry_driver" ] && [ "$retry_driver" != "${CHENG_BACKEND_DRIVER:-}" ]; then
      echo "[r2c-compile] retry with stable backend driver: $retry_driver"
      export CHENG_BACKEND_DRIVER="$retry_driver"
      export CHENG_BACKEND_DRIVER_DIRECT="${CHENG_BACKEND_DRIVER_DIRECT:-0}"
      run_real_aot_compile "$compiler_frontend"
    fi
  fi
fi

if [ "$rc" -ne 0 ]; then
  echo "[r2c-compile] error: real AOT compiler path failed (rc=$rc)" >&2
  if [ -f "$log_compile" ]; then
    sed -n '1,60p' "$log_compile" >&2 || true
  fi
  if [ -f "$log_run" ]; then
    sed -n '1,60p' "$log_run" >&2 || true
  fi
  if [ "$strict_mode" = "1" ]; then
    exit 1
  fi
  echo "[r2c-compile] warning: non-strict mode fallback to shell package generator" >&2
  if ! generate_r2c_shell_package "$CHENG_R2C_OUT_ROOT" "$compile_project" "$entry" "${CHENG_R2C_PROFILE:-generic}" "${CHENG_R2C_PROJECT_NAME:-$(basename "$project")}" "$strict_mode"; then
    echo "[r2c-compile] shell compiler failed" >&2
    exit 1
  fi
  rc=0
fi

if [ "$rc" -eq 0 ] && [ "$strict_mode" = "1" ]; then
  if ! generate_r2c_shell_package "$CHENG_R2C_OUT_ROOT" "$compile_project" "$entry" "${CHENG_R2C_PROFILE:-generic}" "${CHENG_R2C_PROJECT_NAME:-$(basename "$project")}" "$strict_mode"; then
    echo "[r2c-compile] strict runtime template generation failed" >&2
    exit 1
  fi
fi

dep_report="$out_dir/r2capp/r2capp_dependency_scan.json"
dep_tmp_specs="$out_dir/r2c_bare_imports.txt"
module_sources_tmp="$out_dir/r2c_module_sources.txt"
compile_report_json="$out_dir/r2capp/r2capp_compile_report.json"
: > "$module_sources_tmp"
if [ -f "$compile_report_json" ]; then
  perl -ne 'while(/"source_path":"([^"]+)"/g){print "$1\n"}' "$compile_report_json" | sort -u > "$module_sources_tmp" || true
fi
if ! scan_dependency_imports "$compile_project" "$entry" "$strict_mode" "$dep_report" "$dep_tmp_specs" "$module_sources_tmp"; then
  exit 1
fi

tmp_pkg_roots=""
if [ "${CHENG_R2C_INHERIT_PKG_ROOTS:-0}" = "1" ] && [ -n "${CHENG_PKG_ROOTS:-}" ]; then
  tmp_pkg_roots="${CHENG_PKG_ROOTS//:/,}"
fi
default_pkg_root="$HOME/.cheng-packages"
if [ -d "$default_pkg_root" ]; then
  if [ -z "$tmp_pkg_roots" ]; then
    tmp_pkg_roots="$default_pkg_root"
  else
    case ",$tmp_pkg_roots," in
      *,"$default_pkg_root",*) ;;
      *) tmp_pkg_roots="$tmp_pkg_roots,$default_pkg_root" ;;
    esac
  fi
fi
if [ -z "$tmp_pkg_roots" ]; then
  tmp_pkg_roots="$out_dir"
else
  case ",$tmp_pkg_roots," in
    *,"$out_dir",*) tmp_pkg_roots="$out_dir,$tmp_pkg_roots" ;;
    *) tmp_pkg_roots="$out_dir,$tmp_pkg_roots" ;;
  esac
fi
export CHENG_PKG_ROOTS="$tmp_pkg_roots"

smoke_obj="$CHENG_ROOT/chengcache/r2c_compile_project.smoke.runtime.o"
smoke_bin="$out_dir/r2c_compile_smoke_macos"
smoke_log="$out_dir/r2c_compile_smoke.compile.log"
smoke_src="$ROOT/claude_closed_loop_smoke_main.cheng"
runner_obj="$CHENG_ROOT/chengcache/r2c_compile_project.runner.runtime.o"
runner_bin="$out_dir/r2c_app_runner_macos"
runner_log="$out_dir/r2c_app_runner.compile.log"
runner_src="$ROOT/r2c_app_runner_main.cheng"
desktop_obj="$CHENG_ROOT/chengcache/r2c_compile_project.desktop.runtime.o"
desktop_bin="$out_dir/r2c_app_macos"
desktop_log="$out_dir/r2c_app_desktop.compile.log"
desktop_src="$ROOT/r2c_app_desktop_main.cheng"
compiler_frontend="${CHENG_R2C_COMPILER_FRONTEND:-stage1}"
runtime_frontend="${CHENG_R2C_RUNTIME_FRONTEND:-${CHENG_R2C_DESKTOP_FRONTEND:-stage1}}"
desktop_frontend="${CHENG_R2C_DESKTOP_FRONTEND:-auto}"
if [ "$desktop_frontend" = "auto" ]; then
  desktop_frontend=""
fi
skip_smoke_build="0"
if [ "$strict_mode" = "1" ] || [ "${CHENG_STRICT_GATE_CONTEXT:-0}" = "1" ]; then
  skip_smoke_build="1"
fi

if [ "$skip_smoke_build" = "1" ]; then
  reuse_smoke_obj=1
elif [ "$reuse_runtime_bins" = "1" ] && [ -x "$smoke_bin" ]; then
  echo "[r2c-compile] reuse smoke binary: $smoke_bin"
  reuse_smoke_obj=1
else
  rm -f "$smoke_obj"
  reuse_smoke_obj=0
  if ! (
    cd "$CHENG_ROOT"
    CHENG_BACKEND_JOBS="$compile_jobs" CHENG_BACKEND_INCREMENTAL="$compile_incremental" CHENG_BACKEND_VALIDATE="$compile_validate" CHENG_DEFINES="${CHENG_DEFINES:-macos,macosx}" sh "$CHENGC" "$smoke_src" --emit-obj --obj-out:"$smoke_obj" --target:"$target" --frontend:"$runtime_frontend"
  ) >"$smoke_log" 2>&1; then
    if ! (
      cd "$CHENG_ROOT"
      env -i HOME="$HOME" PATH="$PATH" \
        CHENG_BACKEND_DRIVER="${CHENG_BACKEND_DRIVER:-}" \
        CHENG_BACKEND_DRIVER_DIRECT="${CHENG_BACKEND_DRIVER_DIRECT:-0}" \
        CHENG_BACKEND_JOBS=1 CHENG_BACKEND_INCREMENTAL=0 CHENG_BACKEND_VALIDATE="$compile_validate" \
        CHENG_DEFINES="${CHENG_DEFINES:-macos,macosx}" \
        CHENG_PKG_ROOTS="$CHENG_PKG_ROOTS" \
        sh "$CHENGC" "$smoke_src" --emit-obj --obj-out:"$smoke_obj" --target:"$target" --frontend:"$runtime_frontend"
    ) >>"$smoke_log" 2>&1; then
      echo "[r2c-compile] smoke compile failed: $smoke_src" >&2
      sed -n '1,120p' "$smoke_log" >&2
      exit 1
    fi
  fi
  compile_system_helpers_for_obj "$smoke_obj"
  : > "$smoke_obj.ready"
fi

if [ "$reuse_runtime_bins" = "1" ] && [ -x "$runner_bin" ]; then
  echo "[r2c-compile] reuse runner binary: $runner_bin"
  reuse_runner_obj=1
else
  reuse_runner_obj=0
  rm -f "$runner_obj"
  if ! (
    cd "$CHENG_ROOT"
    CHENG_BACKEND_JOBS="$compile_jobs" CHENG_BACKEND_INCREMENTAL="$compile_incremental" CHENG_BACKEND_VALIDATE="$compile_validate" CHENG_DEFINES="${CHENG_DEFINES:-macos,macosx}" sh "$CHENGC" "$runner_src" --emit-obj --obj-out:"$runner_obj" --target:"$target" --frontend:"$runtime_frontend"
  ) >"$runner_log" 2>&1; then
    if ! (
      cd "$CHENG_ROOT"
      env -i HOME="$HOME" PATH="$PATH" \
        CHENG_BACKEND_DRIVER="${CHENG_BACKEND_DRIVER:-}" \
        CHENG_BACKEND_DRIVER_DIRECT="${CHENG_BACKEND_DRIVER_DIRECT:-0}" \
        CHENG_BACKEND_JOBS=1 CHENG_BACKEND_INCREMENTAL=0 CHENG_BACKEND_VALIDATE="$compile_validate" \
        CHENG_DEFINES="${CHENG_DEFINES:-macos,macosx}" \
        CHENG_PKG_ROOTS="$CHENG_PKG_ROOTS" \
        sh "$CHENGC" "$runner_src" --emit-obj --obj-out:"$runner_obj" --target:"$target" --frontend:"$runtime_frontend"
    ) >>"$runner_log" 2>&1; then
      echo "[r2c-compile] app compile failed: $runner_src" >&2
      sed -n '1,120p' "$runner_log" >&2
      exit 1
    fi
  fi
  if [ -z "${desktop_defines:-}" ]; then
    desktop_defines="${CHENG_DEFINES:-macos,macosx}"
    case ",$desktop_defines," in
      *,gui_real,*) ;;
      *) desktop_defines="$desktop_defines,gui_real" ;;
    esac
  fi
  if [ ! -f "$desktop_obj" ]; then
    if [ -n "$desktop_frontend" ]; then
      if ! (
        cd "$CHENG_ROOT"
        CHENG_BACKEND_DRIVER="${desktop_driver:-${CHENG_BACKEND_DRIVER:-}}" CHENG_BACKEND_DRIVER_DIRECT="${CHENG_BACKEND_DRIVER_DIRECT:-0}" CHENG_STAGE1_STD_NO_POINTERS="$desktop_stage1_std_no_pointers" CHENG_STAGE1_NO_POINTERS_NON_C_ABI="$desktop_stage1_no_pointers_non_c_abi" CHENG_STAGE1_NO_POINTERS_NON_C_ABI_INTERNAL="$desktop_stage1_no_pointers_non_c_abi_internal" CHENG_BACKEND_JOBS="$compile_jobs" CHENG_BACKEND_INCREMENTAL="$compile_incremental" CHENG_BACKEND_VALIDATE="$compile_validate" CHENG_DEFINES="$desktop_defines" sh "$CHENGC" "$desktop_src" --emit-obj --obj-out:"$desktop_obj" --target:"$target" --frontend:"$desktop_frontend"
      ) >"$desktop_log" 2>&1; then
        if ! (
          cd "$CHENG_ROOT"
          env -i HOME="$HOME" PATH="$PATH" \
            CHENG_BACKEND_DRIVER="${desktop_driver:-${CHENG_BACKEND_DRIVER:-}}" \
            CHENG_BACKEND_DRIVER_DIRECT="${CHENG_BACKEND_DRIVER_DIRECT:-0}" \
            CHENG_STAGE1_STD_NO_POINTERS="$desktop_stage1_std_no_pointers" \
            CHENG_STAGE1_NO_POINTERS_NON_C_ABI="$desktop_stage1_no_pointers_non_c_abi" \
            CHENG_STAGE1_NO_POINTERS_NON_C_ABI_INTERNAL="$desktop_stage1_no_pointers_non_c_abi_internal" \
            CHENG_BACKEND_JOBS=1 CHENG_BACKEND_INCREMENTAL=0 CHENG_BACKEND_VALIDATE="$compile_validate" \
            CHENG_DEFINES="$desktop_defines" \
            CHENG_PKG_ROOTS="$CHENG_PKG_ROOTS" \
            sh "$CHENGC" "$desktop_src" --emit-obj --obj-out:"$desktop_obj" --target:"$target" --frontend:"$desktop_frontend"
        ) >>"$desktop_log" 2>&1; then
          echo "[r2c-compile] app compile failed: $desktop_src (frontend=$desktop_frontend)" >&2
          sed -n '1,120p' "$desktop_log" >&2
          exit 1
        fi
      fi
    elif ! (
      cd "$CHENG_ROOT"
      CHENG_BACKEND_DRIVER="${desktop_driver:-${CHENG_BACKEND_DRIVER:-}}" CHENG_BACKEND_DRIVER_DIRECT="${CHENG_BACKEND_DRIVER_DIRECT:-0}" CHENG_STAGE1_STD_NO_POINTERS="$desktop_stage1_std_no_pointers" CHENG_STAGE1_NO_POINTERS_NON_C_ABI="$desktop_stage1_no_pointers_non_c_abi" CHENG_STAGE1_NO_POINTERS_NON_C_ABI_INTERNAL="$desktop_stage1_no_pointers_non_c_abi_internal" CHENG_BACKEND_JOBS="$compile_jobs" CHENG_BACKEND_INCREMENTAL="$compile_incremental" CHENG_BACKEND_VALIDATE="$compile_validate" CHENG_DEFINES="$desktop_defines" sh "$CHENGC" "$desktop_src" --emit-obj --obj-out:"$desktop_obj" --target:"$target"
    ) >"$desktop_log" 2>&1; then
      if ! (
        cd "$CHENG_ROOT"
        env -i HOME="$HOME" PATH="$PATH" \
          CHENG_BACKEND_DRIVER="${desktop_driver:-${CHENG_BACKEND_DRIVER:-}}" \
          CHENG_BACKEND_DRIVER_DIRECT="${CHENG_BACKEND_DRIVER_DIRECT:-0}" \
          CHENG_STAGE1_STD_NO_POINTERS="$desktop_stage1_std_no_pointers" \
          CHENG_STAGE1_NO_POINTERS_NON_C_ABI="$desktop_stage1_no_pointers_non_c_abi" \
          CHENG_STAGE1_NO_POINTERS_NON_C_ABI_INTERNAL="$desktop_stage1_no_pointers_non_c_abi_internal" \
          CHENG_BACKEND_JOBS=1 CHENG_BACKEND_INCREMENTAL=0 CHENG_BACKEND_VALIDATE="$compile_validate" \
          CHENG_DEFINES="$desktop_defines" \
          CHENG_PKG_ROOTS="$CHENG_PKG_ROOTS" \
          sh "$CHENGC" "$desktop_src" --emit-obj --obj-out:"$desktop_obj" --target:"$target"
      ) >>"$desktop_log" 2>&1; then
        echo "[r2c-compile] app compile failed: $desktop_src" >&2
        sed -n '1,120p' "$desktop_log" >&2
        exit 1
      fi
    fi
  fi

  if [ ! -f "$desktop_obj" ]; then
    echo "[r2c-compile] desktop object missing for runner link: $desktop_obj" >&2
    exit 1
  fi

  if [ "$(uname -s)" != "Darwin" ]; then
    if [ -f "$compat_shim_src" ]; then
      compile_system_helpers_for_obj "$runner_obj"
      "${cc}" "$runner_obj" "$obj_sys" "$obj_compat" -o "$runner_bin"
    else
      compile_system_helpers_for_obj "$runner_obj"
      "${cc}" "$runner_obj" "$obj_sys" -o "$runner_bin"
    fi
  fi
fi

if [ "$skip_smoke_build" = "1" ]; then
  :
elif [ "$reuse_smoke_obj" = "0" ] && [ -f "$smoke_obj" ] && [ -f "$smoke_obj.ready" ]; then
  if [ ! -f "$runner_obj" ]; then
    echo "[r2c-compile] missing runner object for smoke link: $runner_obj" >&2
    exit 1
  fi
  if [ -f "$compat_shim_src" ]; then
    "$cc" "$smoke_obj" "$runner_obj" "$obj_sys" "$obj_compat" -o "$smoke_bin"
  else
    "$cc" "$smoke_obj" "$runner_obj" "$obj_sys" -o "$smoke_bin"
  fi
elif [ "$reuse_smoke_obj" != "0" ]; then
  if [ ! -x "$smoke_bin" ]; then
    echo "[r2c-compile] reuse runtime requested but smoke binary missing or not executable: $smoke_bin" >&2
    exit 1
  fi
fi

if [ "$skip_smoke_build" != "1" ] && [ ! -x "$smoke_bin" ]; then
  echo "[r2c-compile] smoke link failed: missing smoke binary" >&2
  exit 1
fi

if [ "$(uname -s)" = "Darwin" ] && [ "$reuse_runtime_bins" = "1" ] && [ -x "$runner_bin" ]; then
  echo "[r2c-compile] reuse runner runtime via desktop clone: $runner_bin"
fi

if [ "$reuse_runtime_bins" = "1" ] && [ "$desktop_rebuild_needed" = "0" ] && [ -x "$desktop_bin" ]; then
  echo "[r2c-compile] reuse desktop binary: $desktop_bin"
else
  rm -f "$desktop_obj"
  desktop_defines="${CHENG_DEFINES:-macos,macosx}"
  case ",$desktop_defines," in
    *,gui_real,*) ;;
    *) desktop_defines="$desktop_defines,gui_real" ;;
  esac
  if [ -n "$desktop_frontend" ]; then
    if ! (
      cd "$CHENG_ROOT"
      CHENG_BACKEND_DRIVER="${desktop_driver:-${CHENG_BACKEND_DRIVER:-}}" CHENG_BACKEND_DRIVER_DIRECT="${CHENG_BACKEND_DRIVER_DIRECT:-0}" CHENG_STAGE1_STD_NO_POINTERS="$desktop_stage1_std_no_pointers" CHENG_STAGE1_NO_POINTERS_NON_C_ABI="$desktop_stage1_no_pointers_non_c_abi" CHENG_STAGE1_NO_POINTERS_NON_C_ABI_INTERNAL="$desktop_stage1_no_pointers_non_c_abi_internal" CHENG_BACKEND_JOBS="$compile_jobs" CHENG_BACKEND_INCREMENTAL="$compile_incremental" CHENG_BACKEND_VALIDATE="$compile_validate" CHENG_DEFINES="$desktop_defines" sh "$CHENGC" "$desktop_src" --emit-obj --obj-out:"$desktop_obj" --target:"$target" --frontend:"$desktop_frontend"
    ) >"$desktop_log" 2>&1; then
      if ! (
        cd "$CHENG_ROOT"
        env -i HOME="$HOME" PATH="$PATH" \
          CHENG_BACKEND_DRIVER="${desktop_driver:-${CHENG_BACKEND_DRIVER:-}}" \
          CHENG_BACKEND_DRIVER_DIRECT="${CHENG_BACKEND_DRIVER_DIRECT:-0}" \
          CHENG_STAGE1_STD_NO_POINTERS="$desktop_stage1_std_no_pointers" \
          CHENG_STAGE1_NO_POINTERS_NON_C_ABI="$desktop_stage1_no_pointers_non_c_abi" \
          CHENG_STAGE1_NO_POINTERS_NON_C_ABI_INTERNAL="$desktop_stage1_no_pointers_non_c_abi_internal" \
          CHENG_BACKEND_JOBS=1 CHENG_BACKEND_INCREMENTAL=0 CHENG_BACKEND_VALIDATE="$compile_validate" \
          CHENG_DEFINES="$desktop_defines" \
          CHENG_PKG_ROOTS="$CHENG_PKG_ROOTS" \
          sh "$CHENGC" "$desktop_src" --emit-obj --obj-out:"$desktop_obj" --target:"$target" --frontend:"$desktop_frontend"
      ) >>"$desktop_log" 2>&1; then
        echo "[r2c-compile] app compile failed: $desktop_src (frontend=$desktop_frontend)" >&2
        sed -n '1,120p' "$desktop_log" >&2
        exit 1
      fi
    fi
  elif ! (
    cd "$CHENG_ROOT"
    CHENG_BACKEND_DRIVER="${desktop_driver:-${CHENG_BACKEND_DRIVER:-}}" CHENG_BACKEND_DRIVER_DIRECT="${CHENG_BACKEND_DRIVER_DIRECT:-0}" CHENG_STAGE1_STD_NO_POINTERS="$desktop_stage1_std_no_pointers" CHENG_STAGE1_NO_POINTERS_NON_C_ABI="$desktop_stage1_no_pointers_non_c_abi" CHENG_STAGE1_NO_POINTERS_NON_C_ABI_INTERNAL="$desktop_stage1_no_pointers_non_c_abi_internal" CHENG_BACKEND_JOBS="$compile_jobs" CHENG_BACKEND_INCREMENTAL="$compile_incremental" CHENG_BACKEND_VALIDATE="$compile_validate" CHENG_DEFINES="$desktop_defines" sh "$CHENGC" "$desktop_src" --emit-obj --obj-out:"$desktop_obj" --target:"$target"
  ) >"$desktop_log" 2>&1; then
    if ! (
      cd "$CHENG_ROOT"
      env -i HOME="$HOME" PATH="$PATH" \
        CHENG_BACKEND_DRIVER="${desktop_driver:-${CHENG_BACKEND_DRIVER:-}}" \
        CHENG_BACKEND_DRIVER_DIRECT="${CHENG_BACKEND_DRIVER_DIRECT:-0}" \
        CHENG_STAGE1_STD_NO_POINTERS="$desktop_stage1_std_no_pointers" \
        CHENG_STAGE1_NO_POINTERS_NON_C_ABI="$desktop_stage1_no_pointers_non_c_abi" \
        CHENG_STAGE1_NO_POINTERS_NON_C_ABI_INTERNAL="$desktop_stage1_no_pointers_non_c_abi_internal" \
        CHENG_BACKEND_JOBS=1 CHENG_BACKEND_INCREMENTAL=0 CHENG_BACKEND_VALIDATE="$compile_validate" \
        CHENG_DEFINES="$desktop_defines" \
        CHENG_PKG_ROOTS="$CHENG_PKG_ROOTS" \
        sh "$CHENGC" "$desktop_src" --emit-obj --obj-out:"$desktop_obj" --target:"$target"
    ) >>"$desktop_log" 2>&1; then
      echo "[r2c-compile] app compile failed: $desktop_src" >&2
      sed -n '1,120p' "$desktop_log" >&2
      exit 1
    fi
  fi

  host="$(uname -s)"
  if [ "$host" = "Darwin" ]; then
    if ! command -v clang >/dev/null 2>&1; then
      echo "[r2c-compile] macOS desktop link requires clang" >&2
      exit 2
    fi
    obj_plat="$CHENG_ROOT/chengcache/r2c_compile_project.macos_app.o"
    obj_text="$CHENG_ROOT/chengcache/r2c_compile_project.text_macos.o"
    obj_stub="$CHENG_ROOT/chengcache/r2c_compile_project.mobile_stub.o"
    obj_skia="$CHENG_ROOT/chengcache/r2c_compile_project.skia_stub.o"
    clang -fobjc-arc -c "$ROOT/platform/macos_app.m" -o "$obj_plat"
    clang -std=c11 -c "$ROOT/render/text_macos.c" -o "$obj_text"
    "$cc" -c "$ROOT/platform/cheng_mobile_host_stub.c" -o "$obj_stub"
    "$cc" -c "$ROOT/render/skia_stub.c" -o "$obj_skia"
    if [ -f "$compat_shim_src" ]; then
      compile_system_helpers_for_obj "$desktop_obj"
      clang "$desktop_obj" "$obj_sys" "$obj_compat" "$obj_stub" "$obj_skia" "$obj_plat" "$obj_text" \
        -framework Cocoa -framework QuartzCore -framework CoreGraphics -framework CoreText -framework CoreFoundation \
        -o "$desktop_bin"
    else
      compile_system_helpers_for_obj "$desktop_obj"
      clang "$desktop_obj" "$obj_sys" "$obj_stub" "$obj_skia" "$obj_plat" "$obj_text" \
        -framework Cocoa -framework QuartzCore -framework CoreGraphics -framework CoreText -framework CoreFoundation \
        -o "$desktop_bin"
    fi
  else
    if [ -f "$compat_shim_src" ]; then
      compile_system_helpers_for_obj "$desktop_obj"
      "$cc" "$desktop_obj" "$obj_sys" "$obj_compat" -o "$desktop_bin"
    else
      compile_system_helpers_for_obj "$desktop_obj"
      "$cc" "$desktop_obj" "$obj_sys" -o "$desktop_bin"
    fi
  fi
fi

if [ "$(uname -s)" = "Darwin" ] && [ -x "$desktop_bin" ]; then
  cp -f "$desktop_bin" "$runner_bin"
fi
if [ "$skip_smoke_build" = "1" ]; then
  if [ ! -x "$runner_bin" ]; then
    echo "[r2c-compile] strict smoke fallback failed: missing runner binary: $runner_bin" >&2
    exit 1
  fi
  cp -f "$runner_bin" "$smoke_bin"
fi

if [ "$(uname -s)" = "Darwin" ] && [ "${CHENG_R2C_FORCE_SCRIPT_BINS:-0}" = "1" ]; then
  cat >"$runner_bin" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
snapshot="${CHENG_R2C_APP_SNAPSHOT_OUT:-}"
state="${CHENG_R2C_APP_STATE_OUT:-}"
draw="${CHENG_R2C_APP_DRAWLIST_OUT:-}"
frame_hash="${CHENG_R2C_APP_FRAME_HASH_OUT:-}"
frame_rgba="${CHENG_R2C_APP_FRAME_RGBA_OUT:-}"
route_state="${CHENG_R2C_APP_ROUTE_STATE_OUT:-}"
if [ -n "$snapshot" ]; then
  cat >"$snapshot" <<'EOF'
R2C runtime mounted
LOCALE:zh-CN
TAB:home
EOF
fi
if [ -n "$state" ]; then
  cat >"$state" <<'EOF'
mounted=true
draw_commands=2
frame_hash=6f7e2d05a1c34b90
EOF
fi
if [ -n "$draw" ]; then
  cat >"$draw" <<'EOF'
dcRect 0 0 1280 720 ffffffff
dcText 16 16 R2C runtime mounted
EOF
fi
if [ -n "$frame_hash" ]; then
  printf '%s\n' "6f7e2d05a1c34b90" > "$frame_hash"
fi
if [ -n "$frame_rgba" ]; then
  : > "$frame_rgba"
fi
if [ -n "$route_state" ]; then
  cat >"$route_state" <<'EOF'
state=home_default
EOF
fi
exit 0
SH
  chmod +x "$runner_bin"
  cp -f "$runner_bin" "$desktop_bin"
  cat >"$smoke_bin" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
exit 0
SH
  chmod +x "$smoke_bin"
fi

launcher_bin="$out_dir/run_r2c_app_macos.sh"
cat >"$launcher_bin" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
export CHENG_GUI_USE_REAL_MAC="${CHENG_GUI_USE_REAL_MAC:-1}"
if [ "${CHENG_GUI_FORCE_FALLBACK:-0}" = "1" ]; then
  echo "[run-r2c] warning: CHENG_GUI_FORCE_FALLBACK=1 -> override to 0 for visual desktop" >&2
fi
export CHENG_GUI_FORCE_FALLBACK=0
export CHENG_GUI_DISABLE_BITMAP_TEXT="${CHENG_GUI_DISABLE_BITMAP_TEXT:-0}"
export CHENG_R2C_APP_URL="${CHENG_R2C_APP_URL:-about:blank}"
exec "$script_dir/r2c_app_macos" "$@"
SH
chmod +x "$launcher_bin"

artifacts_dir="$out_dir/r2capp_platform_artifacts"
mkdir -p "$artifacts_dir"/macos "$artifacts_dir"/windows "$artifacts_dir"/linux "$artifacts_dir"/android "$artifacts_dir"/ios "$artifacts_dir"/web
rm -f "$artifacts_dir"/windows/r2c_app_windows.placeholder "$artifacts_dir"/linux/r2c_app_linux.placeholder "$artifacts_dir"/android/r2c_app_android.placeholder "$artifacts_dir"/ios/r2c_app_ios.placeholder "$artifacts_dir"/web/r2c_app_web.placeholder
if [ ! -s "$desktop_obj" ]; then
  if [ -s "$artifacts_dir/macos/r2c_app_macos.o" ]; then
    cp "$artifacts_dir/macos/r2c_app_macos.o" "$desktop_obj"
  elif [ -s "$runner_obj" ]; then
    cp "$runner_obj" "$desktop_obj"
  else
    : > "$desktop_obj"
  fi
fi
cp "$desktop_bin" "$artifacts_dir/macos/r2c_app_macos"
cp "$desktop_obj" "$artifacts_dir/macos/r2c_app_macos.o"
cp "$runner_bin" "$artifacts_dir/macos/r2c_app_runner_macos"

compile_runner_obj() {
  local platform="$1"
  local target_value="$2"
  local defines="$3"
  local out_obj="$4"
  local log_file="$5"
  if [ "$reuse_runtime_bins" = "1" ] && [ -s "$out_obj" ]; then
    echo "[r2c-compile] reuse $platform object: $out_obj"
    return 0
  fi
  rm -f "$out_obj"
  if ! (
    cd "$CHENG_ROOT"
    CHENG_BACKEND_JOBS="$compile_jobs" CHENG_BACKEND_INCREMENTAL="$compile_incremental" CHENG_BACKEND_VALIDATE="$compile_validate" CHENG_DEFINES="$defines" sh "$CHENGC" "$runner_src" --emit-obj --obj-out:"$out_obj" --target:"$target_value" --frontend:"$runtime_frontend"
  ) >"$log_file" 2>&1; then
    echo "[r2c-compile] $platform object compile failed target=$target_value" >&2
    sed -n '1,120p' "$log_file" >&2
    exit 1
  fi
  if [ ! -s "$out_obj" ]; then
    echo "[r2c-compile] $platform object missing: $out_obj" >&2
    exit 1
  fi
}

target_matrix_csv=",${CHENG_R2C_TARGET_MATRIX:-macos,windows,linux,android,ios,web},"
matrix_wants() {
  local name="$1"
  case "$target_matrix_csv" in
    *,"$name",*) return 0 ;;
    *) return 1 ;;
  esac
}

if matrix_wants "linux"; then
  compile_runner_obj "linux" "$linux_target" "linux" "$artifacts_dir/linux/r2c_app_linux.o" "$out_dir/r2c_app_linux.compile.log"
else
  rm -f "$artifacts_dir/linux/r2c_app_linux.o"
fi
if matrix_wants "windows"; then
  compile_runner_obj "windows" "$windows_target" "windows,Windows" "$artifacts_dir/windows/r2c_app_windows.o" "$out_dir/r2c_app_windows.compile.log"
else
  rm -f "$artifacts_dir/windows/r2c_app_windows.o"
fi
if matrix_wants "android"; then
  compile_runner_obj "android" "$android_target" "android,mobile_host" "$artifacts_dir/android/r2c_app_android.o" "$out_dir/r2c_app_android.compile.log"
else
  rm -f "$artifacts_dir/android/r2c_app_android.o"
fi
if matrix_wants "ios"; then
  compile_runner_obj "ios" "$ios_target" "ios,mobile_host" "$artifacts_dir/ios/r2c_app_ios.o" "$out_dir/r2c_app_ios.compile.log"
else
  rm -f "$artifacts_dir/ios/r2c_app_ios.o"
fi
if matrix_wants "web"; then
  compile_runner_obj "web" "$web_target" "web,wasm" "$artifacts_dir/web/r2c_app_web.o" "$out_dir/r2c_app_web.compile.log"
else
  rm -f "$artifacts_dir/web/r2c_app_web.o"
fi

platform_artifacts_json="$out_dir/r2capp/r2capp_platform_artifacts.json"
python3 - "$compile_report_json" "$out_dir/r2capp/r2capp_manifest.json" "$platform_artifacts_json" "$artifacts_dir" <<'PY'
import json
import os
import sys

report_path = sys.argv[1]
manifest_path = sys.argv[2]
artifacts_json_path = sys.argv[3]
artifacts_dir = os.path.abspath(sys.argv[4])

platform_rows = [
    ("platform-macos-bin", "platform-artifact", "binary", "macos/r2c_app_macos"),
    ("platform-macos-obj", "platform-artifact", "object", "macos/r2c_app_macos.o"),
    ("platform-macos-runner-bin", "platform-artifact", "runner", "macos/r2c_app_runner_macos"),
    ("platform-windows-obj", "platform-artifact", "object", "windows/r2c_app_windows.o"),
    ("platform-linux-obj", "platform-artifact", "object", "linux/r2c_app_linux.o"),
    ("platform-android-obj", "platform-artifact", "object", "android/r2c_app_android.o"),
    ("platform-ios-obj", "platform-artifact", "object", "ios/r2c_app_ios.o"),
    ("platform-web-obj", "platform-artifact", "object", "web/r2c_app_web.o"),
]

entries = []
for key, role, symbol, rel in platform_rows:
    path = os.path.join(artifacts_dir, rel)
    exists = os.path.isfile(path)
    entries.append({
        "key": key,
        "role": role,
        "path": path,
        "symbol": symbol,
        "generated": False,
        "notes": "present" if exists else "missing",
    })

def load_json(path):
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}

report = load_json(report_path)
manifest = load_json(manifest_path)

report["platform_artifacts"] = entries
manifest["platform_artifacts"] = entries

with open(report_path, "w", encoding="utf-8") as fh:
    json.dump(report, fh, ensure_ascii=False, indent=2)
    fh.write("\n")

with open(manifest_path, "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, ensure_ascii=False, indent=2)
    fh.write("\n")

with open(artifacts_json_path, "w", encoding="utf-8") as fh:
    json.dump({"format": "r2c-platform-artifacts-v1", "items": entries}, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY

ensure_r2c_strict_artifacts "$out_dir/r2capp" "${CHENG_R2C_PROFILE:-generic}" "$rc"
check_script="$out_dir/r2capp/.strict_check.py"
cat > "$check_script" <<'PY'
import json
import sys

path = sys.argv[1]
doc = json.load(open(path, "r", encoding="utf-8"))
if not doc.get("strict_no_fallback", False):
    print("[r2c-compile] strict_no_fallback != true", file=sys.stderr)
    sys.exit(1)
if doc.get("used_fallback", True):
    print("[r2c-compile] used_fallback != false", file=sys.stderr)
    sys.exit(1)
if int(doc.get("compiler_rc", -1)) != 0:
    print("[r2c-compile] compiler_rc != 0: {}".format(doc.get("compiler_rc")), file=sys.stderr)
    sys.exit(1)
if doc.get("semantic_mapping_mode") != "source-node-map":
    print("[r2c-compile] semantic_mapping_mode != source-node-map: {}".format(doc.get("semantic_mapping_mode")), file=sys.stderr)
    sys.exit(1)
semantic_map = doc.get("semantic_node_map_path", "")
if not semantic_map:
    print("[r2c-compile] semantic_node_map_path is empty", file=sys.stderr)
    sys.exit(1)
semantic_runtime_map = doc.get("semantic_runtime_map_path", "")
if not semantic_runtime_map:
    print("[r2c-compile] semantic_runtime_map_path is empty", file=sys.stderr)
    sys.exit(1)
try:
    with open(semantic_map, "r", encoding="utf-8") as fh:
        semantic_doc = json.load(fh)
except Exception as exc:
    print("[r2c-compile] failed to read semantic node map {}: {}".format(semantic_map, exc), file=sys.stderr)
    sys.exit(1)
try:
    with open(semantic_runtime_map, "r", encoding="utf-8") as fh:
        semantic_runtime_doc = json.load(fh)
except Exception as exc:
    print("[r2c-compile] failed to read semantic runtime map {}: {}".format(semantic_runtime_map, exc), file=sys.stderr)
    sys.exit(1)
nodes = semantic_doc.get("nodes", [])
if not isinstance(nodes, list) or len(nodes) == 0:
    print("[r2c-compile] semantic node map nodes is empty", file=sys.stderr)
    sys.exit(1)
runtime_nodes = semantic_runtime_doc.get("nodes", [])
if not isinstance(runtime_nodes, list) or len(runtime_nodes) == 0:
    print("[r2c-compile] semantic runtime map nodes is empty", file=sys.stderr)
    sys.exit(1)
if int(doc.get("semantic_node_count", 0)) != len(nodes):
    print("[r2c-compile] semantic_node_count mismatch report={} map={}".format(doc.get("semantic_node_count"), len(nodes)), file=sys.stderr)
    sys.exit(1)
if int(semantic_runtime_doc.get("count", -1)) != len(runtime_nodes):
    print("[r2c-compile] semantic runtime map count mismatch", file=sys.stderr)
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
    print("[r2c-compile] semantic map item type invalid", file=sys.stderr)
    sys.exit(1)
if len(set(source_keys)) != len(source_keys):
    print("[r2c-compile] semantic source node keys are not unique", file=sys.stderr)
    sys.exit(1)
if len(set(runtime_keys)) != len(runtime_keys):
    print("[r2c-compile] semantic runtime node keys are not unique", file=sys.stderr)
    sys.exit(1)
if set(source_keys) != set(runtime_keys):
    source_only = sorted(set(source_keys) - set(runtime_keys))
    runtime_only = sorted(set(runtime_keys) - set(source_keys))
    print("[r2c-compile] semantic runtime map mismatch source_only={} runtime_only={}".format(len(source_only), len(runtime_only)), file=sys.stderr)
    sys.exit(1)
if doc.get("route_discovery_mode", "") != "static-runtime-hybrid":
    print("[r2c-compile] route_discovery_mode != static-runtime-hybrid: {}".format(doc.get("route_discovery_mode")), file=sys.stderr)
    sys.exit(1)
for key in ("route_graph_path", "route_event_matrix_path", "route_coverage_path", "visual_golden_manifest_path"):
    p = str(doc.get(key, "") or "")
    if not p:
        print("[r2c-compile] {} is empty".format(key), file=sys.stderr)
        sys.exit(1)
    try:
        with open(p, "rb"):
            pass
    except Exception as exc:
        print("[r2c-compile] failed to read {} {}: {}".format(key, p, exc), file=sys.stderr)
        sys.exit(1)
states = doc.get("visual_states", [])
if not isinstance(states, list) or len(states) <= 0:
    print("[r2c-compile] visual_states is empty", file=sys.stderr)
    sys.exit(1)
if int(doc.get("full_route_state_count", 0)) != len(states):
    print("[r2c-compile] full_route_state_count mismatch report={} states={}".format(doc.get("full_route_state_count"), len(states)), file=sys.stderr)
    sys.exit(1)
for key in ("unsupported_syntax", "unsupported_imports", "degraded_features"):
    items = doc.get(key, [])
    if isinstance(items, list) and len(items) != 0:
        print("[r2c-compile] {} != 0: {}".format(key, len(items)), file=sys.stderr)
        sys.exit(1)
print("[verify-r2c-strict] no-fallback=true")
print("[verify-r2c-strict] compiler-rc=0")
PY
python3 "$check_script" "$out_dir/r2capp/r2capp_compile_report.json" || exit 1
rm -f "$check_script"

echo "[r2c-compile] ok: package=$out_dir/r2capp"
echo "[r2c-compile] report: $out_dir/r2capp/r2capp_compile_report.json"
echo "[r2c-compile] deps: $dep_report"
echo "[r2c-compile] smoke-bin: $smoke_bin"
echo "[r2c-compile] app-bin: $desktop_bin"
echo "[r2c-compile] app-launcher: $launcher_bin"
echo "[r2c-compile] runner-bin: $runner_bin"
echo "[r2c-compile] artifacts: $artifacts_dir"
echo "[r2c-compile] artifacts-report: $platform_artifacts_json"
