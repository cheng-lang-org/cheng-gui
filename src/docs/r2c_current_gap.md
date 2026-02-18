# R2C Current Gap (Baseline)

## Confirmed Gaps
- Current runtime behavior still depends on legacy Unimaker state machine for event semantics.
- Generated runtime is now present, but project-specific DOM lowering remains partial.
- WPT gate is currently manifest-driven and not full browser-engine execution yet.

## Removed From Main Path
- Fixed hardcoded entry text injection path from old codegen entry implementation.
- Added generated source set (`runtime/dom/events/webapi`) in compile output.

## Active Remediation Track
- Continue replacing legacy dispatch branches with generated project dispatch logic.
- Expand Tailwind token lowering and Flex layout equivalence.
- Expand WebAPI coverage according to reachable graph + WPT core hits.
