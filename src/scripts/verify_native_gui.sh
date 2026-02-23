#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/verify_native_gui.sh [--desktop-out:<path>] [--android-out:<path>] [--ios-out:<path>]
                               [--name:<prog>]
                               [--desktop-target:<triple>] [--android-target:<triple>] [--ios-target:<triple>]
                               [--jobs:<N>] [--mm:<orc|off>] [--orc|--off]

Notes:
  - Builds native desktop GUI (gui_smoke_main.cheng) via backend obj pipeline + native platform linking.
  - Verifies mobile backend obj outputs (gui_smoke_mobile.cheng) for Android/iOS targets.
EOF
}

prog="cheng_gui_smoke"
desktop_out=""
android_out=""
ios_out=""
desktop_target=""
android_target=""
ios_target=""
jobs=""
mm=""

while [ "${1:-}" != "" ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --desktop-out:*)
      desktop_out="${1#--desktop-out:}"
      ;;
    --android-out:*)
      android_out="${1#--android-out:}"
      ;;
    --ios-out:*)
      ios_out="${1#--ios-out:}"
      ;;
    --name:*)
      prog="${1#--name:}"
      ;;
    --desktop-target:*)
      desktop_target="${1#--desktop-target:}"
      ;;
    --android-target:*)
      android_target="${1#--android-target:}"
      ;;
    --ios-target:*)
      ios_target="${1#--ios-target:}"
      ;;
    --jobs:*)
      jobs="${1#--jobs:}"
      ;;
    --orc)
      mm="orc"
      ;;
    --off)
      mm="off"
      ;;
    --mm:*)
      mm="${1#--mm:}"
      ;;
    --compiler:*)
      echo "[Error] --compiler is removed; backend driver is now the only pipeline" 1>&2
      exit 2
      ;;
    *)
      echo "[Error] unknown arg: $1" 1>&2
      usage
      exit 2
      ;;
  esac
  shift || true
done

GUI_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
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
CHENGC="${CHENGC:-$ROOT/src/tooling/chengc.sh}"
if [ -z "$ROOT" ] || [ ! -x "$CHENGC" ]; then
  echo "[Error] missing Cheng compiler root (set ROOT to /path/to/cheng-lang)" 1>&2
  exit 2
fi

export GUI_ROOT="$GUI_ROOT"
cheng_c_inc="${C_INC:-$ROOT/runtime/include}"
if [ ! -d "$cheng_c_inc" ]; then
  echo "[Error] missing C runtime include dir: $cheng_c_inc" 1>&2
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
  pkg_roots="$GUI_ROOT"
else
  case ",$pkg_roots," in
    *,"$GUI_ROOT",*) ;;
    *) pkg_roots="$pkg_roots,$GUI_ROOT" ;;
  esac
fi
export PKG_ROOTS="$pkg_roots"

entry_desktop="$GUI_ROOT/gui_smoke_main.cheng"
entry_mobile="$GUI_ROOT/gui_smoke_mobile.cheng"
if [ ! -f "$entry_desktop" ]; then
  echo "[Error] missing desktop entry: $entry_desktop" 1>&2
  exit 2
fi
if [ ! -f "$entry_mobile" ]; then
  echo "[Error] missing mobile entry: $entry_mobile" 1>&2
  exit 2
fi

uname_s="$(uname -s)"
case "$uname_s" in
  Darwin)
    platform="macos"
    ;;
  Linux)
    platform="linux"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    platform="windows"
    ;;
  *)
    platform="unknown"
    ;;
esac

if [ -z "$desktop_out" ]; then
  desktop_out="$GUI_ROOT/build/gui_smoke_${platform}"
fi
if [ -z "$android_out" ]; then
  android_out="$GUI_ROOT/build/mobile/gui_smoke_android_obj"
fi
if [ -z "$ios_out" ]; then
  ios_out="$GUI_ROOT/build/mobile/gui_smoke_ios_obj"
fi

mkdir -p "$(dirname "$desktop_out")"
mkdir -p "$android_out" "$ios_out"

if [ -n "$mm" ]; then
  export MM="$mm"
fi

if [ -z "${DEFINES:-}" ]; then
  case "$platform" in
    macos)
      export DEFINES="macos,macosx"
      ;;
    linux)
      export DEFINES="linux"
      ;;
    windows)
      export DEFINES="windows,Windows"
      ;;
  esac
