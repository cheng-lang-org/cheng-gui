#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SRC_ROOT="$(CDPATH= cd -- "$SCRIPT_ROOT/.." && pwd)"
PKG_ROOT="$(CDPATH= cd -- "$SRC_ROOT/.." && pwd)"

GEN="$SRC_ROOT/ime/tools/gen_ime_assets.py"
LEGACY_GEN="$SRC_ROOT/ime/tools/gen_legacy_codec_assets.py"
OUT_DIR="$SRC_ROOT/ime/data"

if [ ! -x "$GEN" ]; then
  echo "[build-cangwu-assets] missing generator: $GEN" >&2
  exit 1
fi
if [ ! -x "$LEGACY_GEN" ]; then
  echo "[build-cangwu-assets] missing generator: $LEGACY_GEN" >&2
  exit 1
fi

if ! python3 - <<'PY' >/dev/null 2>&1
import rdata
import pandas
PY
then
  echo "[build-cangwu-assets] installing python deps: rdata pandas"
  python3 -m pip install --user rdata pandas >/dev/null
fi

python3 "$GEN" --out-dir "$OUT_DIR"
python3 "$LEGACY_GEN" --out-dir "$OUT_DIR"

dict_file="$OUT_DIR/utfzh_dict_v1.tsv"
legacy_gbk_file="$OUT_DIR/legacy_gbk_to_u_v1.tsv"
legacy_gb2312_file="$OUT_DIR/legacy_gb2312_to_u_v1.tsv"
if [ ! -f "$dict_file" ]; then
  echo "[build-cangwu-assets] missing dict output: $dict_file" >&2
  exit 1
fi

dict_lines="$(wc -l < "$dict_file" | tr -d ' ')"
if [ "$dict_lines" != "9698" ]; then
  echo "[build-cangwu-assets] dict line count mismatch: $dict_lines (want 9698)" >&2
  exit 1
fi
if [ ! -f "$legacy_gbk_file" ] || [ ! -f "$legacy_gb2312_file" ]; then
  echo "[build-cangwu-assets] missing legacy map outputs" >&2
  exit 1
fi
gbk_lines="$(wc -l < "$legacy_gbk_file" | tr -d ' ')"
gb2312_lines="$(wc -l < "$legacy_gb2312_file" | tr -d ' ')"
if [ "$gbk_lines" -le 0 ] || [ "$gb2312_lines" -le 0 ]; then
  echo "[build-cangwu-assets] legacy map is empty" >&2
  exit 1
fi

echo "[build-cangwu-assets] ok"
echo "  out=$OUT_DIR"
echo "  dict_lines=$dict_lines"
echo "  gbk_lines=$gbk_lines"
echo "  gb2312_lines=$gb2312_lines"
