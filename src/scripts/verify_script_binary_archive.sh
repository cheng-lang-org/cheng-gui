#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PACKAGE_OUT="${CHENG_GUI_SCRIPT_ARCHIVE_VERIFY_PACKAGE_OUT:-$ROOT/build/script_bin_package_production}"
ARCHIVE_OUT="${CHENG_GUI_SCRIPT_ARCHIVE_VERIFY_OUT:-$ROOT/build/script_bin_package_production.tar.gz}"
SHA_OUT="${CHENG_GUI_SCRIPT_ARCHIVE_VERIFY_SHA_OUT:-$ARCHIVE_OUT.sha256}"

usage() {
  cat <<'EOF'
Usage:
  verify_script_binary_archive.sh [--package-out <abs_path>] [--out <abs_path>] [--sha-out <abs_path>]

Verifies packaged binary archive creation and minimal extract integrity.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --package-out)
      PACKAGE_OUT="${2:-}"
      shift 2
      ;;
    --out)
      ARCHIVE_OUT="${2:-}"
      shift 2
      ;;
    --sha-out)
      SHA_OUT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[verify-script-binary-archive] unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

"$ROOT/scripts/verify_script_binary_package.sh" --out-dir "$PACKAGE_OUT"
"$ROOT/scripts/archive_script_binaries.sh" --package-out "$PACKAGE_OUT" --out "$ARCHIVE_OUT" --sha-out "$SHA_OUT"

if [ ! -s "$ARCHIVE_OUT" ]; then
  echo "[verify-script-binary-archive] archive missing or empty: $ARCHIVE_OUT" >&2
  exit 1
fi
if [ ! -s "$SHA_OUT" ]; then
  echo "[verify-script-binary-archive] checksum missing or empty: $SHA_OUT" >&2
  exit 1
fi

extract_dir="$(mktemp -d)"
trap 'rm -rf "$extract_dir"' EXIT
tar -C "$extract_dir" -xzf "$ARCHIVE_OUT"

if [ ! -f "$extract_dir/manifest.json" ]; then
  echo "[verify-script-binary-archive] extracted manifest missing" >&2
  exit 1
fi
if [ ! -x "$extract_dir/bin/cheng_gui_scripts" ]; then
  echo "[verify-script-binary-archive] extracted dispatcher missing or not executable" >&2
  exit 1
fi

python3 - "$extract_dir/manifest.json" "$extract_dir/bin/cheng_gui_scripts" <<'PY'
import json
import os
import subprocess
import sys
from pathlib import Path

manifest = Path(sys.argv[1])
dispatcher = Path(sys.argv[2])
doc = json.loads(manifest.read_text(encoding="utf-8"))
if doc.get("format") != "cheng-gui-script-binary-package-v1":
    raise SystemExit("[verify-script-binary-archive] invalid manifest format")
rows = doc.get("commands", [])
if not isinstance(rows, list) or len(rows) <= 0:
    raise SystemExit("[verify-script-binary-archive] empty command list")
if int(doc.get("command_count", -1)) != len(rows):
    raise SystemExit("[verify-script-binary-archive] command_count mismatch")
for row in rows:
    name = str(row.get("name", "") or "")
    if not name:
        raise SystemExit("[verify-script-binary-archive] empty command name")
    p = dispatcher.parent / name
    if not p.exists() or not os.access(str(p), os.X_OK):
        raise SystemExit(f"[verify-script-binary-archive] missing extracted command: {p}")
subprocess.check_call([str(dispatcher), "verify_android_claude_1to1_gate", "--help"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
PY

echo "[verify-script-binary-archive] ok archive=$ARCHIVE_OUT"
