#!/usr/bin/env sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
script_path="$script_dir/$(basename -- "$0")"

compat_depth="${CHENGC_OBJ_COMPAT_DEPTH:-0}"
case "$compat_depth" in
  ''|*[!0-9]*)
    compat_depth=0
    ;;
esac
if [ "$compat_depth" -ge 3 ]; then
  echo "[chengc-obj-compat] recursive driver invocation detected (depth=$compat_depth)" 1>&2
  exit 2
fi
compat_depth=$((compat_depth + 1))
export CHENGC_OBJ_COMPAT_DEPTH="$compat_depth"

if [ "${1:-}" = "" ]; then
  echo "[chengc-obj-compat] missing input file" 1>&2
  exit 2
fi

caller_pwd="$(pwd)"
input="$1"
shift || true

if [ "${input#/}" = "$input" ]; then
  input="$caller_pwd/$input"
fi

cheng_lang_root="/Users/lbcheng/cheng-lang"
detect_target_sh="$cheng_lang_root/src/tooling/detect_host_target.sh"
if [ ! -x "$detect_target_sh" ]; then
  echo "[chengc-obj-compat] missing target detector: $detect_target_sh" 1>&2
  exit 2
fi
gui_pkg_root="/Users/lbcheng/.cheng-packages/cheng-gui"

pkg_roots="${PKG_ROOTS:-}"
if [ -d "/Users/lbcheng/.cheng-packages" ]; then
  case ",$pkg_roots," in
    *,/Users/lbcheng/.cheng-packages,*) ;;
    *) pkg_roots="${pkg_roots}${pkg_roots:+,}/Users/lbcheng/.cheng-packages" ;;
  esac
fi

if [ -d "$gui_pkg_root" ]; then
  case ",$pkg_roots," in
    *,"$gui_pkg_root",*) ;;
    *) pkg_roots="${pkg_roots}${pkg_roots:+,}$gui_pkg_root" ;;
  esac
fi

obj_out=""
bin_out=""
emit_mode="obj"
target="${EXAMPLES_TARGET:-}"
frontend="${BACKEND_FRONTEND:-stage1}"
jobs="${BACKEND_JOBS:-}"
while [ "${1:-}" != "" ]; do
  arg="$1"
  case "$arg" in
    --emit-obj)
      emit_mode="obj"
      ;;
    --emit-exe|--emit-bin)
      emit_mode="exe"
      ;;
    --obj-out:*)
      out_path="${arg#--obj-out:}"
      if [ "${out_path#/}" = "$out_path" ]; then
        out_path="$caller_pwd/$out_path"
      fi
      obj_out="$out_path"
      ;;
    --out:*)
      out_path="${arg#--out:}"
      if [ "${out_path#/}" = "$out_path" ]; then
        out_path="$caller_pwd/$out_path"
      fi
      bin_out="$out_path"
      ;;
    --target:*)
      target="${arg#--target:}"
      ;;
    --frontend:*)
      frontend="${arg#--frontend:}"
      ;;
    --jobs:*)
      jobs="${arg#--jobs:}"
      ;;
    --name:*)
      ;;
    --abi:*)
      ;;
    --emit:*)
      emit_value="${arg#--emit:}"
      if [ "$emit_value" = "obj" ]; then
        emit_mode="obj"
      elif [ "$emit_value" = "exe" ] || [ "$emit_value" = "bin" ]; then
        emit_mode="exe"
      else
        echo "[chengc-obj-compat] unsupported --emit value: $emit_value" 1>&2
        exit 2
      fi
      ;;
    --pkg-roots:*)
      cli_pkg_roots="${arg#--pkg-roots:}"
      if [ -n "$cli_pkg_roots" ]; then
        pkg_roots="$cli_pkg_roots"
      fi
      ;;
    *)
      echo "[chengc-obj-compat] unsupported arg: $arg" 1>&2
      exit 2
      ;;
  esac
  shift || true
done

if [ "$emit_mode" = "obj" ]; then
  if [ -z "$obj_out" ]; then
    echo "[chengc-obj-compat] missing --obj-out:<path>" 1>&2
    exit 2
  fi
else
  if [ -z "$bin_out" ]; then
    echo "[chengc-obj-compat] missing --out:<path> for emit=exe" 1>&2
    exit 2
  fi
fi
if [ -z "$target" ]; then
  target="$(sh "$detect_target_sh")"
fi
if [ -z "$target" ]; then
  echo "[chengc-obj-compat] failed to detect target" 1>&2
  exit 2
fi

