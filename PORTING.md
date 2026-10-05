# Porting the crosshair into constructions-tagger

## 1. Start here
- What it is: while a duct-drawing tool is active, a red-outlined "+" is drawn at the cursor. Its two bands run off every edge of the canvas and are as thick as the current duct's width on screen, so you can line a corner up against duct edges anywhere on the sheet.
- Code: https://github.com/kresnamukti-boon/boon-graph-crosshair. Port from `master`.
- Today it's pasted into DevTools. Natively it extends the existing duct-width guide circle in `drawCursorOverlayImmediate()`. It isn't a new system.

Native file: `graph-session-entry.js` (project_graph). Line numbers drift, so search by function name. Native references in §2, §3, §8 and Decision A were checked against constructions-tagger main at f023ffcc (2026-10-02). The Ctrl shortcut list in Decision B was checked against a local copy dated 2026-09-25 and has not been re-checked on f023ffcc.

## 2. What ports
- `crosshairOutline(center, thicknessPx, spanPx, diagonal)` in `src/core/geom.js`: returns the 12 corner points of the "+" outline (or the "×" when `diagonal` is true). It has no DOM and no globals.
- Its tests: the two `crosshairOutline` tests in `test/core.test.mjs`.
- Where it goes: `drawCursorOverlayImmediate()`, inside the existing `if (isDrawingTool && frameMetrics)` block that draws the guide circle, on native's own `#cursor-layer`. Everything it needs is already computed there:
  - centre = the `x, y` that function already uses for its own crosshair
  - thickness = `widthPxFrame * (dpr / frameMetrics.pixelRatio)`, the same number as the circle's diameter
  - span = `2 * Math.hypot(width, height)` (the canvas's own size), so the bands always run off-screen
- Then stroke the outline: `#e11d1d`, `lineWidth = 5 * dpr`, `lineJoin = "miter"`, no fill. In thin mode, use a thickness of `2.5 * dpr` and `globalAlpha = 0.25`.
- The add-on draws above native's circle and small crosshair. Whether the circle stays once the bands exist is your call.

## 3. Native already has this, don't port ours
`src/core/geom.js` also contains copies of native math, made only because a pasted script can't call native functions:

| Ours | Use native's instead |
|---|---|
| `spatialToFramePx` | `spatialToFramePx` |
| `framePxToClientPoint`, `spatialToClientPoint` | same names |
| `cssPxPerFootAt` | `framePxPerFootAt` (frame px; divide by `frameMetrics.pixelRatio` for CSS px) |
| `ductWidthInches` | `currentToolProfileWidthInches()` |
| `ductWidthCssPx` | `(widthInches / 12) * pxPerFoot`, as the guide circle already does |

## 4. Never port
These exist only because the add-on is pasted into the console:
- the floating On/Off / Width panel and its saved position (`localStorage` `rw_crosshair_panel_pos`)
- the separate overlay canvas `#rw-crosshair-layer`
- the `requestAnimationFrame` polling loop (native already redraws the cursor layer)
- `window.__RW` and the `RW._crosshair*` console hatches
- `console_loader.js`, `dist/`, `scripts/`, `build_loader.sh`, `verify_crosshair.js`

## 5. Deliberate behaviour (please keep it)
- The bands never turn to follow the duct's direction. There are only two fixed states: "+" (default) and "×" (45°). `crosshairOutline` has no angle parameter on purpose.
- Red outline only, no fill, so the PDF stays visible.
- The 5px red edge is centred on the true duct edge, so the real edge runs through the middle of the red line.
- Thin mode: the band is 2.5px instead of duct width, and the whole outline is drawn at 25% opacity. The edge is still 5px, so it reads as one faint line. It works even with no duct size set.
- Shown for route, flex, extend, transition and branch, from the moment the tool is picked, before the first click. That's the same rule as native's guide circle (no `route.status` check).

## 6. Decisions for Kresna / the engineer
**A. Width source.** The add-on reads `__graphDebug.route.profile`. The guide circle reads `store.currentPageState.inspectorFacts.profile` via `currentToolProfileWidthInches()`. Finding: on f023ffcc, the `__graphDebug.route` getter returns exactly `inspectorFacts?.profile`, so today they are the same value and can't disagree. Please confirm, and decide which one the port should read.

**B. The Ctrl tap that switches "+" and "×".** Rule: press and release Ctrl with nothing in between (no other key, click or wheel), only while a drawing tool is active and not typing in a field. It never calls `preventDefault`. Native already uses Ctrl/Cmd for:
- Select tool: Ctrl/Cmd+click (and the matching hover) reaches a duct side segment past equipment
- Ctrl/Cmd+wheel: zoom
- tool hotkeys and `M` (ruler) are ignored while Ctrl/Cmd is held
- Ctrl/Cmd+D duplicate selected segment, Ctrl/Cmd+A select all visible, Ctrl/Cmd+Z undo (+Shift redo), Ctrl/Cmd+Y redo

Native has no handler for Ctrl pressed on its own. Keep the bare tap, or pick a different key?

**C. Where On/Off and Thin live.** For example a toolbar button or the inspector, like the native command-line toggle.

## 7. Related tickets (cursor area, not this feature)
- MEC-433 (Dwi, Todo): route endpoint pointer position is intermittently inaccurate
- ENG-19816 (Luthfi, Todo): branch and tap-in cursor offset / overlay alignment
- MEC-350 (Done): cursor and crosshair not in sync

No existing ticket asks for a full-canvas crosshair.

## 8. Known limits
- Page regions: the pasted add-on can't see page regions, so inside a scaled region it sizes the bands with the page-wide scale. Native's `framePxPerFootAt(spatialPoint)` already looks up the region itself (via `scaleTransformForSpatialPoint`), and the guide circle uses it. A port that uses native's function gets region-correct widths automatically.
- Size is measured at the raw mouse point, but the crosshair is drawn at the snapped point. This matches the guide circle, so it only matters if a region boundary sits between the two.
- Not live-tested since the red-edge, thin-mode and Ctrl changes. Kresna has only used it by hand.
