#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SRC_ROOT="$(CDPATH= cd -- "$SCRIPT_ROOT/.." && pwd)"
PKG_ROOT="$(CDPATH= cd -- "$SRC_ROOT/.." && pwd)"
BIN_ROOT="$PKG_ROOT/build/cangwu_ime/bin"
OBJ_ROOT="$PKG_ROOT/build/cangwu_ime/obj"
mkdir -p "$BIN_ROOT" "$OBJ_ROOT"

OBJ_COMPAT="$SCRIPT_ROOT/chengc_obj_compat.sh"
TRANSCODE_MAIN_CHENG="$SRC_ROOT/utfzh_transcode_main.cheng"
TRANSCODE_ENTRY_CHENG="$SRC_ROOT/ime/utfzh_transcode_entry.cheng"
RUNTIME_SYS_C="/Users/lbcheng/cheng-lang/src/runtime/native/system_helpers.c"
RUNTIME_COMPAT_C="$SRC_ROOT/runtime/cheng_compat_shim.c"
RUNTIME_PTR_SHIM_C="$SRC_ROOT/runtime/cheng_selflink_ptr_shim.c"
TRANSCODE_DEPS=(
  "$TRANSCODE_ENTRY_CHENG"
  "$SRC_ROOT/ime/utfzh_codec.cheng"
  "$SRC_ROOT/ime/cangwu_assets_loader.cheng"
  "$SRC_ROOT/ime/cangwu_types.cheng"
  "$SRC_ROOT/ime/legacy_assets_loader.cheng"
  "$SRC_ROOT/ime/legacy_codec.cheng"
  "$SRC_ROOT/ime/legacy_types.cheng"
)

for f in "$OBJ_COMPAT" "$TRANSCODE_MAIN_CHENG" "$RUNTIME_SYS_C" "$RUNTIME_COMPAT_C" "$RUNTIME_PTR_SHIM_C" "${TRANSCODE_DEPS[@]}"; do
  if [ ! -f "$f" ]; then
    echo "[cangwu-ime-cli] missing source: $f" >&2
    exit 2
  fi
done
if [ ! -x "$OBJ_COMPAT" ]; then
  echo "[cangwu-ime-cli] missing executable compiler: $OBJ_COMPAT" >&2
  exit 2
fi

pure_bin="$BIN_ROOT/utfzh_transcode_pure"
pure_main_obj="$OBJ_ROOT/utfzh_transcode_pure.main.o"
pure_sys_obj="$OBJ_ROOT/utfzh_transcode_pure.system_helpers.runtime.o"
pure_compat_obj="$OBJ_ROOT/utfzh_transcode_pure.compat_shim.runtime.o"
pure_ptr_obj="$OBJ_ROOT/utfzh_transcode_pure.ptr_shim.runtime.o"

convert_usage() {
  echo "用法: cangwu_ime_cli convert --in <input> --out <output> [--from auto|utf8|utf16le|utf16be|gbk|gb2312] [--report <path>] [--data-root <path>] [--optimize-dict] [--dict-out <path>]"
}