fi

cd "$ROOT"

probe_driver_compile() {
  driver="$1"
  target="$2"
  probe_src="$ROOT/chengcache/_cheng_driver_probe_main.cheng"
  probe_obj="$ROOT/chengcache/_cheng_driver_probe_main.o"
  mkdir -p "$ROOT/chengcache"
  cat > "$probe_src" <<'EOF'
fn main(): int32 =
    return 0
EOF
  env BACKEND_TARGET="$target" BACKEND_JOBS="1" BACKEND_MULTI="0" BACKEND_INCREMENTAL="0" BACKEND_WHOLE_PROGRAM="0" BACKEND_EMIT="obj" BACKEND_FRONTEND="stage1" BACKEND_INPUT="$probe_src" BACKEND_OUTPUT="$probe_obj" "$driver" >/dev/null 2>&1 || return 1
  [ -s "$probe_obj" ] || return 1
  return 0
}

pick_backend_driver() {
  target="$1"
  if [ -n "${BACKEND_DRIVER:-}" ] && [ -x "${BACKEND_DRIVER}" ]; then
    if probe_driver_compile "${BACKEND_DRIVER}" "$target"; then
      echo "${BACKEND_DRIVER}"
      return 0
    fi
  fi

  candidates=""
  if [ -x "$ROOT/cheng_stable" ]; then
    candidates="$candidates
$ROOT/cheng_stable"
  fi
  if [ -x "$ROOT/cheng" ]; then
    candidates="$candidates
$ROOT/cheng"
  fi
  if [ -x "$ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2" ]; then
    candidates="$candidates
$ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2"
  fi
  if [ -d "$ROOT/dist/releases" ]; then
    while IFS= read -r release_path; do
      if [ -d "$release_path" ] && [ -x "$release_path/cheng" ]; then
        candidates="$candidates
$release_path/cheng"
      fi
    done < <(ls -1dt "$ROOT"/dist/releases/* 2>/dev/null || true)
  fi
  for cand in "$ROOT"/driver_*; do
    if [ -f "$cand" ] && [ -x "$cand" ]; then
      candidates="$candidates
$cand"
    fi
  done

  selected=""
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    if probe_driver_compile "$candidate" "$target"; then
      selected="$candidate"
      break
    fi
  done <<EOF
$candidates
EOF
  [ -n "$selected" ] || return 1
  echo "$selected"
  return 0
}

if [ -z "${BACKEND_DRIVER:-}" ]; then
  :
fi

if [ -z "$desktop_target" ]; then
  desktop_target="$(sh "$ROOT/src/tooling/detect_host_target.sh")"
fi
if [ -z "$desktop_target" ]; then
  echo "[Error] failed to detect desktop target; use --desktop-target:<triple>" 1>&2
  exit 2
fi

selected_driver="$(pick_backend_driver "$desktop_target" || true)"
if [ -z "$selected_driver" ]; then
  echo "[Error] no runnable backend driver found under ROOT=$ROOT" 1>&2
  echo "  tip: set BACKEND_DRIVER to a runnable driver binary" 1>&2
  exit 2
fi
export BACKEND_DRIVER="$selected_driver"
if [ -z "${BACKEND_DRIVER_DIRECT:-}" ]; then
  export BACKEND_DRIVER_DIRECT=0
fi
if [ -z "$android_target" ]; then
  android_target="aarch64-linux-android"
fi
if [ -z "$ios_target" ]; then
  ios_target="arm64-apple-ios"
fi

compile_to_obj() {
  input="$1"
  obj="$2"
  target="$3"
  defines="$4"
  set -- "$CHENGC" "$input" --emit-obj --obj-out:"$obj" --target:"$target"
  if [ -n "$jobs" ]; then
    set -- "$@" --jobs:"$jobs"
  fi
  if [ -n "${BUILD_VERBOSE:-}" ]; then
    if [ -n "$defines" ]; then
      DEFINES="$defines" "$@" || return 1
    else
      "$@" || return 1
    fi
  else
    if [ -n "$defines" ]; then
      DEFINES="$defines" "$@" >/dev/null || return 1
    else
      "$@" >/dev/null || return 1
    fi
  fi
  [ -f "$obj" ] || return 1
}

obj_main="$ROOT/chengcache/${prog}.o"
mkdir -p "$(dirname "$obj_main")"
desktop_defines="${DEFINES:-}"
echo "== GUI desktop: Cheng -> obj =="
compile_to_obj "$entry_desktop" "$obj_main" "$desktop_target" "$desktop_defines"
echo "ok: backend obj ($desktop_target)"

cc="${CC:-cc}"
obj_sys="$ROOT/chengcache/${prog}.system_helpers.o"
obj_compat="$ROOT/chengcache/${prog}.compat_shim.o"
obj_stub="$ROOT/chengcache/${prog}.mobile_stub.o"
obj_skia="$ROOT/chengcache/${prog}.skia_stub.o"
compat_shim_src="$GUI_ROOT/runtime/cheng_compat_shim.c"
cflags=""
case "$platform" in
  macos)
    cflags="-Wno-incompatible-library-redeclaration -Wno-builtin-requires-header"
    ;;
esac

echo "== GUI desktop: compile runtime helpers =="
# Always rebind helper names to avoid duplicate symbols with backend-emitted alloc/copyMem/setMem.
"$cc" -I"$cheng_c_inc" -I"$ROOT/src/runtime/native" \
  -Dalloc=cheng_runtime_alloc -DcopyMem=cheng_runtime_copyMem -DsetMem=cheng_runtime_setMem \
  -c "$ROOT/src/runtime/native/system_helpers.c" -o "$obj_sys"
if [ -f "$compat_shim_src" ]; then
  "$cc" -c "$compat_shim_src" -o "$obj_compat"
else
  obj_compat=""
fi

echo "== GUI desktop: compile platform stubs =="
"$cc" -c "$GUI_ROOT/platform/cheng_mobile_host_stub.c" -o "$obj_stub"
"$cc" -c "$GUI_ROOT/render/skia_stub.c" -o "$obj_skia"

echo "== GUI desktop: link native platform =="
case "$platform" in
  macos)
    if ! command -v clang >/dev/null 2>&1; then
      echo "[Error] macOS build requires clang" 1>&2
      exit 2
    fi
    obj_plat="$ROOT/chengcache/${prog}.macos_app.o"
    obj_text="$ROOT/chengcache/${prog}.text_macos.o"
    clang -fobjc-arc -c "$GUI_ROOT/platform/macos_app.m" -o "$obj_plat"
    clang -std=c11 -c "$GUI_ROOT/render/text_macos.c" -o "$obj_text"
    clang "$obj_main" "$obj_sys" ${obj_compat:+"$obj_compat"} "$obj_stub" "$obj_skia" "$obj_plat" "$obj_text" \
      -framework Cocoa -framework QuartzCore -framework CoreGraphics -framework CoreText -framework CoreFoundation \
      -o "$desktop_out"
    ;;
  linux)
    obj_plat="$ROOT/chengcache/${prog}.x11_app.o"
    "$cc" -c "$GUI_ROOT/platform/x11_app.c" -o "$obj_plat"
    "$cc" "$obj_main" "$obj_sys" ${obj_compat:+"$obj_compat"} "$obj_stub" "$obj_skia" "$obj_plat" -lX11 -lXext -o "$desktop_out"
    ;;
  windows)
    obj_plat="$ROOT/chengcache/${prog}.win32_app.o"
    "$cc" -c "$GUI_ROOT/platform/win32_app.c" -o "$obj_plat"
    "$cc" "$obj_main" "$obj_sys" ${obj_compat:+"$obj_compat"} "$obj_stub" "$obj_skia" "$obj_plat" -luser32 -lgdi32 -limm32 -o "$desktop_out"
    ;;
  *)
    echo "[Error] unsupported platform: $uname_s" 1>&2
    exit 2
    ;;
esac

echo "ok: desktop binary -> $desktop_out"

android_obj="$android_out/${prog}_android.o"
ios_obj="$ios_out/${prog}_ios.o"

echo "== GUI mobile: backend obj Android =="
compile_to_obj "$entry_mobile" "$android_obj" "$android_target" "android,mobile_host"
echo "ok: android obj -> $android_obj"

echo "== GUI mobile: backend obj iOS =="
compile_to_obj "$entry_mobile" "$ios_obj" "$ios_target" "ios,mobile_host"
echo "ok: ios obj -> $ios_obj"

echo "ok: mobile backend obj -> $android_obj / $ios_obj"
