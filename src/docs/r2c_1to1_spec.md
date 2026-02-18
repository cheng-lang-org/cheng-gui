# R2C 1:1 Production Spec (V1)

## Scope
- Input scope: React + Vite mainstream projects.
- Compile scope: entry reachable module graph only.
- Hard constraints: zero Node build chain, zero JS VM at runtime.

## Equivalence Contract
- API contract: public browser API signatures stay unchanged.
- Runtime contract: generated runtime symbols are required.
- Verification contract: WPT core gate + project E2E gates.

## Failure Policy
- Unsupported syntax: hard fail with `unsupported_syntax` report entries.
- Unsupported bare import: hard fail with `unsupported_imports` report entries.
- Degraded capability: must be explicit in `degraded_features` report entries.

## Generated Artifacts
- `r2capp/src/entry.cheng`
- `r2capp/src/runtime_generated.cheng`
- `r2capp/src/dom_generated.cheng`
- `r2capp/src/events_generated.cheng`
- `r2capp/src/webapi_generated.cheng`
- `r2capp/r2capp_manifest.json`
- `r2capp/r2capp_compile_report.json`

## Platform Release Gate
- Same version for macOS/Windows/Linux/Android/iOS/Web.
- Any platform gate failure blocks whole release.
