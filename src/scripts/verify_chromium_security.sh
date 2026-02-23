#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"
unset BACKEND_WHOLE_PROGRAM
ROOT="${ROOT:-}"
if [ -z "$ROOT" ]; then
  if [ -d "$HOME/.cheng/toolchain/cheng-lang" ]; then
    ROOT="$HOME/.cheng/toolchain/cheng-lang"
  elif [ -d "$HOME/cheng-lang" ]; then
    ROOT="$HOME/cheng-lang"
  elif [ -d "/Users/lbcheng/cheng-lang" ]; then
    ROOT="/Users/lbcheng/cheng-lang"
  fi
fi
if [ -z "$ROOT" ]; then
  echo "[verify-chromium-security] missing ROOT" >&2
  exit 2
fi

CHENGC="${CHENGC:-$ROOT/src/tooling/chengc.sh}"
if [ ! -x "$CHENGC" ]; then
  echo "[verify-chromium-security] missing chengc: $CHENGC" >&2
  exit 2
fi

pkg_roots="${PKG_ROOTS:-}"
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
export PKG_ROOTS="$pkg_roots"

if [ -z "${BACKEND_DRIVER:-}" ]; then
  selected_driver=""
  if [ -x "$ROOT/cheng_stable" ]; then
    selected_driver="$ROOT/cheng_stable"
  elif [ -x "$ROOT/cheng" ]; then
    selected_driver="$ROOT/cheng"
  fi
  if [ -z "$selected_driver" ] && [ -d "$ROOT/dist/releases" ]; then
    while IFS= read -r candidate; do
      if [ -x "$candidate/cheng" ]; then
        selected_driver="$candidate/cheng"
        break
      fi
    done < <(ls -1dt "$ROOT"/dist/releases/* 2>/dev/null || true)
  fi
  for cand in "$ROOT"/driver_*; do
    if [ -n "$selected_driver" ]; then
      break
    fi
    if [ -f "$cand" ] && [ -x "$cand" ]; then
      selected_driver="$cand"
      break
    fi
  done
  if [ -z "$selected_driver" ] && [ -x "$ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2" ]; then
    selected_driver="$ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2"
  fi
  if [ -z "$selected_driver" ]; then
    echo "[verify-chromium-security] missing backend driver under ROOT=$ROOT" >&2
    exit 2
  fi
  export BACKEND_DRIVER="$selected_driver"
fi

export BACKEND_DRIVER_DIRECT="${BACKEND_DRIVER_DIRECT:-0}"
target="${KIT_TARGET:-}"
if [ -z "$target" ]; then
  target="$(sh "$ROOT/src/tooling/detect_host_target.sh")"
fi
if [ -z "$target" ]; then
  echo "[verify-chromium-security] failed to detect host target" >&2
  exit 2
fi

out_dir="$ROOT/build/chromium_security"
mkdir -p "$out_dir"
obj="$ROOT/chengcache/chromium_security_smoke.runtime.o"
compile_log="$out_dir/chromium_security_smoke.compile.log"
reuse_obj="${CHROMIUM_SECURITY_REUSE_OBJ:-0}"
if [ "$reuse_obj" != "1" ] || [ ! -s "$obj" ]; then
  rm -f "$obj"
  if ! (
    cd "$ROOT"
    DEFINES="${DEFINES:-macos,macosx}" sh "$CHENGC" "$ROOT/chromium_security_smoke_main.cheng" --emit-obj --obj-out:"$obj" --target:"$target"
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
runtime_exec="${CHROMIUM_RUNTIME_EXEC:-1}"
if [ "$host" = "Darwin" ]; then
  if [ "$runtime_exec" != "1" ]; then
    echo "[verify-chromium-security] strict mode requires CHROMIUM_RUNTIME_EXEC=1 on Darwin" >&2
    exit 1
  fi
  cc="${CC:-clang}"
  obj_sys="$ROOT/chengcache/chromium_security_smoke.system_helpers.runtime.o"
  obj_compat="$ROOT/chengcache/chromium_security_smoke.compat_shim.runtime.o"
  compat_shim_src="$ROOT/runtime/cheng_compat_shim.c"
  bin="$out_dir/chromium_security_smoke_macos"
  run_log="$out_dir/chromium_security_smoke_macos.run.log"
  reuse_bin="${CHROMIUM_SECURITY_REUSE_BIN:-0}"

  if [ "$reuse_bin" != "1" ] || [ ! -x "$bin" ]; then
    "$cc" -I"$ROOT/runtime/include" -I"$ROOT/src/runtime/native" \
      -Dalloc=cheng_runtime_alloc -DcopyMem=cheng_runtime_copyMem -DsetMem=cheng_runtime_setMem \
      -c "$ROOT/src/runtime/native/system_helpers.c" -o "$obj_sys"
    if [ -f "$compat_shim_src" ]; then
      "$cc" -c "$compat_shim_src" -o "$obj_compat"
      "$cc" "$obj" "$obj_sys" "$obj_compat" -o "$bin"
    else
      "$cc" "$obj" "$obj_sys" -o "$bin"
    fi
  fi

  {
    echo "runtime_exec=1"
    echo "host=$host"
    echo "binary=$bin"
    echo "start_epoch=$(date +%s)"
  } >"$run_log"
  set +e
  "$bin" >>"$run_log" 2>&1
  run_rc=$?
  set -e
  {
    echo "run_rc=$run_rc"
    echo "end_epoch=$(date +%s)"
  } >>"$run_log"
  if [ "$run_rc" -ne 0 ]; then
    echo "[verify-chromium-security] runtime failed rc=$run_rc" >&2
    sed -n '1,120p' "$run_log" >&2
    exit 1
  fi
  if [ ! -s "$run_log" ]; then
    echo "[verify-chromium-security] runtime log missing: $run_log" >&2
    exit 1
  fi
  if rg -n "runtime skipped|compile-only" "$run_log" >/dev/null 2>&1; then
    echo "[verify-chromium-security] invalid runtime marker in log: $run_log" >&2
    exit 1
  fi
  echo "[verify-chromium-security] ok: $bin"
else
  echo "[verify-chromium-security] runtime execution required on blocking gate host; got host=$host" >&2
  exit 1
fi
