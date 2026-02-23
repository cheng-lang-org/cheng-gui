# Strict Realtime 1:1 Gate

This repository enforces a single strict realtime gate before compile/interactive entry points can run.

## Hard Rules

- 1:1 gate definition is fixed to:
  - compile `/Users/lbcheng/UniMaker/ClaudeDesign` with entry `/app/main.tsx`
  - pass full-route 1:1 render+interaction pixel gate (`routes=30`, `pixel_tolerance=0`)
- Pixel comparison uses fixed golden files under `src/tests/claude_fixture/golden/fullroute`.
- Golden must include Chromium truth manifest: `src/tests/claude_fixture/golden/fullroute/chromium_truth_manifest.json`.
- Pixel tolerance is always `0`.
- `precomputed`, `compile-only`, runtime/object reuse shortcuts, and bless-in-gate are forbidden.
- Fallback paths are forbidden (`legacy`/stub fallback must remain disabled).
- Strict route matrix count is fixed to `30` and must be verified in a single-window batch run.

## Strict Gate Entry

- Script: `src/scripts/verify_strict_realtime_1to1_gate.sh`
- This script runs:
  - `verify_r2c_real_project_closed_loop.sh`
- `verify_claude_fullroute_visual_pixel.sh`
- `verify_claude_chromium_truth_baseline.sh`
- `verify_chromium_production_closed_loop.sh`
- `verify_r2c_chromium_equivalence_full.sh`

## Success Marker Contract

- File: `src/build/strict_realtime_gate/claude_strict_gate.ok.json`
- Required keys:
  - `git_head`
  - `generated_at_epoch`
  - `project`
  - `entry`
  - `strict_flags`
  - `golden_hash_manifest`
  - `routes`
  - `pixel_tolerance`

The marker is written only when strict gate fully passes. Any failure leaves no marker.

## Compile/Interactive Block

- `src/scripts/r2c_compile_react_project.sh`
- `src/scripts/run_claude_desktop_1to1.sh`

Both scripts require a valid strict marker matching current `git_head`, `project`, `entry`, `routes=30`, and `pixel_tolerance=0`.
Only gate-internal runs may bypass this check via `STRICT_GATE_CONTEXT=1`.
