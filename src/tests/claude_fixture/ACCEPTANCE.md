# Claude Fixture Acceptance (V2)

This fixture drives the generic `r2c_aot` compiler gate.

## Must Behave

- AOT compiler runs with zero Node toolchain and emits:
  - `cheng-package.toml`
  - `src/entry.cheng`
  - `r2capp_manifest.json`
  - `r2capp_compile_report.json`
- Runtime mount succeeds through `cheng/r2capp/entry.mount`.
- Snapshot contains language selector text and can advance to home state.
- Tab switch, timer tick, file preview, and trading crosshair interactions are observable.
- Canvas path emits `dcLine` + `dcText` commands in drawlist.
- Unsupported static bare imports fail compilation with report entries.

## Notes

- This fixture can be refreshed from `/Users/lbcheng/UniMaker/ClaudeDesign` using
  `src/scripts/sync_claude_fixture.sh`.
- Dynamic imports and heavy platform features are allowed to degrade, but must not
  crash the app.
