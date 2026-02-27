#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"

usage() {
  cat <<'EOF'
Usage:
  verify_android_fullroute_visual_pixel.sh --compile-out <abs_path> [--out <abs_path>] [--manifest <abs_path>]
EOF
}

compile_out=""
out_dir="${R2C_ANDROID_FULLROUTE_OUT:-$ROOT/build/android_claude_1to1_gate/fullroute}"
truth_manifest="${R2C_ANDROID_TRUTH_MANIFEST:-$ROOT/tests/claude_fixture/golden/android_fullroute/chromium_truth_manifest_android.json}"
consistency_runs="${R2C_ANDROID_FULLROUTE_CONSISTENCY_RUNS:-3}"
strict_capture="${CHENG_ANDROID_FULLROUTE_STRICT_CAPTURE:-1}"
launch_retries="${CHENG_ANDROID_FULLROUTE_LAUNCH_RETRIES:-2}"
capture_source="${CHENG_ANDROID_FULLROUTE_CAPTURE_SOURCE:-runtime-dump}"
strict_framehash="${CHENG_ANDROID_FULLROUTE_STRICT_FRAMEHASH:-1}"
while [ $# -gt 0 ]; do
  case "$1" in
    --compile-out) compile_out="${2:-}"; shift 2 ;;
    --out) out_dir="${2:-}"; shift 2 ;;
    --manifest) truth_manifest="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[verify-android-fullroute-pixel] unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$compile_out" ]; then
  echo "[verify-android-fullroute-pixel] missing --compile-out" >&2
  exit 2
fi
if [ ! -d "$compile_out" ]; then
  echo "[verify-android-fullroute-pixel] missing compile out: $compile_out" >&2
  exit 1
fi
if [ ! -f "$truth_manifest" ]; then
  echo "[verify-android-fullroute-pixel] missing manifest: $truth_manifest" >&2
  exit 1
fi
if ! command -v adb >/dev/null 2>&1; then
  echo "[verify-android-fullroute-pixel] missing dependency: adb" >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "[verify-android-fullroute-pixel] missing dependency: python3" >&2
  exit 2
fi
case "$consistency_runs" in
  ''|*[!0-9]*)
    echo "[verify-android-fullroute-pixel] invalid consistency runs: $consistency_runs" >&2
    exit 2
    ;;
esac
if [ "$consistency_runs" -lt 1 ]; then
  echo "[verify-android-fullroute-pixel] invalid consistency runs: $consistency_runs" >&2
  exit 2
fi
case "$strict_capture" in
  0|1) ;;
  *)
    echo "[verify-android-fullroute-pixel] invalid strict capture mode: $strict_capture" >&2
    exit 2
    ;;
esac
case "$launch_retries" in
  ''|*[!0-9]*)
    echo "[verify-android-fullroute-pixel] invalid launch retries: $launch_retries" >&2
    exit 2
    ;;
esac
if [ "$launch_retries" -lt 1 ]; then
  echo "[verify-android-fullroute-pixel] invalid launch retries: $launch_retries" >&2
  exit 2
fi
case "$capture_source" in
  runtime-dump|screencap|auto) ;;
  *)
    echo "[verify-android-fullroute-pixel] invalid capture source: $capture_source" >&2
    exit 2
    ;;
esac
case "$strict_framehash" in
  0|1) ;;
  *)
    echo "[verify-android-fullroute-pixel] invalid strict framehash mode: $strict_framehash" >&2
    exit 2
    ;;
esac

mkdir -p "$out_dir"
python3 - "$compile_out" "$out_dir" "$truth_manifest" "$consistency_runs" "$strict_capture" "$launch_retries" "$capture_source" "$strict_framehash" <<'PY'
import base64
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import time

compile_out, out_dir, truth_manifest, consistency_runs_raw, strict_capture_raw, launch_retries_raw, capture_source, strict_framehash_raw = sys.argv[1:9]
consistency_runs = int(consistency_runs_raw)
strict_capture = int(strict_capture_raw)
launch_retries = int(launch_retries_raw)
strict_framehash = int(strict_framehash_raw)

