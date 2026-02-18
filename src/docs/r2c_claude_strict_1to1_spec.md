# R2C Claude Strict 1:1 Spec (macOS Blocking)

## Scope
- Project: `/Users/lbcheng/UniMaker/ClaudeDesign`
- Platform blocking: `macOS`
- Build/runtime constraints: `zero-node`, `zero-js-runtime`

## Hard Fail Policy
- Compile must fail when any of the following is non-empty:
  - `unsupported_syntax`
  - `unsupported_imports`
  - `degraded_features`
- Compile must fail when generated runtime matches template fallback signatures.
- `generated_ui_mode` must be `ir-driven`.

## Full-Route Contract
- Compile artifacts are mandatory:
  - `r2c_fullroute_states.json`
  - `r2c_fullroute_event_matrix.json`
  - `r2c_fullroute_coverage_report.json`
- `full_route_state_count` must equal `len(visual_states)`.
- `replay_profile` must be `claude-fullroute`.
- `pixel_tolerance` must be `0`.

## Visual Contract
- Gate script: `src/scripts/verify_claude_fullroute_visual_pixel.sh`
- Baseline provenance script: `src/scripts/verify_claude_chromium_truth_baseline.sh`
- Input states must come from compile artifact `r2c_fullroute_states.json`.
- Event scripts must come from compile artifact `r2c_fullroute_event_matrix.json`.
- Golden source must be locked by `golden/fullroute/chromium_truth_manifest.json` (`source=external-chromium`).
- Pixel check is byte-level RGBA `cmp` with tolerance `0`.
- Frame hash is diagnostic only; RGBA byte mismatch blocks.

## Chromium Parallel Gates
- `src/scripts/verify_chromium_production_closed_loop.sh` must pass.
- `src/scripts/verify_r2c_chromium_equivalence_full.sh` must pass.

## Production Entry
- Single entry: `src/scripts/verify_production_closed_loop.sh`
- Required success markers:
  - `[verify-claude-fullroute-pixel] ok routes=<N>`
  - `[verify-r2c-chromium-equivalence-full] ok`
  - `[verify-production-closed-loop] ok`
