#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
OUT_DIR="${CHENG_GUI_SCRIPT_PACKAGE_OUT:-$ROOT/build/script_bin_package}"
BIN_NAME="${CHENG_GUI_SCRIPT_PACKAGE_BIN_NAME:-cheng_gui_scripts}"
BIN_DIR=""
MANIFEST=""

usage() {
  cat <<'EOF'
Usage:
  package_script_binaries.sh [--out-dir <abs_path>] [--bin-name <name>]

Builds a standalone binary-command package from src/scripts.
All command entries are emitted as regular executable files (copy mode, non-symlink).
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --out-dir)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    --bin-name)
      BIN_NAME="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[package-script-binaries] unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

BIN_DIR="$OUT_DIR/bin"
MANIFEST="$OUT_DIR/manifest.json"

mkdir -p "$OUT_DIR"

"$ROOT/scripts/build_script_dispatcher.sh" \
  --out-dir "$BIN_DIR" \
  --bin-name "$BIN_NAME" \
  --link-mode copy

if find "$BIN_DIR" -maxdepth 1 -type l | grep -q .; then
  echo "[package-script-binaries] package contains symlink entries (expected copy mode)" >&2
  exit 1
fi

if [ ! -x "$BIN_DIR/$BIN_NAME" ]; then
  echo "[package-script-binaries] missing dispatcher binary: $BIN_DIR/$BIN_NAME" >&2
  exit 1
fi

list_file="$OUT_DIR/commands.list"
"$BIN_DIR/$BIN_NAME" --list > "$list_file"
count="$(wc -l < "$list_file" | tr -d ' ')"
if [ "$count" -lt 1 ]; then
  echo "[package-script-binaries] empty command list" >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  sha_cmd="shasum -a 256"
elif command -v sha256sum >/dev/null 2>&1; then
  sha_cmd="sha256sum"
else
  sha_cmd=""
fi

python3 - "$BIN_DIR" "$BIN_NAME" "$list_file" "$MANIFEST" "$sha_cmd" <<'PY'
import json
import os
import subprocess
import sys
from pathlib import Path

bin_dir = Path(sys.argv[1])
bin_name = sys.argv[2]
list_file = Path(sys.argv[3])
manifest = Path(sys.argv[4])
sha_cmd = sys.argv[5]

commands = [line.strip() for line in list_file.read_text(encoding="utf-8").splitlines() if line.strip()]
rows = []
dispatcher_sha = ""
dispatcher_size = 0
dispatcher = bin_dir / bin_name
if not dispatcher.exists():
    raise SystemExit(f"[package-script-binaries] dispatcher missing: {dispatcher}")
dispatcher_size = dispatcher.stat().st_size
if sha_cmd:
    out = subprocess.check_output(f"{sha_cmd} {str(dispatcher)}", shell=True, text=True).strip()
    if out:
        dispatcher_sha = out.split()[0].strip().lower()
all_same_bytes = True
for cmd in commands:
    p = bin_dir / cmd
    if not p.exists():
        raise SystemExit(f"[package-script-binaries] missing command binary: {p}")
    if p.is_symlink():
        raise SystemExit(f"[package-script-binaries] command is symlink: {p}")
    if not os.access(str(p), os.X_OK):
        raise SystemExit(f"[package-script-binaries] command not executable: {p}")
    sha = ""
    if sha_cmd:
        out = subprocess.check_output(f"{sha_cmd} {str(p)}", shell=True, text=True).strip()
        if out:
            sha = out.split()[0].strip().lower()
    if dispatcher_sha and sha and sha != dispatcher_sha:
        all_same_bytes = False
    if p.stat().st_size != dispatcher_size:
        all_same_bytes = False
    rows.append({
        "name": cmd,
        "path": str(p),
        "size": p.stat().st_size,
        "sha256": sha,
    })

doc = {
    "format": "cheng-gui-script-binary-package-v1",
    "dispatcher": str(dispatcher),
    "dispatcher_size": dispatcher_size,
    "dispatcher_sha256": dispatcher_sha,
    "all_commands_same_bytes_as_dispatcher": all_same_bytes,
    "command_count": len(rows),
    "commands": rows,
}
manifest.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

echo "[package-script-binaries] ok out=$OUT_DIR commands=$count manifest=$MANIFEST"
