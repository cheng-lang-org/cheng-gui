#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
# Keep engine object verification on stable non-whole-program backend path.
unset CHENG_BACKEND_WHOLE_PROGRAM

required_files=(
  "$ROOT/chromium_engine_smoke_main.cheng"
  "$ROOT/browser/types.cheng"
  "$ROOT/browser/web.cheng"
  "$ROOT/browser/pdf.cheng"
  "$ROOT/browser/media.cheng"
  "$ROOT/browser/engine/dom/model.cheng"
  "$ROOT/browser/engine/html/parser.cheng"
  "$ROOT/browser/engine/css/cascade.cheng"
  "$ROOT/browser/engine/layout/flow.cheng"
  "$ROOT/browser/engine/paint/display_list.cheng"
  "$ROOT/browser/engine/js/runtime.cheng"
  "$ROOT/browser/engine/net/fetcher.cheng"
  "$ROOT/browser/engine/storage/store.cheng"
  "$ROOT/browser/engine/security/policy.cheng"
  "$ROOT/browser/engine/ipc/router.cheng"
  "$ROOT/browser/engine/scheduler/queue.cheng"
  "$ROOT/runtime/process/browser/main.cheng"
  "$ROOT/runtime/process/renderer/main.cheng"
  "$ROOT/runtime/process/gpu/main.cheng"
  "$ROOT/runtime/process/utility/main.cheng"
  "$ROOT/platform/ipc/messages_v2.cheng"
  "$ROOT/platform/ipc/shared_ring.cheng"
  "$ROOT/platform/ipc/serializer.cheng"
  "$ROOT/platform/chromium/macos/host.cheng"
  "$ROOT/platform/chromium/windows/host.cheng"
  "$ROOT/platform/chromium/linux/host.cheng"
  "$ROOT/platform/chromium/android/host.cheng"
  "$ROOT/platform/chromium/ios/host.cheng"
  "$ROOT/platform/chromium/web/host.cheng"
)

for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "[verify-chromium-engine-obj] missing file: $file" >&2
    exit 1
  fi
done

if ! rg -q "fn createBrowserEngine\(config: types.BrowserEngineConfig\): BrowserEngine" "$ROOT/browser/web.cheng"; then
  echo "[verify-chromium-engine-obj] missing createBrowserEngine API" >&2
  exit 1
fi
if ! rg -q "fn createContext\(engine: BrowserEngine, options: types.BrowserContextOptions\): BrowserContext" "$ROOT/browser/web.cheng"; then
  echo "[verify-chromium-engine-obj] missing createContext API" >&2
  exit 1
fi
if ! rg -q "fn createPage\(ctx: BrowserContext, options: types.PageOptions\): BrowserPage" "$ROOT/browser/web.cheng"; then
  echo "[verify-chromium-engine-obj] missing createPage API" >&2
  exit 1
fi
if ! rg -q "fn openPdfInPage\(page: web.BrowserPage, request: types.PdfOpenRequest\): PdfDocument" "$ROOT/browser/pdf.cheng"; then
  echo "[verify-chromium-engine-obj] missing openPdfInPage API" >&2
  exit 1
fi
if ! rg -q "fn attachMediaElement\(page: web.BrowserPage, kind: types.MediaKind, sourceInput: types.MediaSource, optionsInput: types.MediaOptions\): MediaPlayer" "$ROOT/browser/media.cheng"; then
  echo "[verify-chromium-engine-obj] missing attachMediaElement API" >&2
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
  echo "[verify-chromium-engine-obj] missing CHENG_ROOT" >&2
  exit 2
fi

CHENGC="${CHENGC:-$CHENG_ROOT/src/tooling/chengc.sh}"
if [ ! -x "$CHENGC" ]; then
  echo "[verify-chromium-engine-obj] missing chengc: $CHENGC" >&2
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
    echo "[verify-chromium-engine-obj] missing backend driver under CHENG_ROOT=$CHENG_ROOT" >&2
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
  echo "[verify-chromium-engine-obj] failed to detect host target" >&2
  exit 2
fi

out_dir="$ROOT/build/chromium_engine_obj"
obj="$out_dir/chromium_engine_smoke.o"
tmp_obj="$CHENG_ROOT/chengcache/chromium_engine_smoke.verify.o"
compile_log="$out_dir/chromium_engine_smoke.compile.log"
mkdir -p "$out_dir"
reuse_engine_obj="${CHENG_CHROMIUM_ENGINE_REUSE_OBJ:-0}"
if [ "$reuse_engine_obj" != "1" ] || [ ! -s "$obj" ]; then
  (
    cd "$CHENG_ROOT"
    CHENG_DEFINES="${CHENG_DEFINES:-macos,macosx}" sh "$CHENGC" "$ROOT/chromium_engine_smoke_main.cheng" --emit-obj --obj-out:"$tmp_obj" --target:"$target"
  ) >"$compile_log" 2>&1

  if [ -s "$tmp_obj" ]; then
    cp "$tmp_obj" "$obj"
  fi
fi
if [ ! -s "$obj" ]; then
  echo "[verify-chromium-engine-obj] missing obj output: $obj" >&2
  sed -n '1,120p' "$compile_log" >&2
  exit 1
fi

echo "[verify-chromium-engine-obj] ok: $obj"
