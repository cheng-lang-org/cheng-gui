#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
report_path="${1:-$ROOT/build/android_claude_1to1_gate/fullroute/android_fullroute_visual_report.json}"
manifest_path="${2:-$ROOT/tests/claude_fixture/golden/android_fullroute/chromium_truth_manifest_android.json}"

if [ ! -f "$report_path" ]; then
  echo "[freeze-android-runtime-truth] missing report: $report_path" >&2
  exit 1
fi
if [ ! -f "$manifest_path" ]; then
  echo "[freeze-android-runtime-truth] missing manifest: $manifest_path" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "[freeze-android-runtime-truth] missing dependency: python3" >&2
  exit 2
fi

python3 - "$report_path" "$manifest_path" <<'PY'
import datetime as dt
import hashlib
import json
import os
import shutil
import sys

report_path, manifest_path = sys.argv[1:3]
report = json.load(open(report_path, "r", encoding="utf-8"))
manifest = json.load(open(manifest_path, "r", encoding="utf-8"))
captures = report.get("captures", {})
if not isinstance(captures, dict) or len(captures) == 0:
    raise SystemExit("[freeze-android-runtime-truth] report captures empty")

golden_dir = os.path.dirname(os.path.abspath(manifest_path))
states = manifest.get("states", [])
if not isinstance(states, list) or len(states) == 0:
    raise SystemExit("[freeze-android-runtime-truth] manifest states empty")

for row in states:
    if not isinstance(row, dict):
        continue
    name = str(row.get("name", "") or "").strip()
    if not name:
        continue
    item = captures.get(name)
    if not isinstance(item, dict):
        raise SystemExit(f"[freeze-android-runtime-truth] missing capture for state={name}")
    runs = item.get("runs", [])
    if not isinstance(runs, list) or len(runs) == 0:
        raise SystemExit(f"[freeze-android-runtime-truth] empty runs for state={name}")
    src = str(runs[0].get("capture_path", "") or "")
    if not src or not os.path.isfile(src):
        raise SystemExit(f"[freeze-android-runtime-truth] missing capture path for state={name}: {src}")

    rgba_file = str(row.get("rgba_file", "") or "").strip()
    if not rgba_file:
        rgba_file = f"{name}.rgba"
        row["rgba_file"] = rgba_file
    framehash_file = str(row.get("framehash_file", "") or "").strip()
    if not framehash_file:
        framehash_file = f"{name}.framehash"
        row["framehash_file"] = framehash_file

    dst_rgba = os.path.join(golden_dir, rgba_file)
    shutil.copyfile(src, dst_rgba)
    data = open(dst_rgba, "rb").read()
    row["rgba_bytes"] = len(data)
    row["rgba_sha256"] = hashlib.sha256(data).hexdigest()

    runtime_hash = str(item.get("capture_framehash", "") or "").strip().lower()
    if not runtime_hash:
        runtime_hash = str(item.get("expected_runtime_framehash", "") or "").strip().lower()
    if not runtime_hash:
        raise SystemExit(f"[freeze-android-runtime-truth] missing framehash for state={name}")
    row["framehash"] = runtime_hash
    dst_hash = os.path.join(golden_dir, framehash_file)
    with open(dst_hash, "w", encoding="utf-8") as fh:
        fh.write(runtime_hash + "\n")

manifest["generated_at_utc"] = dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
manifest["source"] = "cheng-runtime-dump"
manifest["routes"] = len(states)
manifest["pixel_tolerance"] = 0

rollup = hashlib.sha256(
    "\n".join(
        f"{row.get('name','')}:{row.get('rgba_sha256','')}:{row.get('framehash','')}"
        for row in states
        if isinstance(row, dict)
    ).encode("utf-8")
).hexdigest()
manifest["rollup_sha256"] = rollup

with open(manifest_path, "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY

echo "[freeze-android-runtime-truth] ok: $manifest_path"
