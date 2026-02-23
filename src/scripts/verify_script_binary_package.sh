#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
OUT_DIR="${CHENG_GUI_SCRIPT_PACKAGE_VERIFY_OUT:-$ROOT/build/script_bin_package_verify}"
MANIFEST="$OUT_DIR/manifest.json"

usage() {
  cat <<'EOF'
Usage:
  verify_script_binary_package.sh [--out-dir <abs_path>]

Builds and validates standalone binary-command package.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --out-dir)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[verify-script-binary-package] unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

"$ROOT/scripts/package_script_binaries.sh" --out-dir "$OUT_DIR"

if [ ! -f "$MANIFEST" ]; then
  echo "[verify-script-binary-package] missing manifest: $MANIFEST" >&2
  exit 1
fi

python3 - "$MANIFEST" <<'PY'
import json
import os
import sys
from pathlib import Path

manifest = Path(sys.argv[1])
doc = json.loads(manifest.read_text(encoding="utf-8"))
if doc.get("format") != "cheng-gui-script-binary-package-v1":
    raise SystemExit("[verify-script-binary-package] invalid format")
dispatcher = Path(str(doc.get("dispatcher", "")))
if not dispatcher.exists() or not os.access(str(dispatcher), os.X_OK):
    raise SystemExit("[verify-script-binary-package] dispatcher missing or not executable")
dispatcher_size = int(doc.get("dispatcher_size", 0) or 0)
dispatcher_sha = str(doc.get("dispatcher_sha256", "") or "")
if dispatcher_size <= 0:
    raise SystemExit("[verify-script-binary-package] dispatcher_size invalid")
if dispatcher.stat().st_size != dispatcher_size:
    raise SystemExit("[verify-script-binary-package] dispatcher_size mismatch")
if doc.get("all_commands_same_bytes_as_dispatcher") is not True:
    raise SystemExit("[verify-script-binary-package] command bytes mismatch flag is false")
rows = doc.get("commands", [])
if not isinstance(rows, list) or len(rows) <= 0:
    raise SystemExit("[verify-script-binary-package] commands empty")
if int(doc.get("command_count", -1)) != len(rows):
    raise SystemExit("[verify-script-binary-package] command_count mismatch")
for row in rows:
    name = str(row.get("name", "") or "")
    path = Path(str(row.get("path", "") or ""))
    if not name or not path.exists():
        raise SystemExit(f"[verify-script-binary-package] invalid row: {row}")
    if path.is_symlink():
        raise SystemExit(f"[verify-script-binary-package] symlink command found: {path}")
    if not os.access(str(path), os.X_OK):
        raise SystemExit(f"[verify-script-binary-package] non-executable command: {path}")
    if int(row.get("size", 0) or 0) != dispatcher_size:
        raise SystemExit(f"[verify-script-binary-package] size mismatch: {path}")
    if dispatcher_sha and str(row.get("sha256", "") or "").lower() != dispatcher_sha:
        raise SystemExit(f"[verify-script-binary-package] sha mismatch: {path}")
PY

bin_dir="$OUT_DIR/bin"
"$bin_dir/cheng_gui_scripts" verify_android_fullroute_visual_pixel --help >/dev/null
"$bin_dir/verify_android_fullroute_visual_pixel" --help >/dev/null
"$bin_dir/verify_android_claude_1to1_gate" --help >/dev/null

echo "[verify-script-binary-package] ok out=$OUT_DIR"
