#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PACKAGE_OUT="${CHENG_GUI_SCRIPT_PACKAGE_ARCHIVE_SOURCE:-$ROOT/build/script_bin_package_production}"
ARCHIVE_OUT="${CHENG_GUI_SCRIPT_PACKAGE_ARCHIVE_OUT:-$ROOT/build/script_bin_package_production.tar.gz}"
SHA_OUT="${CHENG_GUI_SCRIPT_PACKAGE_ARCHIVE_SHA_OUT:-$ARCHIVE_OUT.sha256}"

usage() {
  cat <<'EOF'
Usage:
  archive_script_binaries.sh [--package-out <abs_path>] [--out <abs_path>] [--sha-out <abs_path>]

Creates tar.gz archive for packaged script binaries and writes sha256 file.
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
      echo "[archive-script-binaries] unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [ ! -d "$PACKAGE_OUT" ]; then
  echo "[archive-script-binaries] missing package dir: $PACKAGE_OUT" >&2
  exit 1
fi
if [ ! -f "$PACKAGE_OUT/manifest.json" ]; then
  echo "[archive-script-binaries] missing manifest: $PACKAGE_OUT/manifest.json" >&2
  exit 1
fi
if [ ! -x "$PACKAGE_OUT/bin/cheng_gui_scripts" ]; then
  echo "[archive-script-binaries] missing dispatcher binary: $PACKAGE_OUT/bin/cheng_gui_scripts" >&2
  exit 1
fi

mkdir -p "$(dirname "$ARCHIVE_OUT")" "$(dirname "$SHA_OUT")"
rm -f "$ARCHIVE_OUT" "$SHA_OUT"

tar -C "$PACKAGE_OUT" -czf "$ARCHIVE_OUT" .

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$ARCHIVE_OUT" > "$SHA_OUT"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$ARCHIVE_OUT" > "$SHA_OUT"
else
  echo "[archive-script-binaries] missing checksum tool: shasum/sha256sum" >&2
  exit 2
fi

echo "[archive-script-binaries] ok archive=$ARCHIVE_OUT sha=$SHA_OUT"
