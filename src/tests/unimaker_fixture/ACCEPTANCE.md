# Unimaker Fixture Acceptance (V1)

This document is the single source of truth for the Unimaker AOT closed-loop
gate. The goal is: zero Node toolchain, zero JS artifacts at runtime, and no
changes to the original project source.

## Must Behave

- First launch shows language selector, and persists to `localStorage`.
- Bottom tab navigation switches visible view content.
- Trading page renders a Canvas-like chart, and mouse move shows a crosshair.
- Publish pages support file selection; `FileReader.readAsDataURL` shows preview.
- Web APIs used by the app have observable behavior:
  - `localStorage`
  - timers (`setInterval`/`setTimeout`)
  - `matchMedia`
  - `ResizeObserver`
  - `navigator.clipboard.writeText`
  - `navigator.geolocation.getCurrentPosition`
  - `document.cookie`
  - drag events (basic reorder interaction)

## Notes

- Pixel-perfect layout is not a V1 requirement; draw commands and snapshot text
  are the primary verification surface.
- External network is not a gate dependency; tests must use local fixtures.

