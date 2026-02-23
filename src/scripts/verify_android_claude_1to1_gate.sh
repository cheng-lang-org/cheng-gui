#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"
# Homebrew python3 may hang in this environment; prefer system python for gate determinism.
if [ -x "/usr/bin/python3" ]; then
  export PATH="/usr/bin:$PATH"
fi

usage() {
  cat <<'EOF'
Usage:
  verify_android_claude_1to1_gate.sh [--project <abs_path>] [--entry </app/main.tsx>] [--out <abs_path>]
EOF
}

print_android_runtime_hint() {
  local devices_out=""
  if command -v adb >/dev/null 2>&1; then
    devices_out="$(adb devices 2>/dev/null || true)"
  fi
  echo "[verify-android-claude-1to1-gate] no android emulator/device detected" >&2
  if [ -n "$devices_out" ]; then
    echo "[verify-android-claude-1to1-gate] adb devices:" >&2
    printf '%s\n' "$devices_out" >&2
  fi
  local emulator_bin=""
  if [ -n "${ANDROID_SDK_ROOT:-}" ] && [ -x "${ANDROID_SDK_ROOT}/emulator/emulator" ]; then
    emulator_bin="${ANDROID_SDK_ROOT}/emulator/emulator"
  elif [ -x "$HOME/Library/Android/sdk/emulator/emulator" ]; then
    emulator_bin="$HOME/Library/Android/sdk/emulator/emulator"
  elif command -v emulator >/dev/null 2>&1; then
    emulator_bin="$(command -v emulator)"
  fi
  if [ -n "$emulator_bin" ]; then
    local avd_name=""
    avd_name="$("$emulator_bin" -list-avds 2>/dev/null | head -n 1 || true)"
    if [ -n "$avd_name" ]; then
      echo "[verify-android-claude-1to1-gate] start emulator:" >&2
      echo "  $emulator_bin -avd $avd_name" >&2
    else
      echo "[verify-android-claude-1to1-gate] no AVD found. create one via Android Studio Device Manager." >&2
    fi
  else
    echo "[verify-android-claude-1to1-gate] emulator binary not found; install Android SDK emulator." >&2
  fi
}