states_json = os.path.join(compile_out, "r2capp", "r2c_fullroute_states.json")
manifest_json = os.path.join(compile_out, "r2capp", "r2capp_manifest.json")
compile_report_json = os.path.join(compile_out, "r2capp", "r2capp_compile_report.json")
if not os.path.isfile(states_json):
    raise SystemExit(f"[verify-android-fullroute-pixel] missing fullroute states: {states_json}")
if not os.path.isfile(manifest_json):
    raise SystemExit(f"[verify-android-fullroute-pixel] missing app manifest: {manifest_json}")
if not os.path.isfile(compile_report_json):
    raise SystemExit(f"[verify-android-fullroute-pixel] missing compile report: {compile_report_json}")

states_doc = json.load(open(states_json, "r", encoding="utf-8"))
states = states_doc.get("states", [])
if not isinstance(states, list) or len(states) <= 0:
    raise SystemExit("[verify-android-fullroute-pixel] states list is empty")

compile_report = json.load(open(compile_report_json, "r", encoding="utf-8"))
if bool(compile_report.get("template_runtime_used", False)):
    raise SystemExit("[verify-android-fullroute-pixel] semantic readiness failed: template_runtime_used=true")
expected_semantic_total_count = int(compile_report.get("semantic_render_nodes_count", 0) or 0)
expected_semantic_total_hash = str(compile_report.get("semantic_render_nodes_fnv64", "") or "").strip().lower()
if expected_semantic_total_count <= 0:
    raise SystemExit("[verify-android-fullroute-pixel] invalid semantic_render_nodes_count in compile report")
if len(expected_semantic_total_hash) != 16:
    raise SystemExit("[verify-android-fullroute-pixel] invalid semantic_render_nodes_fnv64 in compile report")

truth_doc = json.load(open(truth_manifest, "r", encoding="utf-8"))
truth_states = truth_doc.get("states", [])
if not isinstance(truth_states, list) or len(truth_states) <= 0:
    raise SystemExit("[verify-android-fullroute-pixel] truth manifest states empty")
truth_hash = {}
truth_rgba_sha = {}
truth_rgba_bytes = {}
truth_rgba_path = {}
truth_framehash_path = {}
truth_root = os.path.dirname(os.path.abspath(truth_manifest))
for row in truth_states:
    if not isinstance(row, dict):
        continue
    name = str(row.get("name", "") or "").strip()
    framehash = str(row.get("framehash", "") or "").strip().lower()
    rgba_sha = str(row.get("rgba_sha256", "") or "").strip().lower()
    rgba_bytes = int(row.get("rgba_bytes", 0) or 0)
    rgba_file = str(row.get("rgba_file", "") or "").strip()
    framehash_file = str(row.get("framehash_file", "") or "").strip()
    if name and framehash:
        truth_hash[name] = framehash
    if name and rgba_sha:
        truth_rgba_sha[name] = rgba_sha
    if name and rgba_bytes > 0:
        truth_rgba_bytes[name] = rgba_bytes
    if name and rgba_file:
        truth_rgba_path[name] = os.path.join(truth_root, rgba_file)
    if name and framehash_file:
        truth_framehash_path[name] = os.path.join(truth_root, framehash_file)

missing_truth = [s for s in states if s not in truth_hash]
if missing_truth:
    raise SystemExit(f"[verify-android-fullroute-pixel] states missing in truth manifest: {missing_truth[:5]}")
if strict_capture == 1:
    missing_rgba = [s for s in states if s not in truth_rgba_path or not os.path.isfile(truth_rgba_path[s])]
    if missing_rgba:
        raise SystemExit(f"[verify-android-fullroute-pixel] strict mode missing golden rgba files: {missing_rgba[:5]}")
    missing_hash = [s for s in states if s not in truth_framehash_path or not os.path.isfile(truth_framehash_path[s])]
    if missing_hash:
        raise SystemExit(f"[verify-android-fullroute-pixel] strict mode missing golden framehash files: {missing_hash[:5]}")

semantic_runtime_map_path = str(compile_report.get("semantic_runtime_map_path", "") or "").strip()
if not semantic_runtime_map_path or not os.path.isfile(semantic_runtime_map_path):
    raise SystemExit(f"[verify-android-fullroute-pixel] semantic readiness failed: missing semantic_runtime_map_path={semantic_runtime_map_path}")