build_convert_pure() {
  local needs_rebuild="${CW_IME_CLI_REBUILD:-0}"
  if [ "$needs_rebuild" != "1" ] && [ ! -x "$pure_bin" ]; then
    needs_rebuild="1"
  fi
  for f in "$OBJ_COMPAT" "$TRANSCODE_MAIN_CHENG" "$RUNTIME_SYS_C" "$RUNTIME_COMPAT_C" "$RUNTIME_PTR_SHIM_C" "${TRANSCODE_DEPS[@]}"; do
    if [ "$needs_rebuild" != "1" ] && [ "$f" -nt "$pure_bin" ]; then
      needs_rebuild="1"
    fi
  done

  if [ "$needs_rebuild" = "1" ]; then
    echo "[cangwu-ime-cli] building pure transcode binary..."
    BACKEND_ENABLE_CSTRING_LOWERING=1 "$OBJ_COMPAT" "$TRANSCODE_MAIN_CHENG" --emit-obj --obj-out:"$pure_main_obj"
    clang -I"/Users/lbcheng/cheng-lang/runtime/include" -I"/Users/lbcheng/cheng-lang/src/runtime/native" \
      -Dalloc=cheng_runtime_alloc -DcopyMem=cheng_runtime_copyMem -DsetMem=cheng_runtime_setMem \
      -Dcheng_ptr_to_u64=cheng_sys_ptr_to_u64 -Dcheng_ptr_size=cheng_sys_ptr_size -Dcheng_strlen=cheng_sys_strlen \
      -Dload_ptr=cheng_sys_load_ptr_1arg -Dstore_ptr=cheng_sys_store_ptr_1arg \
      -c "$RUNTIME_SYS_C" -o "$pure_sys_obj"
    clang -std=c11 -O2 -c "$RUNTIME_COMPAT_C" -o "$pure_compat_obj"
    clang -std=c11 -O2 -c "$RUNTIME_PTR_SHIM_C" -o "$pure_ptr_obj"
    clang "$pure_main_obj" "$pure_sys_obj" "$pure_compat_obj" "$pure_ptr_obj" -o "$pure_bin"
    echo "[cangwu-ime-cli] build done: $pure_bin"
  fi

  rm -f "$BIN_ROOT/convert_to_utfzh" "$BIN_ROOT/cangwu_ime_cli"
  cat >"$BIN_ROOT/convert_to_utfzh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec "$SCRIPT_ROOT/convert_to_utfzh.sh" "\$@"
EOF
  chmod +x "$BIN_ROOT/convert_to_utfzh"
  cat >"$BIN_ROOT/cangwu_ime_cli" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec "$SCRIPT_ROOT/cangwu_ime_cli.sh" "\$@"
EOF
  chmod +x "$BIN_ROOT/cangwu_ime_cli"
}

