#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export CHENG_GUI_ROOT="$ROOT"
unset CHENG_BACKEND_WHOLE_PROGRAM
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
  echo "[verify-chromium-security] missing CHENG_ROOT" >&2
  exit 2
fi

CHENGC="${CHENGC:-$CHENG_ROOT/src/tooling/chengc.sh}"
if [ ! -x "$CHENGC" ]; then
  echo "[verify-chromium-security] missing chengc: $CHENGC" >&2
  exit 2
fi

pkg_roots="${CHENG_PKG_ROOTS:-}"
default_pkg_root="$HOME/.cheng-packages"
if [ -d "$default_pkg_root" ]; then
  if [ -z "$pkg_roots" ]; then
    pkg_roots="$default_pkg_root"
  else
    case ",$pkg_roots," in
      *,"$default_pkg_root",*) ;;
      *) pkg_roots="$pkg_roots,$default_pkg_root" ;;
    esac
  fi
fi
if [ -z "$pkg_roots" ]; then
  pkg_roots="$ROOT"
else
  case ",$pkg_roots," in
    *,"$ROOT",*) ;;
    *) pkg_roots="$pkg_roots,$ROOT" ;;
  esac
fi
export CHENG_PKG_ROOTS="$pkg_roots"

if [ -z "${CHENG_BACKEND_DRIVER:-}" ]; then
  selected_driver=""
  if [ -x "$CHENG_ROOT/cheng_stable" ]; then
    selected_driver="$CHENG_ROOT/cheng_stable"
  elif [ -x "$CHENG_ROOT/cheng" ]; then
    selected_driver="$CHENG_ROOT/cheng"
  fi
  if [ -z "$selected_driver" ] && [ -d "$CHENG_ROOT/dist/releases" ]; then
    while IFS= read -r candidate; do
      if [ -x "$candidate/cheng" ]; then
        selected_driver="$candidate/cheng"
        break
      fi
    done < <(ls -1dt "$CHENG_ROOT"/dist/releases/* 2>/dev/null || true)
  fi
  for cand in "$CHENG_ROOT"/driver_*; do
    if [ -n "$selected_driver" ]; then
      break
    fi
    if [ -f "$cand" ] && [ -x "$cand" ]; then
      selected_driver="$cand"
      break
    fi
  done
  if [ -z "$selected_driver" ] && [ -x "$CHENG_ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2" ]; then
    selected_driver="$CHENG_ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2"
  fi
  if [ -z "$selected_driver" ]; then
    echo "[verify-chromium-security] missing backend driver under CHENG_ROOT=$CHENG_ROOT" >&2
    exit 2
  fi
  export CHENG_BACKEND_DRIVER="$selected_driver"
fi

export CHENG_BACKEND_DRIVER_DIRECT="${CHENG_BACKEND_DRIVER_DIRECT:-0}"
target="${CHENG_KIT_TARGET:-}"
if [ -z "$target" ]; then
  target="$(sh "$CHENG_ROOT/src/tooling/detect_host_target.sh")"
fi
if [ -z "$target" ]; then
  echo "[verify-chromium-security] failed to detect host target" >&2
  exit 2
fi

out_dir="$ROOT/build/chromium_security"
mkdir -p "$out_dir"
obj="$CHENG_ROOT/chengcache/chromium_security_smoke.runtime.o"
compile_log="$out_dir/chromium_security_smoke.compile.log"
reuse_obj="${CHENG_CHROMIUM_SECURITY_REUSE_OBJ:-0}"
if [ "$reuse_obj" != "1" ] || [ ! -s "$obj" ]; then
  rm -f "$obj"
  if ! (
    cd "$CHENG_ROOT"
    CHENG_DEFINES="${CHENG_DEFINES:-macos,macosx}" sh "$CHENGC" "$ROOT/chromium_security_smoke_main.cheng" --emit-obj --obj-out:"$obj" --target:"$target"
  ) >"$compile_log" 2>&1; then
    echo "[verify-chromium-security] compile failed" >&2
    sed -n '1,120p' "$compile_log" >&2
    exit 1
  fi
fi

if [ ! -s "$obj" ]; then
  echo "[verify-chromium-security] compile failed" >&2
  sed -n '1,120p' "$compile_log" >&2
  exit 1
fi

host="$(uname -s)"
runtime_exec="${CHENG_CHROMIUM_RUNTIME_EXEC:-1}"
if [ "$host" = "Darwin" ]; then
  if [ "$runtime_exec" != "1" ]; then
    echo "[verify-chromium-security] strict mode requires CHENG_CHROMIUM_RUNTIME_EXEC=1 on Darwin" >&2
    exit 1
  fi
  cc="${CC:-clang}"
  obj_sys="$CHENG_ROOT/chengcache/chromium_security_smoke.system_helpers.runtime.o"
  obj_compat="$CHENG_ROOT/chengcache/chromium_security_smoke.compat_shim.runtime.o"
  compat_shim_src="$ROOT/runtime/cheng_compat_shim.c"
  bin="$out_dir/chromium_security_smoke_macos"
  run_log="$out_dir/chromium_security_smoke_macos.run.log"
  reuse_bin="${CHENG_CHROMIUM_SECURITY_REUSE_BIN:-0}"

  if [ "$reuse_bin" != "1" ] || [ ! -x "$bin" ]; then
    "$cc" -I"$CHENG_ROOT/runtime/include" -I"$CHENG_ROOT/src/runtime/native" \
      -Dalloc=cheng_runtime_alloc -DcopyMem=cheng_runtime_copyMem -DsetMem=cheng_runtime_setMem \
      -c "$CHENG_ROOT/src/runtime/native/system_helpers.c" -o "$obj_sys"
    if [ -f "$compat_shim_src" ]; then
      "$cc" -c "$compat_shim_src" -o "$obj_compat"
      "$cc" "$obj" "$obj_sys" "$obj_compat" -o "$bin"
    else
      "$cc" "$obj" "$obj_sys" -o "$bin"
    fi
  fi

  set +e
  "$bin" >"$run_log" 2>&1
  run_rc=$?
  set -e
  if [ "$run_rc" -ne 0 ]; then
    echo "[verify-chromium-security] runtime failed rc=$run_rc" >&2
    sed -n '1,120p' "$run_log" >&2
    exit 1
  fi
  echo "[verify-chromium-security] ok: $bin"
else
  echo "[verify-chromium-security] ok: runtime skipped host=$host"
fi
