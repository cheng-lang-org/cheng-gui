#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
# Cheng toolchain resolves `gui/*` modules via GUI_ROOT.
export GUI_ROOT="$ROOT"
# Keep runtime smoke on stable non-whole-program backend path.
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
  echo "[verify-browser-runtime] missing ROOT" >&2
  exit 2
fi

CHENGC="${CHENGC:-$ROOT/src/tooling/chengc.sh}"
if [ ! -x "$CHENGC" ]; then
  echo "[verify-browser-runtime] missing chengc: $CHENGC" >&2
  exit 2
fi

host="$(uname -s)"
if [ "$host" != "Darwin" ]; then
  echo "[verify-browser-runtime] skip: host=$host (runtime smoke currently macOS-only)"
  exit 0
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
    echo "[verify-browser-runtime] missing backend driver under ROOT=$ROOT" >&2
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
  echo "[verify-browser-runtime] failed to detect host target" >&2
  exit 2
fi

main_src="$ROOT/browser_core_smoke_main.cheng"
if [ ! -f "$main_src" ]; then
  echo "[verify-browser-runtime] missing source: $main_src" >&2
  exit 1
fi

out="$ROOT/build/browser_core_smoke_macos"
run_log="$ROOT/build/browser_core_smoke_macos.run.log"
mkdir -p "$(dirname "$out")"
reuse_runtime_bin="${BROWSER_RUNTIME_REUSE_BIN:-0}"

obj_main="$ROOT/chengcache/browser_core_smoke_main.runtime.o"
obj_sys="$ROOT/chengcache/browser_core_smoke.system_helpers.runtime.o"
obj_compat="$ROOT/chengcache/browser_core_smoke.compat_shim.runtime.o"
obj_stub="$ROOT/chengcache/browser_core_smoke.mobile_stub.runtime.o"
obj_skia="$ROOT/chengcache/browser_core_smoke.skia_stub.runtime.o"
obj_plat="$ROOT/chengcache/browser_core_smoke.macos_app.runtime.o"
obj_text="$ROOT/chengcache/browser_core_smoke.text_macos.runtime.o"
compat_shim_src="$ROOT/runtime/cheng_compat_shim.c"

if [ "$reuse_runtime_bin" != "1" ] || [ ! -x "$out" ]; then
  cd "$ROOT"
  DEFINES="${DEFINES:-macos,macosx}" sh "$CHENGC" "$main_src" --emit-obj --obj-out:"$obj_main" --target:"$target" >/dev/null

  clang -I"$ROOT/runtime/include" -I"$ROOT/src/runtime/native" \
    -Dalloc=cheng_runtime_alloc -DcopyMem=cheng_runtime_copyMem -DsetMem=cheng_runtime_setMem \
    -c "$ROOT/src/runtime/native/system_helpers.c" -o "$obj_sys"
  if [ -f "$compat_shim_src" ]; then
    clang -c "$compat_shim_src" -o "$obj_compat"
  else
    obj_compat=""
  fi
  clang -c "$ROOT/platform/cheng_mobile_host_stub.c" -o "$obj_stub"
  clang -c "$ROOT/render/skia_stub.c" -o "$obj_skia"
  clang -fobjc-arc -c "$ROOT/platform/macos_app.m" -o "$obj_plat"
  clang -std=c11 -c "$ROOT/render/text_macos.c" -o "$obj_text"
  clang "$obj_main" "$obj_sys" ${obj_compat:+"$obj_compat"} "$obj_stub" "$obj_skia" "$obj_plat" "$obj_text" \
    -framework Cocoa -framework QuartzCore -framework CoreGraphics -framework CoreText -framework CoreFoundation \
    -o "$out"
fi

set +e
"$out" >"$run_log" 2>&1
run_rc=$?
set -e
if [ "$run_rc" -ne 0 ]; then
  echo "[verify-browser-runtime] runtime failed rc=$run_rc (log: $run_log)" >&2
  sed -n '1,120p' "$run_log" >&2
  exit 1
fi

echo "[verify-browser-runtime] ok: $out"
