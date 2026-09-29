# Boon Crosshair

A console-injected (paste-into-DevTools) add-on for the Constructions Tagger **graph**
("Duct Takeoff") duct editor, sibling to `boon-command-line` / `boon-duct-workbench` /
`boon-assembly-duplicate` / etc under `~/Projects/boon-projects/`.

Whenever a duct-drawing tool is active (route, flex, extend, transition, or branch), it draws a
translucent crosshair at the cursor — two long bands crossing there, each running well past every
edge of the visible canvas (not just a short mark at the cursor), each exactly as thick as the
current duct's own real plan width (rectangular `width_in`, or `diameter_in` for round) in
on-screen pixels, at 20% opacity so the PDF underneath stays visible. Instead of eyeballing a
corner against the two duct edges already drawn on the PDF, you can line the band up against them
anywhere along its length — including well away from the cursor, e.g. against another duct run
elsewhere on the sheet. The crosshair is always screen-axis-aligned — it never rotates to match
the duct's own travel direction.

Fully standalone — no coupling to any sibling RW-family add-on, works with or without them pasted
on the same page, **in either paste order** (confirmed live pasted alongside `boon-command-line`:
shared `window.__RW` namespace, no field collisions). Read-only: never clicks, drags, or mutates
any annotation state — only reads `window.__graphDebug`'s existing read-only getters.

## Injection

F12 → Console → paste `console_loader.js` in full → Enter. Paste again after each page
navigation (a same-URL in-page navigation doesn't reload the JS context, so the add-on needs a
real reload or a fresh paste either way).

## Console-facing surface

- `RW._crosshairEnabled = false` — killswitch: stops drawing without needing a page reload. Set
  back to `true` (the default) to resume.
- `RW._crosshairState()` — the last drawn crosshair's own inputs: `{activeTool, widthIn,
  widthCssPx, cursorClient}`, or `null` if nothing is currently drawn (kept in sync every tick —
  never a stale snapshot from an earlier tool/draw).

## Files & load order

```
src/core/geom.js        pure world<->screen math + duct-width sizing + crosshair geometry (unit tested, node --test)
src/console/shell.js     impure: overlay canvas, per-frame draw loop
scripts/build-dist.js    bundles src/core/*.js + shell.js into dist/rw_crosshair.js
build_loader.sh          wraps dist/rw_crosshair.js into console_loader.js (ready-gated, node --checked)
```

Rebuild after editing `src/`: `bash build_loader.sh`. Verify: `node --test test/` (pure core),
`node verify_crosshair.js` (DOM-stub harness against the built `dist/`).

## Boundaries

- **Graph host only.** Does nothing on the annotate-job host (no `window.__graphDebug` there).
- **A page-region's own local scale isn't visible from outside.** Most pages have none; a duct
  drawn inside a scaled sub-region will size the crosshair off the page-wide scale instead of the
  region's own (native itself would use the region's scale here — not reachable from
  `window.__graphDebug`).
- No teardown/uninstall function — reload the page to remove it, same as every sibling add-on in
  this family.
- **Confirmed live in a real, focused session.** Kresna pasted this on the real page and confirmed
  seeing the crosshair render.