run_convert() {
  local in_path=""
  local out_path=""
  local from_text="auto"
  local report_path=""
  local data_root="$PKG_ROOT/src/ime/data"
  local optimize_dict=0
  local dict_out=""

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --help|-h)
        convert_usage
        return 0
        ;;
      --in)
        if [ "$#" -lt 2 ]; then
          echo "[cangwu-ime-cli] missing value for --in" >&2
          return 2
        fi
        in_path="$2"
        shift 2
        ;;
      --out)
        if [ "$#" -lt 2 ]; then
          echo "[cangwu-ime-cli] missing value for --out" >&2
          return 2
        fi
        out_path="$2"
        shift 2
        ;;
      --from)
        if [ "$#" -lt 2 ]; then
          echo "[cangwu-ime-cli] missing value for --from" >&2
          return 2
        fi
        from_text="$2"
        shift 2
        ;;
      --report)
        if [ "$#" -lt 2 ]; then
          echo "[cangwu-ime-cli] missing value for --report" >&2
          return 2
        fi
        report_path="$2"
        shift 2
        ;;
      --data-root)
        if [ "$#" -lt 2 ]; then
          echo "[cangwu-ime-cli] missing value for --data-root" >&2
          return 2
        fi
        data_root="$2"
        shift 2
        ;;
      --dict-out)
        if [ "$#" -lt 2 ]; then
          echo "[cangwu-ime-cli] missing value for --dict-out" >&2
          return 2
        fi
        dict_out="$2"
        shift 2
        ;;
      --in:*|--in=*|--out:*|--out=*|--from:*|--from=*|--report:*|--report=*|--data-root:*|--data-root=*|--dict-out:*|--dict-out=*)
        local key="${1%%[:=]*}"
        local val="${1#"$key"}"
        val="${val#:}"
        val="${val#=}"
        case "$key" in
          --in) in_path="$val" ;;
          --out) out_path="$val" ;;
          --from) from_text="$val" ;;
          --report) report_path="$val" ;;
          --data-root) data_root="$val" ;;
          --dict-out) dict_out="$val" ;;
        esac
        shift
        ;;
      --optimize-dict)
        optimize_dict=1
        shift
        ;;
      *)
        echo "[cangwu-ime-cli] unknown convert arg: $1" >&2
        return 2
        ;;
    esac
  done

  if [ -z "$in_path" ] || [ -z "$out_path" ]; then
    convert_usage >&2
    return 2
  fi
  if [ ! -f "$in_path" ]; then
    echo "[cangwu-ime-cli] missing input: $in_path" >&2
    return 2
  fi

  build_convert_pure
  local input_bytes
  input_bytes="$(wc -c < "$in_path" | tr -d '[:space:]')"
  if [ -z "${UTFZH_ENCODE_CHUNK_SCALARS:-}" ]; then
    export UTFZH_ENCODE_CHUNK_SCALARS=256
  fi
  export UTFZH_IN="$in_path"
  export UTFZH_OUT="$out_path"
  export UTFZH_FROM="$from_text"
  export UTFZH_REPORT="$report_path"
  export UTFZH_DATA_ROOT="$data_root"
  if [ "$optimize_dict" = "1" ]; then
    export UTFZH_OPTIMIZE_DICT=1
  else
    unset UTFZH_OPTIMIZE_DICT || true
  fi
  if [ -n "$dict_out" ]; then
    export UTFZH_DICT_OUT="$dict_out"
  else
    unset UTFZH_DICT_OUT || true
  fi

  echo "[convert_to_utfzh] start input_bytes=$input_bytes chunk_scalars=${UTFZH_ENCODE_CHUNK_SCALARS}"
  "$pure_bin"
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "[convert_to_utfzh] failed rc=$rc" >&2
    return "$rc"
  fi
  echo "[convert_to_utfzh] ok"
  echo "  in=$in_path"
  echo "  out=$out_path"
  echo "  from=$from_text"
  if [ -n "$report_path" ]; then
    echo "  report=$report_path"
  fi
  if [ "$optimize_dict" = "1" ]; then
    echo "  optimize_dict=true"
    if [ -n "$dict_out" ]; then
      echo "  dict_out=$dict_out"
    fi
  fi
  return 0
}

count_lines() {
  local path="$1"
  if [ ! -f "$path" ]; then
    echo -1
    return
  fi
  wc -l < "$path" | tr -d '[:space:]'
}

