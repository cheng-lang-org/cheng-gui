#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
# Cheng toolchain resolves `cheng/gui/*` modules via CHENG_GUI_ROOT.
export CHENG_GUI_ROOT="$ROOT"

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
  echo "[verify-browser-core] missing CHENG_ROOT" >&2
  exit 2
fi

CHENGC="${CHENGC:-$CHENG_ROOT/src/tooling/chengc.sh}"
if [ ! -x "$CHENGC" ]; then
  echo "[verify-browser-core] missing chengc: $CHENGC" >&2
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
    echo "[verify-browser-core] missing backend driver under CHENG_ROOT=$CHENG_ROOT" >&2
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
  echo "[verify-browser-core] failed to detect host target" >&2
  exit 2
fi

out_dir="$ROOT/build/browser_core_obj"
obj="$out_dir/browser_core_smoke.o"
tmp_obj="$CHENG_ROOT/chengcache/browser_core_smoke.verify.o"
compile_log="$out_dir/browser_core_smoke.compile.log"
mkdir -p "$out_dir"
reuse_core_obj="${CHENG_BROWSER_CORE_REUSE_OBJ:-0}"
if [ "$reuse_core_obj" != "1" ] || [ ! -s "$obj" ]; then
  (
    cd "$CHENG_ROOT"
    CHENG_DEFINES="${CHENG_DEFINES:-macos,macosx}" sh "$CHENGC" "$ROOT/browser_core_smoke_main.cheng" --emit-obj --obj-out:"$tmp_obj" --target:"$target"
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
