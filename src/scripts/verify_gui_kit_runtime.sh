#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export CHENG_GUI_ROOT="$ROOT"
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
  echo "[verify-gui-kit-runtime] missing CHENG_ROOT" >&2
  exit 2
fi

CHENGC="${CHENGC:-$CHENG_ROOT/src/tooling/chengc.sh}"
if [ ! -x "$CHENGC" ]; then
  echo "[verify-gui-kit-runtime] missing chengc: $CHENGC" >&2
  exit 2
fi

host="$(uname -s)"
if [ "$host" != "Darwin" ]; then
  echo "[verify-gui-kit-runtime] skip: host=$host (runtime smoke currently macOS-only)"
  exit 0
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
    echo "[verify-gui-kit-runtime] missing backend driver under CHENG_ROOT=$CHENG_ROOT" >&2
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
  echo "[verify-gui-kit-runtime] failed to detect host target" >&2
  exit 2
fi

main_src="$ROOT/gui_kit_smoke_main.cheng"
if [ ! -f "$main_src" ]; then
  echo "[verify-gui-kit-runtime] missing source: $main_src" >&2
  exit 1
fi

out="$ROOT/build/gui_kit_smoke_macos"
run_log="$ROOT/build/gui_kit_smoke_macos.run.log"
mkdir -p "$(dirname "$out")"

obj_main="$CHENG_ROOT/chengcache/gui_kit_smoke_main.runtime.o"
obj_sys="$CHENG_ROOT/chengcache/gui_kit_smoke.system_helpers.runtime.o"
obj_compat="$CHENG_ROOT/chengcache/gui_kit_smoke.compat_shim.runtime.o"
obj_stub="$CHENG_ROOT/chengcache/gui_kit_smoke.mobile_stub.runtime.o"
obj_skia="$CHENG_ROOT/chengcache/gui_kit_smoke.skia_stub.runtime.o"
obj_plat="$CHENG_ROOT/chengcache/gui_kit_smoke.macos_app.runtime.o"
obj_text="$CHENG_ROOT/chengcache/gui_kit_smoke.text_macos.runtime.o"
compat_shim_src="$ROOT/runtime/cheng_compat_shim.c"

cd "$CHENG_ROOT"
CHENG_DEFINES="${CHENG_DEFINES:-macos,macosx}" sh "$CHENGC" "$main_src" --emit-obj --obj-out:"$obj_main" --target:"$target" >/dev/null

clang -I"$CHENG_ROOT/runtime/include" -I"$CHENG_ROOT/src/runtime/native" \
  -Dalloc=cheng_runtime_alloc -DcopyMem=cheng_runtime_copyMem -DsetMem=cheng_runtime_setMem \
  -c "$CHENG_ROOT/src/runtime/native/system_helpers.c" -o "$obj_sys"
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

set +e
"$out" >"$run_log" 2>&1
run_rc=$?
set -e
if [ "$run_rc" -ne 0 ]; then
  echo "[verify-gui-kit-runtime] runtime failed rc=$run_rc (log: $run_log)" >&2
  sed -n '1,120p' "$run_log" >&2
  exit 1
fi

echo "[verify-gui-kit-runtime] ok: $out"