run_build_assets() {
  local out_dir="$PKG_ROOT/src/ime/data"
  local python_bin="python3"
  local skip_install=0

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --help|-h)
        echo "用法: cangwu_ime_cli build-assets [--out-dir <path>] [--python <python3>] [--skip-install]"
        return 0
        ;;
      --skip-install)
        skip_install=1
        shift
        ;;
      --out-dir|--python)
        if [ "$#" -lt 2 ]; then
          echo "[cangwu-ime-cli] missing value for $1" >&2
          return 2
        fi
        if [ "$1" = "--out-dir" ]; then
          out_dir="$2"
        else
          python_bin="$2"
        fi
        shift 2
        ;;
      --out-dir:*|--out-dir=*|--python:*|--python=*)
        local key="${1%%[:=]*}"
        local val="${1#"$key"}"
        val="${val#:}"
        val="${val#=}"
        if [ "$key" = "--out-dir" ]; then
          out_dir="$val"
        else
          python_bin="$val"
        fi
        shift
        ;;
      *)
        echo "[cangwu-ime-cli] unknown build-assets arg: $1" >&2
        return 2
        ;;
    esac
  done

  local gen="$PKG_ROOT/src/ime/tools/gen_ime_assets.py"
  local legacy_gen="$PKG_ROOT/src/ime/tools/gen_legacy_codec_assets.py"
  if [ ! -f "$gen" ] || [ ! -f "$legacy_gen" ]; then
    echo "[cangwu-ime-cli] missing generator script" >&2
    return 1
  fi

  if ! "$python_bin" -c 'import rdata,pandas' >/dev/null 2>&1; then
    if [ "$skip_install" = "1" ]; then
      echo "[cangwu-ime-cli] python deps missing and --skip-install is set" >&2
      return 1
    fi
    "$python_bin" -m pip install --user rdata pandas
  fi

  "$python_bin" "$gen" --out-dir "$out_dir"
  "$python_bin" "$legacy_gen" --out-dir "$out_dir"

  local dict_file="$out_dir/utfzh_dict_v1.tsv"
  local gbk_file="$out_dir/legacy_gbk_to_u_v1.tsv"
  local gb2312_file="$out_dir/legacy_gb2312_to_u_v1.tsv"
  local dict_lines
  local gbk_lines
  local gb2312_lines
  dict_lines="$(count_lines "$dict_file")"
  gbk_lines="$(count_lines "$gbk_file")"
  gb2312_lines="$(count_lines "$gb2312_file")"
  if [ "$dict_lines" != "9698" ]; then
    echo "[cangwu-ime-cli] dict line count mismatch: $dict_lines (want 9698)" >&2
    return 1
  fi
  if [ "$gbk_lines" -le 0 ] || [ "$gb2312_lines" -le 0 ]; then
    echo "[cangwu-ime-cli] legacy map is empty" >&2
    return 1
  fi

  echo "[cangwu-ime-cli] build-assets ok"
  echo "  out=$out_dir"
  echo "  dict_lines=$dict_lines"
  echo "  gbk_lines=$gbk_lines"
  echo "  gb2312_lines=$gb2312_lines"
  return 0
}

run_verify() {
  local impl_path="$SCRIPT_ROOT/verify_cangwu_ime_impl.sh"
  if [ "$#" -gt 0 ] && [ "$1" = "--impl" ]; then
    if [ "$#" -lt 2 ]; then
      echo "[cangwu-ime-cli] missing value for --impl" >&2
      return 2
    fi
    impl_path="$2"
    shift 2
  fi
  if [ "$#" -gt 0 ] && [[ "$1" == --impl:* || "$1" == --impl=* ]]; then
    impl_path="${1#--impl}"
    impl_path="${impl_path#:}"
    impl_path="${impl_path#=}"
    shift
  fi
  if [ "$#" -gt 0 ] && [ "$1" = "--help" ]; then
    echo "用法: cangwu_ime_cli verify [--impl <path>] [-- <extra args>]"
    return 0
  fi
  if [ ! -f "$impl_path" ]; then
    echo "[cangwu-ime-cli] missing verify implementation script: $impl_path" >&2
    return 2
  fi
  bash "$impl_path" "$@"
}

subcmd="${1:-}"
if [ -z "$subcmd" ] || [ "$subcmd" = "convert" ]; then
  shift || true
  run_convert "$@"
  exit $?
fi

if [ "$subcmd" = "--help" ] || [ "$subcmd" = "-h" ] || [ "$subcmd" = "help" ]; then
  echo "仓五码 UTF-ZH 工具"
  echo "用法: cangwu_ime_cli <subcommand> [options]"
  echo ""
  echo "subcommand:"
  echo "  convert      旧编码 -> Unicode Hub -> UTF-ZH 严格转码"
  echo "  build-assets 生成并校验 IME/UTF-ZH/legacy 资产"
  echo "  verify       运行 IME 闭环验证"
  exit 0
fi

if [ "$subcmd" = "build-assets" ]; then
  shift
  run_build_assets "$@"
  exit $?
fi

if [ "$subcmd" = "verify" ]; then
  shift
  run_verify "$@"
  exit $?
fi

echo "[cangwu-ime-cli] unknown subcommand: $subcmd" >&2
exit 2
