#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

required_files=(
  "$ROOT/kit.cheng"
  "$ROOT/core/component.cheng"
  "$ROOT/runtime/scheduler.cheng"
  "$ROOT/runtime/loop.cheng"
  "$ROOT/layout/layout_tree.cheng"
  "$ROOT/layout/flex_grid.cheng"
  "$ROOT/render/drawlist_ir.cheng"
  "$ROOT/render/backend_compat.cheng"
  "$ROOT/render/compat_kit_bridge.cheng"
  "$ROOT/a11y/semantic.cheng"
  "$ROOT/widgets/v1.cheng"
  "$ROOT/gui_kit_smoke_main.cheng"
  "$ROOT/platform/types_v1.cheng"
  "$ROOT/browser/types.cheng"
  "$ROOT/browser/web.cheng"
  "$ROOT/browser/pdf.cheng"
  "$ROOT/browser/media.cheng"
  "$ROOT/browser_core_smoke_main.cheng"
)

for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "[verify-gui-v1] missing file: $file" >&2
    exit 1
  fi
done

if ! rg -q "fn createApp\(config: AppConfig\): GuiApp" "$ROOT/kit.cheng"; then
  echo "[verify-gui-v1] missing createApp API" >&2
  exit 1
fi
if ! rg -q "fn runApp\(app: GuiApp\)" "$ROOT/kit.cheng"; then
  echo "[verify-gui-v1] missing runApp API" >&2
  exit 1
fi
if ! rg -q "fn shutdownApp\(app: GuiApp\)" "$ROOT/kit.cheng"; then
  echo "[verify-gui-v1] missing shutdownApp API" >&2
  exit 1
fi

if ! rg -q "fn useState\[T\]\(ctx: UiContext, key: str, initial: T\): tuple\[value: T, token: StateToken\]" "$ROOT/core/component.cheng"; then
  echo "[verify-gui-v1] missing generic useState API" >&2
  exit 1
fi

if ! rg -q "geTouchDown" "$ROOT/platform/types_v1.cheng"; then
  echo "[verify-gui-v1] missing touch events" >&2
  exit 1
fi
if ! rg -q "geA11yAction" "$ROOT/platform/types_v1.cheng"; then
  echo "[verify-gui-v1] missing accessibility action events" >&2
  exit 1
fi

echo "[verify-gui-v1] ok"