selected_driver="${CHENGC_OBJ_COMPAT_DRIVER:-${CW_IME_DRIVER:-}}"
if [ -z "$selected_driver" ] && [ "${CHENGC_OBJ_COMPAT_USE_BACKEND_DRIVER:-0}" = "1" ] && [ -n "${BACKEND_DRIVER:-}" ]; then
  selected_driver="$BACKEND_DRIVER"
fi
if [ -n "$selected_driver" ]; then
  case "$selected_driver" in
    "$script_path"|"$0"|*"/chengc_obj_compat.sh")
      selected_driver=""
      ;;
  esac
fi
if [ -n "$selected_driver" ] && [ ! -x "$selected_driver" ]; then
  echo "[chengc-obj-compat] selected driver is not executable: $selected_driver" 1>&2
  exit 2
fi
if [ -z "$selected_driver" ] && [ -x "$cheng_lang_root/artifacts/backend_driver/cheng" ]; then
  selected_driver="$cheng_lang_root/artifacts/backend_driver/cheng"
fi
if [ -z "$selected_driver" ] && [ -x "$cheng_lang_root/dist/releases/current/cheng" ]; then
  selected_driver="$cheng_lang_root/dist/releases/current/cheng"
fi
if [ -z "$selected_driver" ] && [ -x "$cheng_lang_root/cheng_libp2p_tests" ]; then
  selected_driver="$cheng_lang_root/cheng_libp2p_tests"
fi
if [ -z "$selected_driver" ] && [ -d "$cheng_lang_root/dist/releases" ]; then
  for candidate in "$cheng_lang_root"/dist/releases/*; do
    if [ -x "$candidate/cheng" ]; then
      selected_driver="$candidate/cheng"
      break
    fi
  done
fi
if [ -z "$selected_driver" ] && [ -x "$cheng_lang_root/cheng_stable" ]; then
  selected_driver="$cheng_lang_root/cheng_stable"
fi
if [ -z "$selected_driver" ] && [ -x "$cheng_lang_root/cheng" ]; then
  selected_driver="$cheng_lang_root/cheng"
fi
if [ -z "$selected_driver" ]; then
  echo "[chengc-obj-compat] no runnable backend driver found under $cheng_lang_root" 1>&2
  exit 2
fi

work_root="$caller_pwd"

(
  cd "$work_root"
  backend_output="$obj_out"
  if [ "$emit_mode" = "exe" ]; then
    backend_output="$bin_out"
  fi
  PKG_ROOTS="$pkg_roots" \
  BACKEND_INTERNAL_ALLOW_EMIT_OBJ="${BACKEND_INTERNAL_ALLOW_EMIT_OBJ:-1}" \
  CHENG_BACKEND_INTERNAL_ALLOW_EMIT_OBJ="${CHENG_BACKEND_INTERNAL_ALLOW_EMIT_OBJ:-1}" \
  ABI="${ABI:-v2_noptr}" \
  STAGE1_STD_NO_POINTERS="${STAGE1_STD_NO_POINTERS:-0}" \
  STAGE1_STD_NO_POINTERS_STRICT="${STAGE1_STD_NO_POINTERS_STRICT:-0}" \
  STAGE1_NO_POINTERS_NON_C_ABI="${STAGE1_NO_POINTERS_NON_C_ABI:-0}" \
  STAGE1_NO_POINTERS_NON_C_ABI_INTERNAL="${STAGE1_NO_POINTERS_NON_C_ABI_INTERNAL:-0}" \
  BACKEND_TARGET="$target" \
  BACKEND_JOBS="${jobs:-8}" \
  BACKEND_MULTI="${BACKEND_MULTI:-0}" \
  BACKEND_INCREMENTAL="${BACKEND_INCREMENTAL:-1}" \
  BACKEND_WHOLE_PROGRAM="${BACKEND_WHOLE_PROGRAM:-1}" \
  BACKEND_EMIT="$emit_mode" \
  BACKEND_FRONTEND="$frontend" \
  BACKEND_INPUT="$input" \
  BACKEND_OUTPUT="$backend_output" \
  BACKEND_VALIDATE="${BACKEND_VALIDATE:-0}" \
  STAGE1_SKIP_SEM="${STAGE1_SKIP_SEM:-1}" \
  STAGE1_SKIP_OWNERSHIP="${STAGE1_SKIP_OWNERSHIP:-1}" \
  GENERIC_MODE="${GENERIC_MODE:-dict}" \
  GENERIC_SPEC_BUDGET="${GENERIC_SPEC_BUDGET:-0}" \
  "$selected_driver"
)
