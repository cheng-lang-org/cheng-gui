#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
# Cheng toolchain resolves `gui/*` modules via GUI_ROOT.
export GUI_ROOT="$ROOT"

required_files=(
  "$ROOT/kit.cheng"
  "$ROOT/core/component.cheng"
  "$ROOT/render/drawlist_ir.cheng"
  "$ROOT/render/backend_compat.cheng"
  "$ROOT/platform/native_sys_impl.cheng"
  "$ROOT/browser/types.cheng"
  "$ROOT/browser/web.cheng"
  "$ROOT/browser/pdf.cheng"
  "$ROOT/browser/media.cheng"
  "$ROOT/browser_core_smoke_main.cheng"
)

for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "[verify-browser-core] missing file: $file" >&2
    exit 1
  fi
done

if ! rg -q "fn createWebSession\\(request: types.WebPageRequest\\): WebSession" "$ROOT/browser/web.cheng"; then
  echo "[verify-browser-core] missing web session API" >&2
  exit 1
fi
if ! rg -q "fn openPdfDocument\\(request: types.PdfOpenRequest\\): PdfDocument" "$ROOT/browser/pdf.cheng"; then
  echo "[verify-browser-core] missing pdf API" >&2
  exit 1
fi
if ! rg -q "fn createMediaPlayer\\(kind: types.MediaKind, sourceInput: types.MediaSource, optionsInput: types.MediaOptions\\): MediaPlayer" "$ROOT/browser/media.cheng"; then
  echo "[verify-browser-core] missing media API" >&2
  exit 1
fi
if ! rg -q "nkWebView" "$ROOT/core/component.cheng"; then
  echo "[verify-browser-core] missing web node kind" >&2
  exit 1
fi
if ! rg -q "nkPdfView" "$ROOT/core/component.cheng"; then
  echo "[verify-browser-core] missing pdf node kind" >&2
  exit 1
fi
if ! rg -q "nkAudioPlayer" "$ROOT/core/component.cheng"; then
  echo "[verify-browser-core] missing audio node kind" >&2
  exit 1
fi
if ! rg -q "nkVideoPlayer" "$ROOT/core/component.cheng"; then
  echo "[verify-browser-core] missing video node kind" >&2
  exit 1
fi

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
  echo "[verify-browser-core] missing ROOT" >&2
  exit 2
fi

CHENGC="${CHENGC:-$ROOT/src/tooling/chengc.sh}"
if [ ! -x "$CHENGC" ]; then
  echo "[verify-browser-core] missing chengc: $CHENGC" >&2
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
    echo "[verify-browser-core] missing backend driver under ROOT=$ROOT" >&2
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
  echo "[verify-browser-core] failed to detect host target" >&2
  exit 2
fi

out_dir="$ROOT/build/browser_core_obj"
obj="$out_dir/browser_core_smoke.o"
tmp_obj="$ROOT/chengcache/browser_core_smoke.verify.o"
compile_log="$out_dir/browser_core_smoke.compile.log"
mkdir -p "$out_dir"
reuse_core_obj="${BROWSER_CORE_REUSE_OBJ:-0}"
if [ "$reuse_core_obj" != "1" ] || [ ! -s "$obj" ]; then
  (
    cd "$ROOT"
    DEFINES="${DEFINES:-macos,macosx}" sh "$CHENGC" "$ROOT/browser_core_smoke_main.cheng" --emit-obj --obj-out:"$tmp_obj" --target:"$target"
  ) >"$compile_log" 2>&1

  if [ -s "$tmp_obj" ]; then
    cp "$tmp_obj" "$obj"
  fi
fi
if [ ! -s "$obj" ]; then
  echo "[verify-browser-core] missing obj output: $obj" >&2
  sed -n '1,120p' "$compile_log" >&2
  exit 1
fi

echo "[verify-browser-core] ok: $obj"
