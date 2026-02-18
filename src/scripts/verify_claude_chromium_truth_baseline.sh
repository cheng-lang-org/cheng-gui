#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
golden_dir="$ROOT/tests/claude_fixture/golden/fullroute"
manifest_path="$golden_dir/chromium_truth_manifest.json"

if [ ! -d "$golden_dir" ]; then
  echo "[verify-claude-chromium-truth-baseline] missing golden dir: $golden_dir" >&2
  exit 1
fi
if [ ! -f "$manifest_path" ]; then
  echo "[verify-claude-chromium-truth-baseline] missing manifest: $manifest_path" >&2
  echo "[verify-claude-chromium-truth-baseline] run: $ROOT/scripts/freeze_claude_chromium_truth_baseline.sh" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "[verify-claude-chromium-truth-baseline] missing dependency: python3" >&2
  exit 2
fi

python3 - "$golden_dir" "$manifest_path" <<'PY'
import hashlib
import json
import os
import sys

golden_dir, manifest_path = sys.argv[1:3]
doc = json.load(open(manifest_path, "r", encoding="utf-8"))

if doc.get("format") != "claude-fullroute-chromium-truth-v1":
    raise SystemExit("manifest format mismatch")
if doc.get("source") != "external-chromium":
    raise SystemExit("manifest source mismatch")
if int(doc.get("routes", -1)) != 30:
    raise SystemExit("manifest routes mismatch")
if int(doc.get("pixel_tolerance", -1)) != 0:
    raise SystemExit("manifest pixel_tolerance mismatch")
if not str(doc.get("chromium_version", "")).strip():
    raise SystemExit("manifest chromium_version missing")
if not str(doc.get("chromium_bin", "")).strip():
    raise SystemExit("manifest chromium_bin missing")

states = doc.get("states", [])
if not isinstance(states, list) or len(states) != 30:
    raise SystemExit("manifest states mismatch")

seen = set()
for item in states:
    if not isinstance(item, dict):
        raise SystemExit("invalid state item")
    name = str(item.get("name", ""))
    if not name:
        raise SystemExit("state name missing")
    if name in seen:
        raise SystemExit(f"duplicate state: {name}")
    seen.add(name)
    rgba_file = item.get("rgba_file", f"{name}.rgba")
    framehash_file = item.get("framehash_file", f"{name}.framehash")
    rgba_path = os.path.join(golden_dir, rgba_file)
    framehash_path = os.path.join(golden_dir, framehash_file)
    if not os.path.isfile(rgba_path):
        raise SystemExit(f"missing rgba file: {rgba_file}")
    if not os.path.isfile(framehash_path):
        raise SystemExit(f"missing framehash file: {framehash_file}")
    rgba = open(rgba_path, "rb").read()
    actual_sha = hashlib.sha256(rgba).hexdigest()
    if actual_sha != item.get("rgba_sha256", ""):
        raise SystemExit(f"rgba sha mismatch: {name}")
    if len(rgba) != int(item.get("rgba_bytes", -1)):
        raise SystemExit(f"rgba size mismatch: {name}")
    framehash = open(framehash_path, "r", encoding="utf-8").read().strip()
    if framehash != item.get("framehash", ""):
        raise SystemExit(f"framehash mismatch: {name}")

rollup = hashlib.sha256(
    "\n".join(
        f"{s['name']}:{s['rgba_sha256']}:{s['framehash']}" for s in states
    ).encode("utf-8")
).hexdigest()
if rollup != doc.get("rollup_sha256", ""):
    raise SystemExit("rollup sha mismatch")
PY

echo "[verify-claude-chromium-truth-baseline] ok: $manifest_path"