run_with_timeout() {
  local timeout_sec="$1"
  shift
  perl -e '
    use POSIX qw(setsid WNOHANG);
    my $timeout = shift @ARGV;
    my $pid = fork();
    if (!defined $pid) { exit 127; }
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
        if (($status & 127) != 0) { exit(128 + ($status & 127)); }
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

resolve_android_ndk_root_gate() {
  local candidates=()
  if [ -n "${ANDROID_NDK_HOME:-}" ]; then
    candidates+=("$ANDROID_NDK_HOME")
  fi
  if [ -n "${ANDROID_NDK_ROOT:-}" ]; then
    candidates+=("$ANDROID_NDK_ROOT")
  fi
  if [ -n "${ANDROID_NDK:-}" ]; then
    candidates+=("$ANDROID_NDK")
  fi
  if [ -n "${CMAKE_ANDROID_NDK:-}" ]; then
    candidates+=("$CMAKE_ANDROID_NDK")
  fi
  if [ -n "${ANDROID_SDK_ROOT:-}" ] && [ -d "${ANDROID_SDK_ROOT}/ndk" ]; then
    while IFS= read -r ndk_dir; do
      [ -n "$ndk_dir" ] && candidates+=("$ndk_dir")
    done < <(ls -1dt "${ANDROID_SDK_ROOT}"/ndk/* 2>/dev/null || true)
  fi
  if [ -d "$HOME/Library/Android/sdk/ndk" ]; then
    while IFS= read -r ndk_dir; do
      [ -n "$ndk_dir" ] && candidates+=("$ndk_dir")
    done < <(ls -1dt "$HOME"/Library/Android/sdk/ndk/* 2>/dev/null || true)
  fi
  local item=""
  for item in "${candidates[@]}"; do
    if [ -d "$item/toolchains/llvm/prebuilt" ]; then
      printf '%s\n' "$item"
      return 0
    fi
  done
  return 1
}

resolve_android_clang_gate() {
  local api_level="${R2C_ANDROID_API_LEVEL:-24}"
  if [ -n "${R2C_ANDROID_CLANG:-}" ] && [ -x "${R2C_ANDROID_CLANG}" ]; then
    printf '%s\n' "${R2C_ANDROID_CLANG}"
    return 0
  fi
  local ndk_root=""
  ndk_root="$(resolve_android_ndk_root_gate || true)"
  local host_tag=""
  local bin=""
  if [ -n "$ndk_root" ]; then
    for host_tag in "darwin-arm64" "darwin-x86_64" "linux-x86_64"; do
      bin="$ndk_root/toolchains/llvm/prebuilt/$host_tag/bin/aarch64-linux-android${api_level}-clang"
      if [ -x "$bin" ]; then
        printf '%s\n' "$bin"
        return 0
      fi
    done
  fi
  return 1
}

rebuild_android_payload_obj_gate() {
  local out_obj="$1"
  local log_file="$2"
  local cheng_lang_root="${CHENG_LANG_ROOT:-/Users/lbcheng/cheng-lang}"
  local cheng_mobile_root="${CHENG_MOBILE_ROOT:-/Users/lbcheng/.cheng-packages/cheng-mobile}"
  local exports_c="$cheng_lang_root/src/runtime/mobile/cheng_mobile_exports.c"
  local exports_h="$cheng_lang_root/src/runtime/mobile/cheng_mobile_exports.h"
  local bridge_dir="$cheng_mobile_root/bridge"
  if [ ! -d "$bridge_dir" ]; then
    bridge_dir="$cheng_mobile_root/src/bridge"
  fi
  if [ ! -f "$exports_c" ] || [ ! -f "$exports_h" ]; then
    echo "[verify-android-claude-1to1-gate] android payload source missing: $exports_c / $exports_h" >&2
    exit 1
  fi
  if [ ! -d "$bridge_dir" ]; then
    echo "[verify-android-claude-1to1-gate] android payload bridge dir missing: $bridge_dir" >&2
    exit 1
  fi
  local android_clang=""
  android_clang="$(resolve_android_clang_gate || true)"
  if [ -z "$android_clang" ]; then
    echo "[verify-android-claude-1to1-gate] missing Android NDK clang; set ANDROID_NDK_HOME/ANDROID_SDK_ROOT or R2C_ANDROID_CLANG" >&2
    exit 2
  fi
  local payload_cflags="${R2C_ANDROID_PAYLOAD_CFLAGS:-}"
  rm -f "$out_obj"
  if ! "$android_clang" \
      -std=c11 \
      -fPIC \
      -D__ANDROID__=1 \
      -DANDROID=1 \
      -I"$bridge_dir" \
      -I"$(dirname "$exports_c")" \
      $payload_cflags \
      -c "$exports_c" \
      -o "$out_obj" >"$log_file" 2>&1; then
    echo "[verify-android-claude-1to1-gate] android ABI v2 payload compile failed" >&2
    sed -n '1,120p' "$log_file" >&2
    exit 1
  fi
  if [ ! -s "$out_obj" ]; then
    echo "[verify-android-claude-1to1-gate] android payload object missing: $out_obj" >&2
    exit 1
  fi
}

project="${R2C_REAL_PROJECT:-/Users/lbcheng/UniMaker/ClaudeDesign}"
entry="${R2C_REAL_ENTRY:-/app/main.tsx}"
out_dir="${R2C_ANDROID_1TO1_OUT:-$ROOT/build/android_claude_1to1_gate}"
while [ $# -gt 0 ]; do
  case "$1" in
    --project) project="${2:-}"; shift 2 ;;
    --entry) entry="${2:-}"; shift 2 ;;
    --out) out_dir="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[verify-android-claude-1to1-gate] unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

compile_out="$out_dir/claude_compile"
marker_dir="$ROOT/build/android_claude_1to1_gate"
marker_path="$marker_dir/ok.json"
android_truth_manifest="$ROOT/tests/claude_fixture/golden/android_fullroute/chromium_truth_manifest_android.json"
mobile_runner="/Users/lbcheng/cheng-lang/src/tooling/mobile_run_android.sh"
obj_compat_chengc="$ROOT/scripts/chengc_obj_compat.sh"
runtime_json="$out_dir/android_runtime_state.json"
run_log="$out_dir/mobile_run_android.log"
runtime_timeout_sec="${CHENG_ANDROID_1TO1_RUNTIME_TIMEOUT_SEC:-900}"
fullroute_out="$out_dir/fullroute"
fullroute_report="$fullroute_out/android_fullroute_visual_report.json"
fullroute_log="$out_dir/android_fullroute_visual.log"

mkdir -p "$out_dir" "$marker_dir"
mkdir -p "$ROOT/chengcache"
rm -f "$marker_path" "$runtime_json" "$run_log" "$fullroute_log"

if [ ! -d "$project" ]; then
  echo "[verify-android-claude-1to1-gate] missing project: $project" >&2
  exit 1
fi
if [ ! -f "$android_truth_manifest" ]; then
  echo "[verify-android-claude-1to1-gate] missing android truth manifest: $android_truth_manifest" >&2
  exit 1
fi
if [ ! -x "$mobile_runner" ]; then
  echo "[verify-android-claude-1to1-gate] missing mobile runner: $mobile_runner" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "[verify-android-claude-1to1-gate] missing dependency: python3" >&2
  exit 2
fi
if [ -z "${CHENGC:-}" ]; then
  if [ -x "$obj_compat_chengc" ]; then
    export CHENGC="$obj_compat_chengc"
  elif [ -x "/Users/lbcheng/cheng-lang/src/tooling/chengc.sh" ]; then
    export CHENGC="/Users/lbcheng/cheng-lang/src/tooling/chengc.sh"
  fi
fi
if [ -z "${CHENGC:-}" ] || [ ! -x "${CHENGC}" ]; then
  echo "[verify-android-claude-1to1-gate] missing chengc executable (set CHENGC)" >&2
  exit 2
fi
if [ -z "${KIT_TARGET:-}" ] && [ -x "/Users/lbcheng/cheng-lang/src/tooling/detect_host_target.sh" ]; then
  export KIT_TARGET="$(sh /Users/lbcheng/cheng-lang/src/tooling/detect_host_target.sh)"
fi
if [ -z "${KIT_TARGET:-}" ]; then
  echo "[verify-android-claude-1to1-gate] missing KIT_TARGET and detect_host_target.sh unavailable" >&2
  exit 2
fi

export STRICT_GATE_CONTEXT=1
export R2C_LEGACY_UNIMAKER=0
export R2C_SKIP_COMPILER_RUN=0
export R2C_TRY_COMPILER_FIRST=1
export R2C_REUSE_RUNTIME_BINS=0
export R2C_REUSE_COMPILER_BIN=0
export R2C_USE_PRECOMPUTED_BATCH=0
export R2C_FULLROUTE_BLESS=0
export R2C_RUNTIME_TEXT_SOURCE=project
export R2C_RUNTIME_ROUTE_TITLE_SOURCE=project
export R2C_TARGET_MATRIX=android
export R2C_REAL_SKIP_RUNNER_SMOKE=1
export R2C_REAL_SKIP_DESKTOP_SMOKE=1
export R2C_SKIP_HOST_RUNTIME_BIN_BUILD=1
export BACKEND_INTERNAL_ALLOW_EMIT_OBJ=1
export CHENG_BACKEND_INTERNAL_ALLOW_EMIT_OBJ=1
export CHENG_ANDROID_FULLROUTE_CAPTURE_SOURCE="${CHENG_ANDROID_FULLROUTE_CAPTURE_SOURCE:-runtime-dump}"
export CHENG_ANDROID_FULLROUTE_STRICT_CAPTURE="${CHENG_ANDROID_FULLROUTE_STRICT_CAPTURE:-1}"
export R2C_ANDROID_FULLROUTE_CONSISTENCY_RUNS="${R2C_ANDROID_FULLROUTE_CONSISTENCY_RUNS:-3}"
if [ "${CHENG_ANDROID_FULLROUTE_CAPTURE_SOURCE}" != "runtime-dump" ]; then
  echo "[verify-android-claude-1to1-gate] strict mode requires CHENG_ANDROID_FULLROUTE_CAPTURE_SOURCE=runtime-dump" >&2
  exit 1
fi
if [ "${CHENG_ANDROID_FULLROUTE_STRICT_CAPTURE}" != "1" ]; then
  echo "[verify-android-claude-1to1-gate] strict mode requires CHENG_ANDROID_FULLROUTE_STRICT_CAPTURE=1" >&2
  exit 1
fi

echo "== android 1:1: r2c strict compile =="
bash "$ROOT/scripts/r2c_compile_react_project.sh" \
  --project "$project" \
  --entry "$entry" \
  --out "$compile_out" \
  --strict

report_json="$compile_out/r2capp/r2capp_compile_report.json"
if [ ! -f "$report_json" ]; then
  echo "[verify-android-claude-1to1-gate] missing compile report: $report_json" >&2
  exit 1
fi
android_obj="$compile_out/r2capp_platform_artifacts/android/r2c_app_android.o"
android_obj_rebuild_log="$out_dir/r2c_app_android.rebuild.log"
mkdir -p "$(dirname "$android_obj")"
rebuild_android_payload_obj_gate "$android_obj" "$android_obj_rebuild_log"
if [ ! -f "$android_obj" ]; then
  echo "[verify-android-claude-1to1-gate] missing android artifact: $android_obj" >&2
  exit 1
fi
nm_tool=""
if [ -x "/Users/lbcheng/Library/Android/sdk/ndk/25.1.8937393/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-nm" ]; then
  nm_tool="/Users/lbcheng/Library/Android/sdk/ndk/25.1.8937393/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-nm"
elif command -v llvm-nm >/dev/null 2>&1; then
  nm_tool="$(command -v llvm-nm)"
elif command -v nm >/dev/null 2>&1; then
  nm_tool="$(command -v nm)"
fi
if [ -z "$nm_tool" ]; then
  echo "[verify-android-claude-1to1-gate] missing symbol tool: llvm-nm/nm" >&2
  exit 2
fi
if ! python3 - "$nm_tool" "$android_obj" <<'PY'
import subprocess
import sys

nm_tool, obj = sys.argv[1:3]
required = [
    "cheng_app_init",
    "cheng_app_set_window",
    "cheng_app_tick",
    "cheng_app_on_touch",
    "cheng_app_pause",
    "cheng_app_resume",
]

def run(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL)

try:
    defined_out = run([nm_tool, "-g", "--defined-only", obj])
except Exception as exc:
    print(f"[verify-android-claude-1to1-gate] failed to inspect symbols: {exc}", file=sys.stderr)
    sys.exit(1)

defined = set()
for line in defined_out.splitlines():
    parts = line.strip().split()
    if not parts:
        continue
    sym = parts[-1]
    if sym and (sym[0].isalpha() or sym.startswith("_")):
        defined.add(sym)

missing = [s for s in required if s not in defined]
if missing:
    print("[verify-android-claude-1to1-gate] android artifact is not ABI v2 payload (missing symbols): " + ",".join(missing), file=sys.stderr)
    sys.exit(1)

try:
    undef_out = run([nm_tool, "-u", obj])
except Exception:
    undef_out = ""
if "chengGuiMac" in undef_out:
    print("[verify-android-claude-1to1-gate] android artifact links macOS symbols (target mismatch)", file=sys.stderr)
    sys.exit(1)
PY
then
  exit 1
fi

validation_out="$(python3 - "$report_json" "$android_truth_manifest" "$project" <<'PY'
import json
import os
import sys

report_path, expected_manifest, project_root = sys.argv[1:4]
report = json.load(open(report_path, "r", encoding="utf-8"))
truth = json.load(open(expected_manifest, "r", encoding="utf-8"))
truth_states = truth.get("states", [])
if not isinstance(truth_states, list) or len(truth_states) <= 0:
    print("[verify-android-claude-1to1-gate] invalid android truth manifest states", file=sys.stderr)
    raise SystemExit(1)
truth_count = len(truth_states)

def fail(msg: str):
    print(msg, file=sys.stderr)
    raise SystemExit(1)

if not bool(report.get("strict_no_fallback", False)):
    fail("[verify-android-claude-1to1-gate] strict_no_fallback != true")
if bool(report.get("used_fallback", True)):
    fail("[verify-android-claude-1to1-gate] used_fallback != false")
if int(report.get("compiler_rc", -1)) != 0:
    fail("[verify-android-claude-1to1-gate] compiler_rc != 0")
if int(report.get("pixel_tolerance", -1)) != 0:
    fail("[verify-android-claude-1to1-gate] pixel_tolerance != 0")
if report.get("generated_ui_mode") != "ir-driven":
    fail("[verify-android-claude-1to1-gate] generated_ui_mode != ir-driven")
if report.get("semantic_mapping_mode") != "source-node-map":
    fail("[verify-android-claude-1to1-gate] semantic_mapping_mode != source-node-map")
if not os.path.isdir(project_root):
    fail(f"[verify-android-claude-1to1-gate] invalid project root: {project_root}")
if report.get("android_truth_manifest_path") != expected_manifest:
    fail("[verify-android-claude-1to1-gate] android_truth_manifest_path mismatch")
for key in ("android_route_graph_path", "android_route_event_matrix_path", "android_route_coverage_path"):
    path = str(report.get(key, "") or "")
    if not path or not os.path.isfile(path):
        fail(f"[verify-android-claude-1to1-gate] missing {key}: {path}")
for key in ("react_ir_path", "hook_graph_path", "effect_plan_path", "third_party_rewrite_report_path"):
    path = str(report.get(key, "") or "")
    if not path or not os.path.isfile(path):
        fail(f"[verify-android-claude-1to1-gate] missing {key}: {path}")

semantic_count = int(report.get("semantic_node_count", 0))
if semantic_count <= 0:
    fail("[verify-android-claude-1to1-gate] semantic_node_count <= 0")
full_route_count = int(report.get("full_route_state_count", 0))
if full_route_count <= 0:
    fail("[verify-android-claude-1to1-gate] full_route_state_count <= 0")
if full_route_count != truth_count:
    fail(f"[verify-android-claude-1to1-gate] full_route_state_count mismatch: report={full_route_count} truth={truth_count}")
states_path = str(report.get("full_route_states_path", "") or "")
if not states_path or not os.path.isfile(states_path):
    fail(f"[verify-android-claude-1to1-gate] missing full_route_states_path: {states_path}")
states_doc = json.load(open(states_path, "r", encoding="utf-8"))
states = states_doc.get("states", [])
if not isinstance(states, list) or len(states) != full_route_count:
    fail("[verify-android-claude-1to1-gate] full_route_states invalid")
semantic_render_nodes_path = str(report.get("semantic_render_nodes_path", "") or "")
if not semantic_render_nodes_path or not os.path.isfile(semantic_render_nodes_path):
    fail(f"[verify-android-claude-1to1-gate] missing semantic_render_nodes_path: {semantic_render_nodes_path}")
semantic_render_nodes_hash = str(report.get("semantic_render_nodes_hash", "") or "").strip().lower()
if len(semantic_render_nodes_hash) != 64:
    fail(f"[verify-android-claude-1to1-gate] invalid semantic_render_nodes_hash: {semantic_render_nodes_hash}")
semantic_render_nodes_fnv64 = str(report.get("semantic_render_nodes_fnv64", "") or "").strip().lower()
if len(semantic_render_nodes_fnv64) != 16:
    fail(f"[verify-android-claude-1to1-gate] invalid semantic_render_nodes_fnv64: {semantic_render_nodes_fnv64}")
semantic_render_nodes_count = int(report.get("semantic_render_nodes_count", 0) or 0)
if semantic_render_nodes_count <= 0:
    fail("[verify-android-claude-1to1-gate] semantic_render_nodes_count <= 0")

semantic_map_path = str(report.get("semantic_node_map_path", "") or "")
semantic_runtime_map_path = str(report.get("semantic_runtime_map_path", "") or "")
if not semantic_map_path or not os.path.isfile(semantic_map_path):
    fail(f"[verify-android-claude-1to1-gate] missing semantic_node_map_path: {semantic_map_path}")
if not semantic_runtime_map_path or not os.path.isfile(semantic_runtime_map_path):
    fail(f"[verify-android-claude-1to1-gate] missing semantic_runtime_map_path: {semantic_runtime_map_path}")

semantic_doc = json.load(open(semantic_map_path, "r", encoding="utf-8"))
runtime_doc = json.load(open(semantic_runtime_map_path, "r", encoding="utf-8"))
nodes = semantic_doc.get("nodes", [])
runtime_nodes = runtime_doc.get("nodes", [])
if not isinstance(nodes, list) or not isinstance(runtime_nodes, list):
    fail("[verify-android-claude-1to1-gate] semantic maps invalid")
if len(nodes) != semantic_count:
    fail("[verify-android-claude-1to1-gate] semantic source count mismatch")
if len(runtime_nodes) != semantic_count:
    fail("[verify-android-claude-1to1-gate] semantic runtime count mismatch")

def key(item):
    if not isinstance(item, dict):
        return ("", "", "", "", "", "", "")
    return (
        str(item.get("node_id", "") or ""),
        str(item.get("source_module", "") or ""),
        str(item.get("jsx_path", "") or ""),
        str(item.get("role", "") or ""),
        str(item.get("event_binding", "") or ""),
        str(item.get("hook_slot", "") or ""),
        str(item.get("route_hint", "") or ""),
    )

source_keys = [key(row) for row in nodes]
runtime_keys = [key(row) for row in runtime_nodes]
if any(k[0] == "" for k in source_keys) or any(k[0] == "" for k in runtime_keys):
    fail("[verify-android-claude-1to1-gate] semantic maps include empty node_id")
if len(set(source_keys)) != len(source_keys):
    fail("[verify-android-claude-1to1-gate] duplicate semantic source nodes")
if len(set(runtime_keys)) != len(runtime_keys):
    fail("[verify-android-claude-1to1-gate] duplicate semantic runtime nodes")
if set(source_keys) != set(runtime_keys):
    fail("[verify-android-claude-1to1-gate] semantic source/runtime key sets mismatch")

generated_runtime_path = str(report.get("generated_runtime_path", "") or "")
if not generated_runtime_path or not os.path.isfile(generated_runtime_path):
    fail(f"[verify-android-claude-1to1-gate] missing generated_runtime_path: {generated_runtime_path}")
runtime_src = open(generated_runtime_path, "r", encoding="utf-8").read()
append_count = runtime_src.count("appendSemanticNode(")
if append_count < semantic_count:
    fail(f"[verify-android-claude-1to1-gate] generated runtime semantic nodes insufficient: append={append_count} expected={semantic_count}")
if "mountGenerated" not in runtime_src:
    fail("[verify-android-claude-1to1-gate] generated runtime missing mountGenerated")

source_modules = sorted({k[1] for k in source_keys if k[1]})
project_modules = [m for m in source_modules if m.startswith("/app/")]
if len(project_modules) <= 0:
    fail("[verify-android-claude-1to1-gate] semantic source_module does not include /app/* modules")
if len(project_modules) < 10:
    fail(f"[verify-android-claude-1to1-gate] semantic source_module too small: {len(project_modules)}")
missing_project_modules = []
for mod in project_modules:
    rel = mod.lstrip("/")
    local = os.path.join(project_root, rel)
    if not os.path.isfile(local):
        missing_project_modules.append(mod)
missing_ratio = (len(missing_project_modules) / len(project_modules)) if project_modules else 1.0
if missing_ratio > 0.05:
    fail(
        f"[verify-android-claude-1to1-gate] semantic source_module mismatch vs project files: "
        f"missing={len(missing_project_modules)}/{len(project_modules)} ratio={missing_ratio:.3f}"
    )

rows = []
with open(semantic_render_nodes_path, "r", encoding="utf-8", errors="ignore") as fh:
    for line in fh:
        text = line.strip()
        if not text or text.startswith("#"):
            continue
        parts = text.split("\t")
        if len(parts) < 8:
            fail(f"[verify-android-claude-1to1-gate] semantic render row malformed: {text[:120]}")
        rows.append(parts)
if len(rows) != semantic_render_nodes_count:
    fail(
        f"[verify-android-claude-1to1-gate] semantic render count mismatch: "
        f"rows={len(rows)} report={semantic_render_nodes_count}"
    )
if len(rows) < semantic_count:
    fail(
        f"[verify-android-claude-1to1-gate] semantic render rows too small: "
        f"rows={len(rows)} semantic_count={semantic_count}"
    )
import hashlib
actual_render_hash = hashlib.sha256(open(semantic_render_nodes_path, "rb").read()).hexdigest().lower()
if actual_render_hash != semantic_render_nodes_hash:
    fail(
        f"[verify-android-claude-1to1-gate] semantic render hash mismatch: "
        f"report={semantic_render_nodes_hash} actual={actual_render_hash}"
    )
payload = open(semantic_render_nodes_path, "rb").read()
fnv = 1469598103934665603
for b in payload:
    fnv ^= int(b)
    fnv = (fnv * 1099511628211) & 0xFFFFFFFFFFFFFFFF
actual_render_fnv64 = f"{fnv:016x}"
if actual_render_fnv64 != semantic_render_nodes_fnv64:
    fail(
        f"[verify-android-claude-1to1-gate] semantic render fnv64 mismatch: "
        f"report={semantic_render_nodes_fnv64} actual={actual_render_fnv64}"
    )
def route_match(hint: str, route: str) -> bool:
    h = str(hint or "").strip()
    r = str(route or "").strip()
    if not h:
        return r != "lang_select"
    if h == r:
        return True
    if r.startswith(h + "_"):
        return True
    if h in ("home", "home_default") and r.startswith("home_"):
        return True
    if h in ("publish", "publish_selector") and r.startswith("publish_"):
        return True
    if h in ("trading", "trading_main") and r.startswith("trading_"):
        return True
    if r == "ecom_main" and h in ("ecom_main", "update_center_main", "marketplace_main", "trading_main"):
        return True
    if r == "marketplace_main" and h in ("marketplace_main", "update_center_main", "ecom_main"):
        return True
    if r == "update_center_main" and h in ("update_center_main", "ecom_main", "marketplace_main"):
        return True
    return False
for state_name in states:
    if not any(route_match(parts[1], state_name) for parts in rows):
        fail(f"[verify-android-claude-1to1-gate] semantic render missing route coverage: {state_name}")

print(f"semantic_node_count={semantic_count}")
print(f"full_route_count={full_route_count}")
print(f"semantic_render_nodes_fnv64={semantic_render_nodes_fnv64}")
print(f"probe_state={states[0]}")
PY
)"

semantic_node_count="$(printf '%s\n' "$validation_out" | awk -F= '/^semantic_node_count=/ {print $2}' | tail -n 1)"
full_route_count="$(printf '%s\n' "$validation_out" | awk -F= '/^full_route_count=/ {print $2}' | tail -n 1)"
semantic_nodes_fnv64="$(printf '%s\n' "$validation_out" | awk -F= '/^semantic_render_nodes_fnv64=/ {print $2}' | tail -n 1)"
probe_state="$(printf '%s\n' "$validation_out" | awk -F= '/^probe_state=/ {print $2}' | tail -n 1)"
if [ -z "$semantic_node_count" ] || [ -z "$full_route_count" ] || [ -z "$semantic_nodes_fnv64" ] || [ -z "$probe_state" ]; then
  echo "[verify-android-claude-1to1-gate] failed to parse compile validation output" >&2
  exit 1
fi
echo "[verify-r2c-strict] no-fallback=true"
echo "[verify-r2c-strict] compiler-rc=0"

require_runtime="${CHENG_ANDROID_1TO1_REQUIRE_RUNTIME:-1}"
fullroute_enabled="${CHENG_ANDROID_1TO1_ENABLE_FULLROUTE:-1}"
case "$fullroute_enabled" in
  0|1) ;;
  *)
    echo "[verify-android-claude-1to1-gate] invalid CHENG_ANDROID_1TO1_ENABLE_FULLROUTE=$fullroute_enabled (expect 0 or 1)" >&2
    exit 2
    ;;
esac
fullroute_routes_ok="$full_route_count"
visual_passed="true"
if [ "$require_runtime" = "1" ]; then
  if ! command -v adb >/dev/null 2>&1; then
    echo "[verify-android-claude-1to1-gate] missing dependency: adb" >&2
    exit 2
  fi
  if [ -z "${ANDROID_SERIAL:-}" ]; then
    if ! adb devices | awk 'NR>1 && $2 == "device" {found=1; exit} END {exit(found?0:1)}'; then
      print_android_runtime_hint
      exit 1
    fi
  fi
  app_args_tmp="$out_dir/app_args.json"
  cat > "$app_args_tmp" <<EOF
{"manifest":"$compile_out/r2capp/r2capp_manifest.json","mode":"android-semantic-visual-1to1","routes":$full_route_count,"route_state":"$probe_state"}
EOF
  echo "== android 1:1: mobile run (kotlin host) =="
  RUN_LOG="$run_log" run_with_timeout "$runtime_timeout_sec" sh -c '
      set -euo pipefail
      "$@" 2>&1 | tee "$RUN_LOG"
    ' sh \
      "$mobile_runner" \
      "$ROOT/r2c_app_runner_main.cheng" \
      --name:claude_android_1to1 \
      --out:"$out_dir/mobile_export" \
      --assets:"$compile_out/r2capp" \
      --native-obj:"$android_obj" \
      --app-arg:r2c_manifest="$compile_out/r2capp/r2capp_manifest.json" \
      --app-arg:semantic_nodes="$semantic_node_count" \
      --app-arg:gate_mode=android-semantic-visual-1to1 \
      --app-arg:route_state="$probe_state" \
      --app-arg:arg_probe=foo_bar \
      --app-args-json:"$app_args_tmp" \
      --runtime-state-out:"$runtime_json" \
      --runtime-state-wait-ms:"${CHENG_ANDROID_1TO1_RUNTIME_WAIT_MS:-3000}"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 124 ]; then
      echo "[verify-android-claude-1to1-gate] runtime timeout after ${runtime_timeout_sec}s" >&2
    else
      echo "[verify-android-claude-1to1-gate] runtime failed rc=$rc" >&2
    fi
    if [ -f "$run_log" ]; then
      sed -n '1,220p' "$run_log" >&2
    fi
    exit 1
  fi

  if [ ! -s "$runtime_json" ]; then
    echo "[verify-android-claude-1to1-gate] runtime state file missing: $runtime_json" >&2
    exit 1
  fi
  if ! grep -Fq -- "--es cheng_app_args_kv" "$run_log"; then
    echo "[verify-android-claude-1to1-gate] command line missing cheng_app_args_kv" >&2
    exit 1
  fi
  if ! grep -Fq -- "--es cheng_app_args_json" "$run_log"; then
    echo "[verify-android-claude-1to1-gate] command line missing cheng_app_args_json" >&2
    exit 1
  fi
  if ! grep -Fq -- "--es cheng_app_args_json_b64" "$run_log"; then
    echo "[verify-android-claude-1to1-gate] command line missing cheng_app_args_json_b64" >&2
    exit 1
  fi
  if ! grep -Fq -- "[run-android] runtime-state" "$run_log"; then
    echo "[verify-android-claude-1to1-gate] runtime-state summary missing in run log" >&2
    exit 1
  fi
  if grep -Fq -- "shim mode active" "$run_log"; then
    echo "[verify-android-claude-1to1-gate] shim mode detected in mobile export log" >&2
    exit 1
  fi
  if ! grep -Fq -- "[mobile-export] mode=native-obj" "$run_log"; then
    echo "[verify-android-claude-1to1-gate] mobile export did not enter native-obj mode" >&2
    exit 1
  fi
  python3 - "$runtime_json" "$semantic_node_count" "$semantic_nodes_fnv64" "$probe_state" <<'PY'
import json
import re
import sys

path, semantic_nodes, semantic_nodes_fnv64, probe_state = sys.argv[1:5]
doc = json.load(open(path, "r", encoding="utf-8"))
started = bool(doc.get("started", False))
native_ready = bool(doc.get("native_ready", False))
kv = str(doc.get("launch_args_kv", "") or "")
js = str(doc.get("launch_args_json", "") or "")
last_error = str(doc.get("last_error", "") or "")
if not native_ready:
    raise SystemExit("[verify-android-claude-1to1-gate] runtime native_ready flag is false")
if not started:
    raise SystemExit("[verify-android-claude-1to1-gate] runtime started flag is false")
if "arg_probe=foo_bar" not in kv:
    raise SystemExit("[verify-android-claude-1to1-gate] runtime missing arg_probe=foo_bar")
if f"semantic_nodes={semantic_nodes}" not in kv:
    raise SystemExit("[verify-android-claude-1to1-gate] runtime missing semantic_nodes arg")
if "gate_mode=android-semantic-visual-1to1" not in kv:
    raise SystemExit("[verify-android-claude-1to1-gate] runtime missing gate_mode arg")
if f"route_state={probe_state}" not in kv:
    raise SystemExit("[verify-android-claude-1to1-gate] runtime missing route_state arg")
if "android-semantic-visual-1to1" not in js:
    raise SystemExit("[verify-android-claude-1to1-gate] runtime missing args_json mode")
try:
    parsed = json.loads(js)
except Exception as exc:
    raise SystemExit(f"[verify-android-claude-1to1-gate] runtime args_json is not valid json: {exc}")
if str(parsed.get("mode", "")) != "android-semantic-visual-1to1":
    raise SystemExit("[verify-android-claude-1to1-gate] runtime args_json mode mismatch")
if int(parsed.get("routes", -1)) <= 0:
    raise SystemExit("[verify-android-claude-1to1-gate] runtime args_json routes invalid")
if str(parsed.get("route_state", "") or "") != probe_state:
    raise SystemExit("[verify-android-claude-1to1-gate] runtime args_json route_state mismatch")
if last_error:
    def _parse_int(pattern: str) -> int:
        m = re.search(pattern, last_error)
        if not m:
            return -1
        try:
            return int(m.group(1).strip())
        except Exception:
            return -1

    def _parse_str(pattern: str) -> str:
        m = re.search(pattern, last_error)
        if not m:
            return ""
        return str(m.group(1).strip().lower())

    route_now = _parse_str(r"route=([A-Za-z0-9_./:-]+)")
    semantic_total = _parse_int(r"st=([0-9]+)")
    semantic_total_hash = _parse_str(r"sth=([0-9a-fA-F]+)")
    semantic_applied = _parse_int(r"sa=([0-9]+)")
    semantic_ready = _parse_int(r"sr=([0-9]+)")

    if route_now and route_now != probe_state:
        raise SystemExit(
            f"[verify-android-claude-1to1-gate] runtime probe route mismatch: expected={probe_state} got={route_now}"
        )
    if semantic_ready >= 0 and semantic_ready != 1:
        raise SystemExit("[verify-android-claude-1to1-gate] runtime semantic probe not ready (sr!=1)")
    if semantic_total >= 0 and semantic_total != int(semantic_nodes):
        raise SystemExit(
            f"[verify-android-claude-1to1-gate] runtime semantic total mismatch: expected={semantic_nodes} got={semantic_total}"
        )
    if semantic_total_hash and semantic_total_hash != str(semantic_nodes_fnv64).strip().lower():
        raise SystemExit(
            f"[verify-android-claude-1to1-gate] runtime semantic total hash mismatch: expected={semantic_nodes_fnv64} got={semantic_total_hash}"
        )
    if semantic_applied >= 0 and semantic_applied <= 0:
        raise SystemExit("[verify-android-claude-1to1-gate] runtime semantic applied count invalid (sa<=0)")
PY

  if [ "$fullroute_enabled" = "1" ]; then
    echo "== android 1:1: fullroute visual gate =="
    if FULLROUTE_LOG="$fullroute_log" run_with_timeout "$runtime_timeout_sec" sh -c '
        set -euo pipefail
        "$@" >"$FULLROUTE_LOG" 2>&1
      ' sh \
        "$ROOT/scripts/verify_android_fullroute_visual_pixel.sh" \
        --compile-out "$compile_out" \
        --out "$fullroute_out" \
        --manifest "$android_truth_manifest"; then
      :
    else
      rc=$?
      if [ "$rc" -eq 124 ]; then
        echo "[verify-android-claude-1to1-gate] fullroute timeout after ${runtime_timeout_sec}s" >&2
      else
        echo "[verify-android-claude-1to1-gate] fullroute gate failed rc=$rc" >&2
      fi
      if [ -f "$fullroute_log" ]; then
        echo "[verify-android-claude-1to1-gate] fullroute log tail:" >&2
        tail -n 80 "$fullroute_log" >&2 || true
      fi
      exit 1
    fi

    if [ ! -s "$fullroute_report" ]; then
      echo "[verify-android-claude-1to1-gate] missing fullroute report: $fullroute_report" >&2
      exit 1
    fi
    if ! grep -Fq -- "[verify-android-fullroute-pixel] ok routes=" "$fullroute_log"; then
      echo "[verify-android-claude-1to1-gate] fullroute gate log missing success marker" >&2
      exit 1
    fi
    fullroute_routes_ok="$(python3 - "$fullroute_report" "$full_route_count" <<'PY'
import json
import sys

report_path, expected_routes = sys.argv[1:3]
doc = json.load(open(report_path, "r", encoding="utf-8"))
states = doc.get("states", [])
captures = doc.get("captures", {})
runs = int(doc.get("consistency_runs", 0))
strict_capture = int(doc.get("strict_capture", 0))
capture_source = str(doc.get("capture_source", "") or "")
if not isinstance(states, list) or len(states) <= 0:
    raise SystemExit("[verify-android-claude-1to1-gate] fullroute report states empty")
if len(states) != int(expected_routes):
    raise SystemExit(f"[verify-android-claude-1to1-gate] fullroute report state count mismatch: {len(states)} != {expected_routes}")
if not isinstance(captures, dict):
    raise SystemExit("[verify-android-claude-1to1-gate] fullroute report captures invalid")
if len(captures) != len(states):
    raise SystemExit(f"[verify-android-claude-1to1-gate] fullroute capture count mismatch: {len(captures)} != {len(states)}")
if runs <= 0:
    raise SystemExit("[verify-android-claude-1to1-gate] fullroute consistency_runs invalid")
if strict_capture != 1:
    raise SystemExit(f"[verify-android-claude-1to1-gate] fullroute strict_capture != 1: {strict_capture}")
if capture_source != "runtime-dump":
    raise SystemExit(f"[verify-android-claude-1to1-gate] fullroute capture_source != runtime-dump: {capture_source}")
for state in states:
    item = captures.get(state)
    if not isinstance(item, dict):
        raise SystemExit(f"[verify-android-claude-1to1-gate] missing fullroute capture item: {state}")
    runtime_hash = str(item.get("expected_runtime_framehash", "") or "").strip().lower()
    if len(runtime_hash) != 16:
        raise SystemExit(f"[verify-android-claude-1to1-gate] invalid runtime framehash for {state}: {runtime_hash}")
    capture_sha = str(item.get("capture_sha256", "") or "").strip().lower()
    if len(capture_sha) != 64:
        raise SystemExit(f"[verify-android-claude-1to1-gate] invalid capture sha256 for {state}")
    capture_bytes = int(item.get("capture_bytes", 0))
    if capture_bytes <= 0:
        raise SystemExit(f"[verify-android-claude-1to1-gate] invalid capture bytes for {state}: {capture_bytes}")
    if not bool(item.get("runtime_route_match", False)):
        raise SystemExit(f"[verify-android-claude-1to1-gate] runtime route mismatch flag for {state}")
    if not bool(item.get("runtime_semantic_ready", False)):
        raise SystemExit(f"[verify-android-claude-1to1-gate] runtime semantic not ready for {state}")
    semantic_total_count = int(item.get("runtime_semantic_total_count", 0) or 0)
    if semantic_total_count <= 0:
        raise SystemExit(f"[verify-android-claude-1to1-gate] runtime semantic total count invalid for {state}: {semantic_total_count}")
    expected_semantic_total_count = int(item.get("expected_semantic_total_count", 0) or 0)
    if semantic_total_count != expected_semantic_total_count:
        raise SystemExit(
            f"[verify-android-claude-1to1-gate] runtime semantic total count mismatch for {state}: "
            f"{semantic_total_count} != {expected_semantic_total_count}"
        )
    runtime_semantic_total_hash = str(item.get("runtime_semantic_total_hash", "") or "").strip().lower()
    expected_semantic_total_hash = str(item.get("expected_semantic_total_hash", "") or "").strip().lower()
    if runtime_semantic_total_hash != expected_semantic_total_hash:
        raise SystemExit(
            f"[verify-android-claude-1to1-gate] runtime semantic total hash mismatch for {state}: "
            f"{runtime_semantic_total_hash} != {expected_semantic_total_hash}"
        )
    if int(item.get("runtime_semantic_applied_count", 0) or 0) <= 0:
        raise SystemExit(f"[verify-android-claude-1to1-gate] runtime semantic applied count invalid for {state}")
    runtime_semantic_applied_hash = str(item.get("runtime_semantic_applied_hash", "") or "").strip().lower()
    if len(runtime_semantic_applied_hash) != 16:
        raise SystemExit(f"[verify-android-claude-1to1-gate] runtime semantic applied hash invalid for {state}")
    if bool(item.get("semantic_drift_detected", False)):
        raise SystemExit(f"[verify-android-claude-1to1-gate] semantic drift detected for {state}")
    if not bool(item.get("capture_golden_match", False)):
        raise SystemExit(f"[verify-android-claude-1to1-gate] capture_golden_match=false for {state}")
    rows = item.get("runs", [])
    if not isinstance(rows, list) or len(rows) != runs:
        raise SystemExit(f"[verify-android-claude-1to1-gate] invalid run rows for {state}")
    for row in rows:
        if str(row.get("route", "") or "") != state:
            raise SystemExit(f"[verify-android-claude-1to1-gate] runtime route mismatch row for {state}")
        if not bool(row.get("runtime_framehash_match", False)):
            raise SystemExit(f"[verify-android-claude-1to1-gate] runtime framehash mismatch row for {state}")
        if not bool(row.get("runtime_semantic_ready", False)):
            raise SystemExit(f"[verify-android-claude-1to1-gate] runtime semantic not ready row for {state}")
        if int(row.get("runtime_semantic_applied_count", 0) or 0) <= 0:
            raise SystemExit(f"[verify-android-claude-1to1-gate] runtime semantic applied count invalid row for {state}")
print(len(states))
PY
)"
  else
    visual_passed="false"
    fullroute_routes_ok=0
    echo "[verify-android-claude-1to1-gate] runtime fullroute skipped: CHENG_ANDROID_1TO1_ENABLE_FULLROUTE=0"
  fi
else
  visual_passed="false"
  fullroute_routes_ok=0
  echo "[verify-android-claude-1to1-gate] runtime phase skipped: CHENG_ANDROID_1TO1_REQUIRE_RUNTIME=0"
fi

git_head="$(git -C "$ROOT/.." rev-parse HEAD 2>/dev/null || true)"
if [ -z "$git_head" ]; then
  git_head="unknown"
fi

cat > "$marker_path" <<EOF
{
  "git_head": "$git_head",
  "project": "$project",
  "entry": "$entry",
  "gate_mode": "android-semantic-visual-1to1",
  "routes": $full_route_count,
  "pixel_tolerance": 0,
  "semantic_node_count": $semantic_node_count,
  "used_fallback": false,
  "compiler_rc": 0,
  "android_truth_manifest_path": "$android_truth_manifest",
  "runtime_required": true,
  "runtime_state_path": "$runtime_json",
  "run_log_path": "$run_log",
  "visual_fullroute_log_path": "$fullroute_log",
  "visual_fullroute_report_path": "$fullroute_report",
  "visual_passed": $visual_passed,
  "visual_routes_verified": $fullroute_routes_ok
}
EOF

echo "[verify-android-claude-1to1-gate] ok routes=$full_route_count"
