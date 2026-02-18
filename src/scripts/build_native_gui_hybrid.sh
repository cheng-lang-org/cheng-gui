#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/build_native_gui_hybrid.sh [--out:<path>] [--name:<prog>] [--hybrid-map:<path>] [--hybrid-default:<c|asm>]

Notes:
  - Builds GUI desktop binary via Cheng hybrid C+ASM backend.
  - Uses cheng-lang/src/tooling/chengc.sh with module-level hybrid map.
EOF
}

prog="cheng_gui_hybrid"
out=""
hybrid_map=""
hybrid_default="asm"
while [ "${1:-}" != "" ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --out:*)
      out="${1#--out:}"
      ;;
    --name:*)
      prog="${1#--name:}"
      ;;
    --hybrid-map:*)
      hybrid_map="${1#--hybrid-map:}"
      ;;
    --hybrid-default:*)
      hybrid_default="${1#--hybrid-default:}"
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
if [ -z "$CHENG_ROOT" ] || [ ! -x "$CHENG_ROOT/src/tooling/chengc.sh" ]; then
  echo "[Error] missing Cheng toolchain root (set CHENG_ROOT to /path/to/cheng-lang)" 1>&2
  exit 2
fi

export CHENG_GUI_ROOT="$GUI_ROOT"
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
  pkg_roots="$GUI_ROOT"
else
  case ",$pkg_roots," in
    *,"$GUI_ROOT",*) ;;
    *) pkg_roots="$pkg_roots,$GUI_ROOT" ;;
  esac
fi
export CHENG_PKG_ROOTS="$pkg_roots"

entry="$GUI_ROOT/gui_smoke_main.cheng"
if [ ! -f "$entry" ]; then
  echo "[Error] missing entry: $entry" 1>&2
  exit 2
fi

if [ -z "$hybrid_map" ]; then
  hybrid_map="$GUI_ROOT/configs/gui_hybrid.map"
fi
if [ ! -f "$hybrid_map" ]; then
  echo "[Error] missing hybrid map: $hybrid_map" 1>&2
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

if [ -z "$out" ]; then
  out="$GUI_ROOT/build/gui_smoke_hybrid_${platform}"
fi

modules_out="$GUI_ROOT/build/hybrid/${prog}.modules"
shim="$GUI_ROOT/build/hybrid/cc_link_shim.sh"
mkdir -p "$(dirname "$modules_out")"

cat >"$shim" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
real_cc="${CC_REAL:-cc}"
out=""
compile=0
for ((i=1; i<=$#; i++)); do
  arg="${!i}"
  if [ "$arg" = "-c" ]; then
    compile=1
  fi
  if [ "$arg" = "-o" ]; then
    j=$((i + 1))
    out="${!j}"
  fi
done
if [ "$compile" -eq 1 ]; then
  exec "$real_cc" "$@"
fi
if [ -n "$out" ]; then
  : > "$out"
  exit 0
fi
exec "$real_cc" "$@"
EOF
chmod +x "$shim"

real_cc="${CC:-cc}"

cd "$CHENG_ROOT"

CC_REAL="$real_cc" CC="$shim" CHENG_ASM_CC="$real_cc" \
  "$CHENG_ROOT/src/tooling/chengc.sh" "$entry" --name:"$prog" --backend:hybrid \
  --hybrid-map:"$hybrid_map" --hybrid-default:"$hybrid_default" --modules-out:"$modules_out"

modules_map="$modules_out/modules.map"
if [ ! -f "$modules_map" ]; then
  echo "[Error] missing modules map: $modules_map" 1>&2
  exit 2
fi

obj_inputs="$(awk -F '\t' '{print $4}' "$modules_map" | tr '\n' ' ')"
if [ "$obj_inputs" = "" ]; then
  echo "[Error] no module objects produced" 1>&2
  exit 2
fi

obj_stub="$modules_out/${prog}.mobile_stub.o"
obj_skia="$modules_out/${prog}.skia_stub.o"

echo "== GUI hybrid: compile platform stubs =="
"$real_cc" -c "$GUI_ROOT/platform/cheng_mobile_host_stub.c" -o "$obj_stub"
"$real_cc" -c "$GUI_ROOT/render/skia_stub.c" -o "$obj_skia"

echo "== GUI hybrid: link platform =="
case "$platform" in
  macos)
    if ! command -v clang >/dev/null 2>&1; then
      echo "[Error] macOS build requires clang" 1>&2
      exit 2
    fi
    obj_plat="$modules_out/${prog}.macos_app.o"
    obj_text="$modules_out/${prog}.text_macos.o"
    clang -fobjc-arc -c "$GUI_ROOT/platform/macos_app.m" -o "$obj_plat"
    clang -std=c11 -c "$GUI_ROOT/render/text_macos.c" -o "$obj_text"
    clang $obj_inputs "$modules_out/system_helpers.o" "$obj_stub" "$obj_skia" "$obj_plat" "$obj_text" \
      -framework Cocoa -framework QuartzCore -framework CoreGraphics -framework CoreText -framework CoreFoundation \
      -o "$out"
    ;;
  linux)
    obj_plat="$modules_out/${prog}.x11_app.o"
    "$real_cc" -c "$GUI_ROOT/platform/x11_app.c" -o "$obj_plat"
    "$real_cc" $obj_inputs "$modules_out/system_helpers.o" "$obj_stub" "$obj_skia" "$obj_plat" -lX11 -lXext -o "$out"
    ;;
  windows)
    obj_plat="$modules_out/${prog}.win32_app.o"
    "$real_cc" -c "$GUI_ROOT/platform/win32_app.c" -o "$obj_plat"
    "$real_cc" $obj_inputs "$modules_out/system_helpers.o" "$obj_stub" "$obj_skia" "$obj_plat" -luser32 -lgdi32 -limm32 -o "$out"
    ;;
  *)
    echo "[Error] unsupported platform: $uname_s" 1>&2
    exit 2
    ;;
esac

echo "ok: $out"
