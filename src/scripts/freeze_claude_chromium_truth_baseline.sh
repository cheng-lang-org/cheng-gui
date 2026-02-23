#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
fixture_root="$ROOT/tests/claude_fixture"
golden_dir="$fixture_root/golden/fullroute"
manifest_path="$golden_dir/chromium_truth_manifest.json"

if [ ! -d "$golden_dir" ]; then
  echo "[freeze-claude-chromium-truth] missing golden dir: $golden_dir" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[freeze-claude-chromium-truth] missing dependency: python3" >&2
  exit 2
fi
if ! command -v shasum >/dev/null 2>&1; then
  echo "[freeze-claude-chromium-truth] missing dependency: shasum" >&2
  exit 2
fi

chromium_bin="${CHROMIUM_TRUTH_BIN:-}"
if [ -z "$chromium_bin" ]; then
  if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    chromium_bin="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  elif command -v google-chrome >/dev/null 2>&1; then
    chromium_bin="$(command -v google-chrome)"
  elif command -v chromium >/dev/null 2>&1; then
    chromium_bin="$(command -v chromium)"
  fi
fi
if [ -z "$chromium_bin" ] || [ ! -x "$chromium_bin" ]; then
  echo "[freeze-claude-chromium-truth] missing Chromium binary; set CHROMIUM_TRUTH_BIN" >&2
  exit 2
fi

chromium_version="$("$chromium_bin" --version 2>/dev/null || true)"
if [ -z "$chromium_version" ]; then
  echo "[freeze-claude-chromium-truth] failed to query Chromium version: $chromium_bin" >&2
  exit 1
fi

python3 - "$golden_dir" "$manifest_path" "$chromium_bin" "$chromium_version" <<'PY'
import datetime as dt
import hashlib
import json
import os
import sys

golden_dir, manifest_path, chromium_bin, chromium_version = sys.argv[1:5]

states = []
for name in sorted(os.listdir(golden_dir)):
    if not name.endswith(".rgba"):
        continue
    state = name[:-5]
    rgba_path = os.path.join(golden_dir, f"{state}.rgba")
    framehash_path = os.path.join(golden_dir, f"{state}.framehash")
    if not os.path.isfile(rgba_path) or not os.path.isfile(framehash_path):
        raise SystemExit(f"missing pair for state={state}")
    rgba = open(rgba_path, "rb").read()
    framehash = open(framehash_path, "r", encoding="utf-8").read().strip()
    states.append(
        {
            "name": state,
            "rgba_file": f"{state}.rgba",
            "framehash_file": f"{state}.framehash",
            "rgba_bytes": len(rgba),
            "rgba_sha256": hashlib.sha256(rgba).hexdigest(),
            "framehash": framehash,
        }
    )

if len(states) != 30:
    raise SystemExit(f"expected 30 states, got {len(states)}")

rollup = hashlib.sha256(
    "\n".join(
        f"{s['name']}:{s['rgba_sha256']}:{s['framehash']}" for s in states
    ).encode("utf-8")
).hexdigest()

manifest = {
    "format": "claude-fullroute-chromium-truth-v1",
    "source": "external-chromium",
    "chromium_bin": chromium_bin,
    "chromium_version": chromium_version,
    "generated_at_utc": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "routes": 30,
    "pixel_tolerance": 0,
    "states": states,
    "rollup_sha256": rollup,
}
with open(manifest_path, "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY

echo "[freeze-claude-chromium-truth] ok: $manifest_path"
