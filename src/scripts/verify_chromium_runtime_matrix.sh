#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"
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
  echo "[verify-chromium-runtime-matrix] missing ROOT" >&2
  exit 2
fi

CHENGC="${CHENGC:-$ROOT/src/tooling/chengc.sh}"
if [ ! -x "$CHENGC" ]; then
  echo "[verify-chromium-runtime-matrix] missing chengc: $CHENGC" >&2
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
    echo "[verify-chromium-runtime-matrix] missing backend driver under ROOT=$ROOT" >&2
    exit 2
  fi
  export BACKEND_DRIVER="$selected_driver"
fi

export BACKEND_DRIVER_DIRECT="${BACKEND_DRIVER_DIRECT:-0}"

host_target="${KIT_TARGET:-}"
if [ -z "$host_target" ]; then
  host_target="$(sh "$ROOT/src/tooling/detect_host_target.sh")"
fi
if [ -z "$host_target" ]; then
  echo "[verify-chromium-runtime-matrix] failed to detect host target" >&2
  exit 2
fi

linux_target="${CHROMIUM_LINUX_TARGET:-x86_64-unknown-linux-gnu}"
windows_target="${CHROMIUM_WINDOWS_TARGET:-x86_64-pc-windows-msvc}"
android_target="${CHROMIUM_ANDROID_TARGET:-aarch64-linux-android}"
ios_target="${CHROMIUM_IOS_TARGET:-arm64-apple-ios}"
web_target="${CHROMIUM_WEB_TARGET:-$linux_target}"

out_dir="$ROOT/build/chromium_runtime_matrix"
mkdir -p "$out_dir"
reuse_obj="${CHROMIUM_RUNTIME_REUSE_OBJ:-0}"

compile_to_obj() {
  local target="$1"
  local defines="$2"
  local obj="$3"
  local log="$4"
  if [ "$reuse_obj" = "1" ] && [ -s "$obj" ]; then
    return 0
  fi
  rm -f "$obj"
  if ! (
    cd "$ROOT"
    DEFINES="$defines" sh "$CHENGC" "$ROOT/chromium_engine_smoke_main.cheng" --emit-obj --obj-out:"$obj" --target:"$target"
  ) >"$log" 2>&1; then
    return 1
  fi
  [ -s "$obj" ] || return 1
  return 0
}

entries=(
  "macos|$host_target|macos,macosx"
  "linux|$linux_target|linux"
  "windows|$windows_target|windows,Windows"
  "android|$android_target|android,mobile_host"
  "ios|$ios_target|ios,mobile_host"
  "web|$web_target|web,wasm"
)

for entry in "${entries[@]}"; do
  IFS='|' read -r name target defines <<<"$entry"
  obj="$out_dir/chromium_${name}.o"
  log="$out_dir/chromium_${name}.compile.log"
  if ! compile_to_obj "$target" "$defines" "$obj" "$log"; then
    echo "[verify-chromium-runtime-matrix] compile failed: $name target=$target" >&2
    sed -n '1,120p' "$log" >&2
    exit 1
  fi
  echo "[verify-chromium-runtime-matrix] ok: $name -> $obj"
done

host="$(uname -s)"
runtime_exec="${CHROMIUM_RUNTIME_EXEC:-1}"
if [ "$host" = "Darwin" ]; then
  if [ "$runtime_exec" != "1" ]; then
    echo "[verify-chromium-runtime-matrix] strict mode requires CHROMIUM_RUNTIME_EXEC=1 on Darwin" >&2
    exit 1
  fi
  cc="${CC:-clang}"
  bin="$out_dir/chromium_engine_smoke_macos"
  run_log="$out_dir/chromium_engine_smoke_macos.run.log"
  obj_main="$out_dir/chromium_macos.o"
  obj_sys="$ROOT/chengcache/chromium_runtime_matrix.system_helpers.o"
  obj_compat="$ROOT/chengcache/chromium_runtime_matrix.compat_shim.o"
  compat_shim_src="$ROOT/runtime/cheng_compat_shim.c"
  "$cc" -I"$ROOT/runtime/include" -I"$ROOT/src/runtime/native" \
    -Dalloc=cheng_runtime_alloc -DcopyMem=cheng_runtime_copyMem -DsetMem=cheng_runtime_setMem \
    -c "$ROOT/src/runtime/native/system_helpers.c" -o "$obj_sys"
  if [ -f "$compat_shim_src" ]; then
    "$cc" -c "$compat_shim_src" -o "$obj_compat"
    "$cc" "$obj_main" "$obj_sys" "$obj_compat" -o "$bin"
  else
    "$cc" "$obj_main" "$obj_sys" -o "$bin"
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
    echo "[verify-chromium-runtime-matrix] runtime failed rc=$run_rc" >&2
    sed -n '1,120p' "$run_log" >&2
    exit 1
  fi
  if [ ! -s "$run_log" ]; then
    echo "[verify-chromium-runtime-matrix] runtime log missing: $run_log" >&2
    exit 1
  fi
  if rg -n "runtime skipped|compile-only" "$run_log" >/dev/null 2>&1; then
    echo "[verify-chromium-runtime-matrix] invalid runtime marker in log: $run_log" >&2
    exit 1
  fi
  echo "[verify-chromium-runtime-matrix] ok: runtime -> $bin"
else
  echo "[verify-chromium-runtime-matrix] runtime execution required on blocking gate host; got host=$(uname -s)" >&2
  exit 1
fi