semantic_runtime_doc = json.load(open(semantic_runtime_map_path, "r", encoding="utf-8"))
semantic_runtime_nodes = semantic_runtime_doc.get("nodes", [])
if not isinstance(semantic_runtime_nodes, list) or len(semantic_runtime_nodes) <= 0:
    raise SystemExit("[verify-android-fullroute-pixel] semantic readiness failed: runtime semantic nodes empty")
if not all(isinstance(row, dict) for row in semantic_runtime_nodes):
    raise SystemExit("[verify-android-fullroute-pixel] semantic readiness failed: runtime semantic node schema must be object")
if len(semantic_runtime_nodes) != expected_semantic_total_count:
    raise SystemExit(
        "[verify-android-fullroute-pixel] semantic readiness failed: runtime semantic node count mismatch "
        f"runtime={len(semantic_runtime_nodes)} expected={expected_semantic_total_count}"
    )

def route_match_hint(hint: str, state: str) -> bool:
    h = str(hint or "").strip()
    s = str(state or "").strip()
    if not h or not s:
        return False
    if h == s:
        return True
    if s.startswith(h + "_"):
        return True
    if h in ("home", "home_default") and s.startswith("home_"):
        return True
    if h in ("publish", "publish_selector") and s.startswith("publish_"):
        return True
    if h in ("trading", "trading_main") and s.startswith("trading_"):
        return True
    if h in ("ecom", "ecom_main") and s.startswith("ecom_"):
        return True
    if h in ("marketplace", "marketplace_main") and s.startswith("marketplace_"):
        return True
    if h in ("update_center", "update_center_main") and s.startswith("update_center_"):
        return True
    return False

missing_renderable_states = []
for state in states:
    renderable = 0
    for row in semantic_runtime_nodes:
        hint = str(row.get("route_hint", "") or "").strip()
        bucket = str(row.get("render_bucket", "") or "").strip()
        if not (route_match_hint(hint, state) or route_match_hint(bucket, state)):
            continue
        role = str(row.get("role", "") or "").strip().lower()
        text = str(row.get("text", "") or "").strip()
        props = row.get("props", {})
        if not isinstance(props, dict):
            props = {}
        prop_id = str(props.get("id", "") or "").strip()
        test_id = str(props.get("dataTestId", "") or "").strip()
        event_binding = str(row.get("event_binding", "") or "").strip()
        if role in ("element", "text", "event") or text or prop_id or test_id or event_binding:
            renderable += 1
    if renderable <= 0:
        missing_renderable_states.append(state)
if missing_renderable_states:
    raise SystemExit(
        "[verify-android-fullroute-pixel] semantic readiness failed: no renderable semantic nodes for states="
        + ",".join(missing_renderable_states[:10])
    )

def run(cmd, timeout=30, capture=True, check=True):
    if capture:
        p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    else:
        p = subprocess.run(cmd, timeout=timeout, check=False)
    if check and p.returncode != 0:
        out = ""
        err = ""
        if capture:
            out = p.stdout.decode("utf-8", "ignore")
            err = p.stderr.decode("utf-8", "ignore")
        raise RuntimeError(f"command failed rc={p.returncode}: {' '.join(cmd)}\n{out}\n{err}")
    return p

def sh_quote(text: str) -> str:
    return "'" + text.replace("'", "'\\''") + "'"

