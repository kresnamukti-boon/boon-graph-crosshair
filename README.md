# Boon Crosshair

A console-injected (paste-into-DevTools) add-on for the Constructions Tagger **graph**
("Duct Takeoff") duct editor, sibling to `boon-command-line` / `boon-duct-workbench` /
`boon-assembly-duplicate` / etc under `~/Projects/boon-projects/`.

While an elbow style ("Elbow rectangular" / "Elbow round") is **armed** for the route/flex
tool's next click, it draws a crosshair at the cursor whose arms span the armed duct's own real
plan width (rectangular `width_in`, or `diameter_in` for round) in on-screen pixels — instead of
eyeballing the corner against the two duct edges already drawn on the PDF, you can line each arm's
ends up directly on them.

Fully standalone — no coupling to any sibling RW-family add-on, works with or without them pasted
on the same page. Read-only: never clicks, drags, or mutates any annotation state — only observes
the click-menu you already use to pick an elbow style, and reads `window.__graphDebug`'s existing
read-only getters.

## Injection

F12 → Console → paste `console_loader.js` in full → Enter. Paste again after each page
navigation (a same-URL in-page navigation doesn't reload the JS context, so the add-on needs a
real reload or a fresh paste either way).

## Console-facing surface

- `RW._crosshairEnabled = false` — killswitch: stops drawing (and stops observing click-menu
  picks) without needing a page reload. Set back to `true` (the default) to resume.
- `RW._crosshairState()` — the last drawn crosshair's own inputs: `{kind, widthIn, widthCssPx,
  cursorClient, angle}`, or `null` if nothing is currently drawn.
- `RW._crosshairArmState()` — the raw arm-state (`{kind: 'pending'|'continuation', ...}` or
  `null`), for debugging without waiting for the next draw.

## Files & load order

```
src/core/geom.js        pure world<->screen math + duct-width sizing (unit tested, node --test)
src/core/arm-state.js    pure reducer: click-menu picks -> armed/disarmed (unit tested)
src/console/shell.js     impure: DOM listeners, overlay canvas, per-frame draw loop
scripts/build-dist.js    bundles src/core/*.js + shell.js into dist/rw_crosshair.js
build_loader.sh          wraps dist/rw_crosshair.js into console_loader.js (ready-gated, node --checked)
```

Rebuild after editing `src/`: `bash build_loader.sh`. Verify: `node --test test/` (pure core),
`node verify_crosshair.js` (DOM-stub harness against the built `dist/`).

## Boundaries

- **Graph host only.** Does nothing on the annotate-job host (no `window.__graphDebug` there).
- **The armed-style detector is inherently a best-effort shadow, not a direct state read.**
  `window.__graphDebug.route` does not expose `pendingElbowStyle`/`continuationElbowStyle` — this
  add-on infers "armed" from watching the same numbered click-menu (and its digit-key shortcut)
  you use to pick "Elbow rectangular"/"Elbow round" yourself. See `src/core/arm-state.js`'s own
  header for exactly which native flows this mirrors and where it could, in principle, drift from
  native's real internal state on an edge case the tests here don't cover. Live-tested against a
  real page: the click-menu text and this arming both matched exactly as designed (see CLAUDE.md).
- **A page-region's own local scale isn't visible from outside.** Most pages have none; a duct
  drawn inside a scaled sub-region will size the crosshair off the page-wide scale instead of the
  region's own (native itself would use the region's scale here — not reachable from
  `window.__graphDebug`).
- No teardown/uninstall function — reload the page to remove it, same as every sibling add-on in
  this family.
- **Not yet confirmed live: the shell's own per-frame draw loop actually painting in a real,
  focused browser session.** `requestAnimationFrame` doesn't reliably fire against a remote
  browser-bridge tab lacking real OS focus (a known limitation for this whole family, see
  `boon-assembly-duplicate/CLAUDE.md`) — this round's live test confirmed the arming/detection and
  the sizing/positioning math directly (by replicating the same formulas against the real page and
  screenshotting the result: the crosshair centered exactly on the drawn corner, sized to the
  duct's real on-screen width), but couldn't observe the shipped loop itself run in that
  environment. Confirm once pasted in a genuinely-focused real session.
