#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SRC_ROOT="$(CDPATH= cd -- "$SCRIPT_ROOT/.." && pwd)"
PKG_ROOT="$(CDPATH= cd -- "$SRC_ROOT/.." && pwd)"

in_path=""
out_path=""
from_enc="auto"
report_path=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --in)
      in_path="${2:-}"
      shift 2
      ;;
    --out)
      out_path="${2:-}"
      shift 2
      ;;
    --from)
      from_enc="${2:-auto}"
      shift 2
      ;;
    --report)
      report_path="${2:-}"
      shift 2
      ;;
    *)
      echo "[convert-to-utfzh] unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$in_path" ] || [ -z "$out_path" ]; then
  echo "usage: bash src/scripts/convert_to_utfzh.sh --in <input> --out <output> [--from auto|utf8|utf16le|utf16be|gbk|gb2312] [--report <path>]" >&2
  exit 2
fi
if [ ! -f "$in_path" ]; then
  echo "[convert-to-utfzh] missing input: $in_path" >&2
  exit 2
fi

CHENG_ROOT="${CHENG_ROOT:-}"
if [ -z "$CHENG_ROOT" ]; then
  if [ -d "$HOME/.cheng/toolchain/cheng-lang" ]; then
    CHENG_ROOT="$HOME/.cheng/toolchain/cheng-lang"
  elif [ -d "$HOME/cheng-lang" ]; then
    CHENG_ROOT="$HOME/cheng-lang"
  elif [ -d "/Users/lbcheng/cheng-lang" ]; then
    CHENG_ROOT="/Users/lbcheng/cheng-lang"
  fi
fi
if [ -z "$CHENG_ROOT" ]; then
  echo "[convert-to-utfzh] missing CHENG_ROOT" >&2
  exit 2
fi

target="${CHENG_EXAMPLES_TARGET:-}"
if [ -z "$target" ]; then
  target="$(sh "$CHENG_ROOT/src/tooling/detect_host_target.sh")"
fi
selected_driver="${CHENG_CW_IME_DRIVER:-${CHENG_BACKEND_DRIVER:-}}"
if [ -n "$selected_driver" ] && [ ! -x "$selected_driver" ]; then
  echo "[convert-to-utfzh] selected driver is not executable: $selected_driver" >&2
  exit 2
fi
if [ -z "$selected_driver" ] && [ -x "$CHENG_ROOT/dist/releases/current/cheng" ]; then
  selected_driver="$CHENG_ROOT/dist/releases/current/cheng"
fi
if [ -z "$selected_driver" ] && [ -x "$CHENG_ROOT/cheng_libp2p_tests" ]; then
  selected_driver="$CHENG_ROOT/cheng_libp2p_tests"
fi
if [ -z "$selected_driver" ] && [ -d "$CHENG_ROOT/dist/releases" ]; then
  while IFS= read -r candidate; do
    if [ -x "$candidate/cheng" ]; then
      selected_driver="$candidate/cheng"
      break
    fi
  done < <(ls -1dt "$CHENG_ROOT"/dist/releases/* 2>/dev/null || true)
fi
if [ -z "$selected_driver" ] && [ -x "$CHENG_ROOT/cheng_stable" ]; then
  selected_driver="$CHENG_ROOT/cheng_stable"
fi
if [ -z "$selected_driver" ] && [ -x "$CHENG_ROOT/cheng" ]; then
  selected_driver="$CHENG_ROOT/cheng"
fi
if [ -z "$selected_driver" ]; then
  echo "[convert-to-utfzh] no runnable backend driver found under CHENG_ROOT=$CHENG_ROOT" >&2
  exit 2
fi

OBJ_ROOT="$PKG_ROOT/build/cangwu_ime/obj"
BIN_ROOT="$PKG_ROOT/build/cangwu_ime/bin"
mkdir -p "$OBJ_ROOT" "$BIN_ROOT"

obj="$OBJ_ROOT/utfzh_transcode_main.o"
bin="$BIN_ROOT/utfzh_transcode_main"

(
  cd "$CHENG_ROOT"
  CHENG_PKG_ROOTS="${CHENG_PKG_ROOTS:-$HOME/.cheng-packages,$PKG_ROOT}" \
  CHENG_ABI=v2_noptr \
  CHENG_STAGE1_STD_NO_POINTERS=0 \
  CHENG_STAGE1_STD_NO_POINTERS_STRICT=0 \
  CHENG_STAGE1_NO_POINTERS_NON_C_ABI=0 \
  CHENG_STAGE1_NO_POINTERS_NON_C_ABI_INTERNAL=0 \
  CHENG_BACKEND_TARGET="$target" \
  CHENG_BACKEND_JOBS="${CHENG_CW_IME_JOBS:-8}" \
  CHENG_BACKEND_MULTI="${CHENG_BACKEND_MULTI:-0}" \
  CHENG_BACKEND_INCREMENTAL="${CHENG_BACKEND_INCREMENTAL:-1}" \
  CHENG_BACKEND_WHOLE_PROGRAM=1 \
  CHENG_BACKEND_EMIT=obj \
  CHENG_BACKEND_FRONTEND="${CHENG_CW_IME_FRONTEND:-stage1}" \
  CHENG_BACKEND_INPUT="$SRC_ROOT/utfzh_transcode_main.cheng" \
  CHENG_BACKEND_OUTPUT="$obj" \
  CHENG_BACKEND_VALIDATE="${CHENG_BACKEND_VALIDATE:-0}" \
  CHENG_STAGE1_SKIP_SEM="${CHENG_STAGE1_SKIP_SEM:-1}" \
  CHENG_STAGE1_SKIP_OWNERSHIP="${CHENG_STAGE1_SKIP_OWNERSHIP:-1}" \
  CHENG_GENERIC_MODE="${CHENG_GENERIC_MODE:-dict}" \
  CHENG_GENERIC_SPEC_BUDGET="${CHENG_GENERIC_SPEC_BUDGET:-0}" \
  "$selected_driver"
)

obj_sys="$OBJ_ROOT/utfzh_transcode.system_helpers.runtime.o"
obj_compat="$OBJ_ROOT/utfzh_transcode.compat_shim.runtime.o"
clang -I"$CHENG_ROOT/runtime/include" -I"$CHENG_ROOT/src/runtime/native" \
  -Dalloc=cheng_runtime_alloc -DcopyMem=cheng_runtime_copyMem -DsetMem=cheng_runtime_setMem \
  -c "$CHENG_ROOT/src/runtime/native/system_helpers.c" -o "$obj_sys"
if [ -f "$SRC_ROOT/runtime/cheng_compat_shim.c" ]; then
  clang -c "$SRC_ROOT/runtime/cheng_compat_shim.c" -o "$obj_compat"
  clang "$obj" "$obj_sys" "$obj_compat" -o "$bin"
else
  clang "$obj" "$obj_sys" -o "$bin"
fi

CHENG_UTFZH_IN="$in_path" \
CHENG_UTFZH_OUT="$out_path" \
CHENG_UTFZH_FROM="$from_enc" \
CHENG_UTFZH_REPORT="$report_path" \
"$bin"

if [ ! -f "$out_path" ]; then
  echo "[convert-to-utfzh] conversion failed: output missing" >&2
  exit 1
fi

echo "[convert-to-utfzh] ok"
echo "  in=$in_path"
echo "  out=$out_path"
echo "  from=$from_enc"
if [ -n "$report_path" ]; then
  echo "  report=$report_path"
fi