serial = os.environ.get("ANDROID_SERIAL", "").strip()
if not serial:
    p = run(["adb", "devices"], timeout=10, capture=True, check=True)
    for line in p.stdout.decode("utf-8", "ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("List of devices"):
            continue
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            serial = parts[0]
            break
if not serial:
    raise SystemExit("[verify-android-fullroute-pixel] no android device/emulator detected")

pkg = "com.cheng.mobile"
activity = "com.cheng.mobile/.ChengActivity"
wait_ms = int(str(os.environ.get("CHENG_ANDROID_FULLROUTE_RUNTIME_WAIT_MS", "12000") or "12000"))
wait_deadline_step = 0.25
capture_dir = os.path.join(out_dir, "captures")
os.makedirs(capture_dir, exist_ok=True)
summary = {
    "format": "android-fullroute-visual-gate-v1",
    "states": states,
    "consistency_runs": consistency_runs,
    "strict_capture": strict_capture,
    "launch_retries": launch_retries,
    "capture_source": capture_source,
    "strict_framehash": strict_framehash,
    "expected_semantic_total_count": expected_semantic_total_count,
    "expected_semantic_total_hash": expected_semantic_total_hash,
    "captures": {},
}

def pull_runtime_state(path: str):
    cmd = ["adb", "-s", serial, "shell", "run-as", pkg, "cat", "files/cheng_runtime_state.json"]
    p = run(cmd, timeout=5, capture=True, check=False)
    if p.returncode != 0:
        return None
    raw = p.stdout.decode("utf-8", "ignore").strip()
    if not raw:
        return None
    try:
        doc = json.loads(raw)
    except Exception:
        return None
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return doc

def fnv64(data: bytes) -> str:
    h = 1469598103934665603
    for b in data:
        h ^= b
        h = (h * 1099511628211) & 0xFFFFFFFFFFFFFFFF
    return f"{h:016x}"

def parse_runtime_trace(last_error: str):
    route = ""
    framehash = ""
    semantic_total_count = 0
    semantic_total_hash = ""
    semantic_applied_count = 0
    semantic_applied_hash = ""
    semantic_ready = 0
    m_route = re.search(r"route=([^ ]+)", last_error or "")
    if m_route:
        route = m_route.group(1).strip()
    m_hash = re.search(r"framehash=([0-9a-fA-F]+)", last_error or "")
    if m_hash:
        framehash = m_hash.group(1).strip().lower()
    m_st = re.search(r"st=([0-9]+)", last_error or "")
    if m_st:
        try:
            semantic_total_count = int(m_st.group(1).strip())
        except Exception:
            semantic_total_count = 0
    m_sth = re.search(r"sth=([0-9a-fA-F]+)", last_error or "")
    if m_sth:
        semantic_total_hash = m_sth.group(1).strip().lower()
    m_sa = re.search(r"sa=([0-9]+)", last_error or "")
    if m_sa:
        try:
            semantic_applied_count = int(m_sa.group(1).strip())
        except Exception:
            semantic_applied_count = 0
    m_sah = re.search(r"sah=([0-9a-fA-F]+)", last_error or "")
    if m_sah:
        semantic_applied_hash = m_sah.group(1).strip().lower()
    m_sr = re.search(r"sr=([0-9]+)", last_error or "")
    if m_sr:
        try:
            semantic_ready = int(m_sr.group(1).strip())
        except Exception:
            semantic_ready = 0
    return (
        route,
        framehash,
        semantic_total_count,
        semantic_total_hash,
        semantic_applied_count,
        semantic_applied_hash,
        semantic_ready,
    )

def launch_and_capture(state: str, expected_hash: str, run_idx: int):
    app_json = json.dumps(
        {
            "manifest": manifest_json,
            "mode": "android-semantic-visual-1to1",
            "routes": len(states),
            "route_state": state,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    app_json_b64 = base64.urlsafe_b64encode(app_json.encode("utf-8")).decode("ascii")
    frame_dump_file = f"r2c_frame_{state}.run{run_idx}.rgba"
    app_kv = f"r2c_manifest={manifest_json};route_state={state};gate_mode=android-semantic-visual-1to1;expected_framehash={expected_hash};frame_dump_file={frame_dump_file}"

    run(["adb", "-s", serial, "shell", "am", "force-stop", pkg], timeout=10, capture=True, check=False)
    run(["adb", "-s", serial, "shell", "run-as", pkg, "rm", "-f", "files/cheng_runtime_state.json"], timeout=10, capture=True, check=False)
    run(["adb", "-s", serial, "shell", "run-as", pkg, "rm", "-f", f"files/{frame_dump_file}"], timeout=10, capture=True, check=False)
    remote_cmd = (
        "am start -n " + sh_quote(activity)
        + " --es cheng_app_args_kv " + sh_quote(app_kv)
        + " --es cheng_app_args_json " + sh_quote(app_json)
        + " --es cheng_app_args_json_b64 " + sh_quote(app_json_b64)
    )
    launch_cmd = ["adb", "-s", serial, "shell", remote_cmd]
    p_launch = run(launch_cmd, timeout=20, capture=True, check=False)
    launch_text = (p_launch.stdout + p_launch.stderr).decode("utf-8", "ignore")
    if p_launch.returncode != 0:
        raise SystemExit(f"[verify-android-fullroute-pixel] launch failed state={state} run={run_idx}: {launch_text}")
    if "Error:" in launch_text or "does not exist" in launch_text:
        raise SystemExit(f"[verify-android-fullroute-pixel] launch error state={state} run={run_idx}: {launch_text.strip()}")

    runtime_path = os.path.join(capture_dir, f"{state}.run{run_idx}.runtime.json")
    state_doc = None
    route_now = ""
    hash_now = ""
    semantic_total_count_now = 0
    semantic_total_hash_now = ""
    semantic_applied_count_now = 0
    semantic_applied_hash_now = ""
    semantic_ready_now = 0
    end_ts = time.time() + (wait_ms / 1000.0)
    while time.time() < end_ts:
        state_doc = pull_runtime_state(runtime_path)
        if state_doc is not None:
            if not bool(state_doc.get("started", False)):
                time.sleep(wait_deadline_step)
                continue
            (
                route_now,
                hash_now,
                semantic_total_count_now,
                semantic_total_hash_now,
                semantic_applied_count_now,
                semantic_applied_hash_now,
                semantic_ready_now,
            ) = parse_runtime_trace(str(state_doc.get("last_error", "") or ""))
            if route_now == state and hash_now and semantic_ready_now == 1:
                break
        time.sleep(wait_deadline_step)
    if state_doc is None:
        raise SystemExit(f"[verify-android-fullroute-pixel] missing runtime state for state={state} run={run_idx}")
    if not bool(state_doc.get("native_ready", False)):
        raise SystemExit(f"[verify-android-fullroute-pixel] native_ready=false state={state} run={run_idx}")
    if not bool(state_doc.get("started", False)):
        raise SystemExit(f"[verify-android-fullroute-pixel] started=false state={state} run={run_idx}")
    launch_kv = str(state_doc.get("launch_args_kv", "") or "")
    if f"route_state={state}" not in launch_kv:
        raise SystemExit(f"[verify-android-fullroute-pixel] launch args not refreshed for state={state} run={run_idx}")
    if f"expected_framehash={expected_hash}" not in launch_kv:
        raise SystemExit(f"[verify-android-fullroute-pixel] launch args missing expected_framehash for state={state} run={run_idx}")

    if not route_now or not hash_now:
        last_error = str(state_doc.get("last_error", "") or "")
        (
            route_now,
            hash_now,
            semantic_total_count_now,
            semantic_total_hash_now,
            semantic_applied_count_now,
            semantic_applied_hash_now,
            semantic_ready_now,
        ) = parse_runtime_trace(last_error)
    if route_now != state:
        raise SystemExit(f"[verify-android-fullroute-pixel] route mismatch state={state} run={run_idx} got={route_now}")
    if semantic_ready_now != 1:
        raise SystemExit(f"[verify-android-fullroute-pixel] semantic runtime not ready state={state} run={run_idx}")
    if semantic_total_count_now != expected_semantic_total_count:
        raise SystemExit(
            f"[verify-android-fullroute-pixel] semantic total count mismatch state={state} run={run_idx} "
            f"expected={expected_semantic_total_count} got={semantic_total_count_now}"
        )
    runtime_total_hash_norm = (semantic_total_hash_now or "").strip().lower()
    if runtime_total_hash_norm != expected_semantic_total_hash:
        raise SystemExit(
            f"[verify-android-fullroute-pixel] semantic total hash mismatch state={state} run={run_idx} "
            f"expected={expected_semantic_total_hash} got={runtime_total_hash_norm}"
        )
    if semantic_applied_count_now <= 0:
        raise SystemExit(
            f"[verify-android-fullroute-pixel] semantic applied count invalid state={state} run={run_idx} "
            f"value={semantic_applied_count_now}"
        )

    rgba = None
    w = 0
    h = 0
    fmt = 0
    if capture_source in ("runtime-dump", "auto"):
        dump_deadline = time.time() + (wait_ms / 1000.0)
        while time.time() < dump_deadline:
            p_dump = run(
                ["adb", "-s", serial, "shell", "run-as", pkg, "cat", f"files/{frame_dump_file}"],
                timeout=5,
                capture=True,
                check=False,
            )
            if p_dump.returncode == 0 and len(p_dump.stdout) > 0:
                rgba = p_dump.stdout
                break
            time.sleep(wait_deadline_step)
        if rgba is None and capture_source == "runtime-dump":
            raise SystemExit(f"[verify-android-fullroute-pixel] missing runtime dump state={state} run={run_idx} file={frame_dump_file}")
    if rgba is None and capture_source in ("screencap", "auto"):
        screencap = run(["adb", "-s", serial, "exec-out", "screencap"], timeout=20, capture=True, check=True).stdout
        if len(screencap) < 12:
            raise SystemExit(f"[verify-android-fullroute-pixel] screencap too short state={state} run={run_idx}")
        w, h, fmt = struct.unpack("<III", screencap[:12])
        rgba = screencap[12:]
        wanted = int(w) * int(h) * 4
        if wanted <= 0 or len(rgba) < wanted:
            raise SystemExit(
                f"[verify-android-fullroute-pixel] invalid screencap payload state={state} run={run_idx} w={w} h={h} fmt={fmt} size={len(rgba)}"
            )
        rgba = rgba[:wanted]
    if rgba is None:
        raise SystemExit(f"[verify-android-fullroute-pixel] no capture data state={state} run={run_idx}")
    rgba_path = os.path.join(capture_dir, f"{state}.run{run_idx}.rgba.out")
    with open(rgba_path, "wb") as fh:
        fh.write(rgba)
    capture_sha = hashlib.sha256(rgba).hexdigest()
    capture_hash = fnv64(rgba)
    runtime_hash_matches_capture = (hash_now == capture_hash)
    framehash_match = (capture_hash == expected_hash)
    if strict_framehash == 1 and not framehash_match:
        raise SystemExit(
            f"[verify-android-fullroute-pixel] framehash mismatch state={state} run={run_idx} expected={expected_hash} capture={capture_hash} runtime={hash_now}"
        )
    with open(os.path.join(capture_dir, f"{state}.run{run_idx}.capture.framehash"), "w", encoding="utf-8") as fh:
        fh.write(capture_hash + "\n")
    with open(os.path.join(capture_dir, f"{state}.run{run_idx}.route"), "w", encoding="utf-8") as fh:
        fh.write(state + "\n")
    return {
        "state": state,
        "run": run_idx,
        "route": route_now,
        "runtime_framehash": hash_now,
        "expected_runtime_framehash": expected_hash,
        "runtime_framehash_match": framehash_match,
        "runtime_reported_framehash_match_capture": runtime_hash_matches_capture,
        "runtime_route_match": bool(route_now == state),
        "runtime_semantic_ready": bool(semantic_ready_now == 1),
        "runtime_semantic_total_count": int(semantic_total_count_now),
        "runtime_semantic_total_hash": str(runtime_total_hash_norm),
        "runtime_semantic_applied_count": int(semantic_applied_count_now),
        "runtime_semantic_applied_hash": str((semantic_applied_hash_now or "").strip().lower()),
        "capture_framehash": capture_hash,
        "capture_sha256": capture_sha,
        "capture_bytes": len(rgba),
        "capture_path": rgba_path,
        "runtime_state_path": runtime_path,
        "width": int(w),
        "height": int(h),
        "format": int(fmt),
    }

routes_ok = 0
for state in states:
    state = str(state)
    expected_hash = truth_hash[state]
    run_rows = []
    for run_idx in range(1, consistency_runs + 1):
        row = None
        last_err = ""
        for attempt in range(1, launch_retries + 1):
            try:
                row = launch_and_capture(state, expected_hash, run_idx)
                break
            except SystemExit as exc:
                last_err = str(exc)
                if attempt >= launch_retries:
                    raise
                time.sleep(0.25)
        if row is None:
            raise SystemExit(f"[verify-android-fullroute-pixel] launch retries exhausted state={state} run={run_idx} err={last_err}")
        run_rows.append(row)
    first_sha = run_rows[0]["capture_sha256"]
    first_capture_hash = run_rows[0]["capture_framehash"]
    first_semantic_applied_hash = run_rows[0].get("runtime_semantic_applied_hash", "")
    first_semantic_applied_count = int(run_rows[0].get("runtime_semantic_applied_count", 0) or 0)
    drift = False
    semantic_drift = False
    for row in run_rows[1:]:
        if row["capture_sha256"] != first_sha:
            drift = True
            if strict_capture == 1:
                raise SystemExit(
                    f"[verify-android-fullroute-pixel] non-deterministic capture sha state={state} run={row['run']} expected={first_sha} got={row['capture_sha256']}"
                )
        if row["capture_framehash"] != first_capture_hash:
            drift = True
            if strict_capture == 1:
                raise SystemExit(
                    f"[verify-android-fullroute-pixel] non-deterministic capture framehash state={state} run={row['run']} expected={first_capture_hash} got={row['capture_framehash']}"
                )
        if row.get("runtime_semantic_applied_hash", "") != first_semantic_applied_hash:
            semantic_drift = True
            if strict_capture == 1:
                raise SystemExit(
                    f"[verify-android-fullroute-pixel] non-deterministic semantic applied hash state={state} "
                    f"run={row['run']} expected={first_semantic_applied_hash} got={row.get('runtime_semantic_applied_hash', '')}"
                )
        if int(row.get("runtime_semantic_applied_count", 0) or 0) != first_semantic_applied_count:
            semantic_drift = True
            if strict_capture == 1:
                raise SystemExit(
                    f"[verify-android-fullroute-pixel] non-deterministic semantic applied count state={state} "
                    f"run={row['run']} expected={first_semantic_applied_count} got={row.get('runtime_semantic_applied_count', 0)}"
                )
    golden_rgba_path = truth_rgba_path.get(state, "")
    golden_match = None
    if golden_rgba_path and os.path.isfile(golden_rgba_path):
        capture_data = open(run_rows[0]["capture_path"], "rb").read()
        golden_data = open(golden_rgba_path, "rb").read()
        golden_match = capture_data == golden_data
        if strict_capture == 1 and not golden_match:
            raise SystemExit(
                f"[verify-android-fullroute-pixel] pixel mismatch state={state} capture_sha={hashlib.sha256(capture_data).hexdigest()} golden_sha={hashlib.sha256(golden_data).hexdigest()} capture_bytes={len(capture_data)} golden_bytes={len(golden_data)}"
            )
    elif strict_capture == 1:
        raise SystemExit(f"[verify-android-fullroute-pixel] missing golden rgba path for state={state}")
    summary["captures"][state] = {
        "expected_runtime_framehash": expected_hash,
        "expected_semantic_total_count": expected_semantic_total_count,
        "expected_semantic_total_hash": expected_semantic_total_hash,
        "manifest_rgba_sha256": truth_rgba_sha.get(state, ""),
        "manifest_rgba_bytes": truth_rgba_bytes.get(state, 0),
        "manifest_rgba_path": golden_rgba_path,
        "manifest_framehash_path": truth_framehash_path.get(state, ""),
        "capture_sha256": first_sha,
        "capture_framehash": first_capture_hash,
        "capture_drift_detected": drift,
        "semantic_drift_detected": semantic_drift,
        "capture_golden_match": golden_match,
        "runtime_route_match": bool(run_rows[0].get("runtime_route_match", False)),
        "runtime_semantic_ready": bool(run_rows[0].get("runtime_semantic_ready", False)),
        "runtime_semantic_total_count": int(run_rows[0].get("runtime_semantic_total_count", 0) or 0),
        "runtime_semantic_total_hash": str(run_rows[0].get("runtime_semantic_total_hash", "") or ""),
        "runtime_semantic_applied_count": int(run_rows[0].get("runtime_semantic_applied_count", 0) or 0),
        "runtime_semantic_applied_hash": str(run_rows[0].get("runtime_semantic_applied_hash", "") or ""),
        "capture_bytes": run_rows[0]["capture_bytes"],
        "capture_width": run_rows[0]["width"],
        "capture_height": run_rows[0]["height"],
        "runs": run_rows,
    }
    routes_ok += 1

summary_path = os.path.join(out_dir, "android_fullroute_visual_report.json")
with open(summary_path, "w", encoding="utf-8") as fh:
    json.dump(summary, fh, ensure_ascii=False, indent=2)
    fh.write("\n")

print(f"[verify-android-fullroute-pixel] ok routes={routes_ok}")
print(f"[verify-android-fullroute-pixel] report={summary_path}")
PY
