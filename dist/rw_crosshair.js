// ===== src/core/geom.js =====
const __m_geom = (function(){
// Pure, DOM-free geometry: replicates just enough of native's own world<->screen
// math (graph-session-entry.js's spatialToFramePx/framePxToClientPoint/
// framePxPerFootAt, confirmed live/read against the local source copy under
// construction-tagger-webv2/project_graph/js/) to size a crosshair at the
// cursor to the duct's real plan width, in CSS pixels — without ever reaching
// into native's own module-private state (there is none to reach into from a
// pasted console script; see src/console/shell.js's own header).
//
// One real gap vs. native, left deliberate rather than silently "fixed":
// native's own framePxPerFootAt samples a PageRegion's own spatial frame when
// the point sits inside one (scaleTransformForSpatialPoint in the native
// source) — regions aren't exposed on window.__graphDebug, so a point inside
// a region will read this module's page-wide scale instead of the region's
// own. Flagged in README/CLAUDE.md; not fixable without a new native debug
// hook.

// Inverts native's 2x2 (xAxis, yAxis) frame and projects a world spatial
// point into normalized-page fractions, then into frame-resolution pixels —
// same math as spatialToFramePx (graph-session-entry.js:7906-7918).
function spatialToFramePx(pt, transform, frameSize) {
  if (!pt || !transform || !frameSize) return null;
  const { origin, xAxis, yAxis } = transform;
  const det = xAxis.x * yAxis.y - xAxis.y * yAxis.x;
  if (!Number.isFinite(det) || det === 0) return null;
  const dx = pt.x - origin.x;
  const dy = pt.y - origin.y;
  const nx = (dx * yAxis.y - dy * yAxis.x) / det;
  const ny = (dy * xAxis.x - dx * xAxis.y) / det;
  const x = nx * frameSize.width;
  const y = ny * frameSize.height;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

// Frame-resolution pixels -> viewport CLIENT pixels (same space as
// event.clientX/clientY) — same tail as framePxToClientPoint
// (graph-session-entry.js:7933-7941): frameRect.left/top plus framePx scaled
// down by pixelRatio (frame backing-store px per CSS px).
function framePxToClientPoint(framePx, frameRect, pixelRatio) {
  if (!framePx || !frameRect || !Number.isFinite(pixelRatio) || pixelRatio <= 0) return null;
  return {
    x: frameRect.left + framePx.x / pixelRatio,
    y: frameRect.top + framePx.y / pixelRatio,
  };
}

function spatialToClientPoint(pt, transform, frameSize, frameRect, pixelRatio) {
  return framePxToClientPoint(spatialToFramePx(pt, transform, frameSize), frameRect, pixelRatio);
}

// CSS pixels spanned by one foot of world distance at the given spatial
// point, direction-independent (geometric mean of the x- and y-sampled local
// scale) — same formula as framePxPerFootAt (graph-session-entry.js:7876-
// 7904), converted from frame px to CSS px by pixelRatio at the end so the
// result is directly usable against clientX/clientY-space measurements.
function cssPxPerFootAt(spatialPoint, transform, frameSize, frameRect, pixelRatio) {
  if (!spatialPoint || !transform || !frameSize || !Number.isFinite(pixelRatio) || pixelRatio <= 0) return null;
  const origin = spatialToFramePx(spatialPoint, transform, frameSize);
  if (!origin) return null;
  const alongX = spatialToFramePx(
    { x: spatialPoint.x + 1, y: spatialPoint.y, z: spatialPoint.z ?? 0 },
    transform, frameSize,
  );
  const alongY = spatialToFramePx(
    { x: spatialPoint.x, y: spatialPoint.y + 1, z: spatialPoint.z ?? 0 },
    transform, frameSize,
  );
  if (!alongX || !alongY) return null;
  const xScale = Math.hypot(alongX.x - origin.x, alongX.y - origin.y);
  const yScale = Math.hypot(alongY.x - origin.x, alongY.y - origin.y);
  if (!Number.isFinite(xScale) || !(xScale > 0) || !Number.isFinite(yScale) || !(yScale > 0)) return null;
  const framePxPerFoot = Math.sqrt(xScale * yScale);
  if (!Number.isFinite(framePxPerFoot) || framePxPerFoot <= 0) return null;
  const cssPxPerFoot = framePxPerFoot / pixelRatio;
  return Number.isFinite(cssPxPerFoot) && cssPxPerFoot > 0 ? cssPxPerFoot : null;
}

// Same dimension native's own currentToolProfileWidthInches reads
// (graph-session-entry.js:7834-7837) — width_in for rectangular, diameter_in
// for round; whichever one native itself draws as the band's plan width.
function ductWidthInches(profile) {
  if (!profile) return null;
  const w = profile.width_in ?? profile.diameter_in;
  return Number.isFinite(w) && w > 0 ? w : null;
}

function ductWidthCssPx(widthInches, cssPxPerFoot) {
  if (!Number.isFinite(widthInches) || widthInches <= 0) return null;
  if (!Number.isFinite(cssPxPerFoot) || cssPxPerFoot <= 0) return null;
  const px = (widthInches / 12) * cssPxPerFoot;
  return Number.isFinite(px) && px > 0 ? px : null;
}

// The crosshair itself: two perpendicular BANDS (thick lines, not hairlines)
// crossing at `center` (whatever pixel space the caller is drawing in — CSS
// or canvas-backing — as long as thicknessPx/spanPx are in the same space).
// Each band is `thicknessPx` thick (the duct's own true on-screen width) and
// `spanPx` long, centered on `center` — `spanPx` is the CALLER's job to make
// large enough (e.g. the overlay canvas's own diagonal, doubled) that both
// bands visibly run off every edge of the canvas, reading as a full
// alignment guide rather than a small mark at the cursor (Kresna's own
// correction: "a solid crosshair expanding beyond the canvas with the width
// of the duct", replacing an earlier round's small width-length tick-mark
// crosshair).
//
// Deliberately ALWAYS screen-axis-aligned, with no angle input at all
// (Kresna's own explicit follow-up correction: "make sure it doesnt rotate
// relative to the duct", removing an even earlier round's attempt to rotate
// the crosshair to the duct's own travel direction). Not just "the caller
// happens to not pass an angle" — there is no angle parameter to this
// function any more, so a future caller can't accidentally reintroduce
// rotation by passing one. Returns each band as a ready-to-fill rectangle
// (`{x, y, width, height}`, top-left + size — exactly `ctx.fillRect`'s own
// argument order) rather than a center+angle descriptor, since axis-aligned
// rectangles need no `ctx.translate`/`ctx.rotate` at all.
//
// `crosshairBandsDiagonal` below is the ONE other fixed orientation (Kresna's
// round-4 ask: tap Ctrl to turn the "+" into an "×"). It too takes no angle —
// only ever ±45° from the screen axes — so it is a user-toggled second state,
// never duct-following rotation.
function crosshairBands(center, thicknessPx, spanPx) {
  const halfThickness = thicknessPx / 2;
  const halfSpan = spanPx / 2;
  return {
    thickness: thicknessPx,
    horizontal: {
      x: center.x - halfSpan, y: center.y - halfThickness,
      width: spanPx, height: thicknessPx,
    },
    vertical: {
      x: center.x - halfThickness, y: center.y - halfSpan,
      width: thicknessPx, height: spanPx,
    },
  };
}

// The same two bands as crosshairBands, turned 45° (an "×"). Each band is a
// rotated rectangle returned as 4 corner points (in drawing order) ready for
// beginPath/moveTo/lineTo/closePath/fill — no ctx.translate/rotate needed.
// `a` runs along the 45° diagonal (down-right), `b` along 135° (down-left).
// `thicknessPx` is measured perpendicular to each band's own length.
function crosshairBandsDiagonal(center, thicknessPx, spanPx) {
  const h = thicknessPx / 2;
  const s = spanPx / 2;
  const k = Math.SQRT1_2;
  function band(ux, uy) {
    const px = -uy;
    const py = ux;
    const at = (along, across) => ({
      x: center.x + ux * along * k + px * across * k,
      y: center.y + uy * along * k + py * across * k,
    });
    return [at(-s, -h), at(s, -h), at(s, h), at(-s, h)];
  }
  return { thickness: thicknessPx, a: band(1, 1), b: band(1, -1) };
}

return {spatialToFramePx, framePxToClientPoint, spatialToClientPoint, cssPxPerFootAt, ductWidthInches, ductWidthCssPx, crosshairBands, crosshairBandsDiagonal};
})();

// ===== src/console/shell.js =====
// Boon Crosshair — console shell (impure, never ported). Whenever a
// duct-drawing tool is active (route/flex/extend/transition/branch — the
// exact same trigger native's own size-following guide circle uses, see
// "always active" below), draws a translucent, screen-axis-aligned crosshair
// at the snapped cursor position whose bands are as thick as the current
// duct's real plan width in CSS pixels — so the bands can be lined up
// against the duct's already-drawn edges anywhere on the sheet, not just
// right at the cursor.
//
// Read-only and non-invasive: never touches store/commandJournal, never
// synthesizes a click or drag, draws on its OWN overlay canvas (never
// #cursor-layer, which native repaints and clears every frame on its own —
// see draw()'s own comment). Graph ("Duct Takeoff") host only.
(function () {
  if (window.__RWcrosshairInstalled) return 'crosshair already installed';
  window.__RWcrosshairInstalled = true;
  const RW = window.__RW = window.__RW || {};
  RW.vcrosshair = true;

  const IS_GRAPH_HOST = window.__RWhost
    ? window.__RWhost.id === 'graph'
    : !!document.getElementById('graph-session-root');
  if (!IS_GRAPH_HOST) {
    console.log('[RW] crosshair: not the graph ("Duct Takeoff") host — nothing to do here');
    return 'not the graph host';
  }

  // Destructured from the __m_<basename> vars scripts/build-dist.js wraps
  // each src/core/ module into (see that file's own header for the
  // mechanism) — shell.js is appended verbatim, so it must pull these out
  // itself, the same way boon-assembly-duplicate's own shell.js does.
  const {
    cssPxPerFootAt, ductWidthInches, ductWidthCssPx, crosshairBands, crosshairBandsDiagonal,
  } = __m_geom;

  function status(msg) {
    if (RW._commitStatus) RW._commitStatus(msg); else console.log('[RW crosshair] ' + msg);
  }

  // "Always active when drawing duct": the same activeTool set native's own
  // size-following guide circle gates on (drawCursorOverlayImmediate's own
  // `drawingTools` array, graph-session-entry.js) — route/flex/extend/
  // transition/branch. Not gated on route.status at all (matching native's
  // own condition exactly), so the crosshair is already visible before the
  // very first click of a run, not just mid-draw.
  const DRAWING_TOOLS = ['route', 'flex', 'extend', 'transition', 'branch'];

  // ----- overlay layer -----
  // Its own canvas, appended to #graph-canvas-stage (the same ancestor
  // native's #cursor-layer lives on) — NOT drawn onto #cursor-layer itself,
  // which native fully clears and repaints from scratch every animation
  // frame (drawCursorOverlayImmediate, graph-session-entry.js) with no hook
  // for a third party to add to that pass. pointer-events:none so it never
  // intercepts a real click/drag meant for the canvas beneath it.
  let overlayCanvas = null;
  let overlayCtx = null;
  function ensureOverlay() {
    const stage = document.getElementById('graph-canvas-stage');
    if (!stage) return null;
    if (overlayCanvas && overlayCanvas.isConnected) return overlayCanvas;
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'rw-crosshair-layer';
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.inset = '0';
    overlayCanvas.style.pointerEvents = 'none';
    // Above native's own #cursor-layer (and its guide circle/crosshair), so
    // this crosshair is never hidden behind them.
    overlayCanvas.style.zIndex = '2147483000';
    stage.style.position = stage.style.position || 'relative';
    stage.appendChild(overlayCanvas);
    overlayCtx = overlayCanvas.getContext('2d');
    return overlayCanvas;
  }
  // Every bail path (nothing to draw right now, for whatever reason) routes
  // through here — also resets RW._crosshairLastState to null, so the
  // console debug hatch can never report a stale "last drawn" snapshot from
  // several ticks ago while nothing is actually on screen (the same class of
  // staleness bug native's own route.vertices/mode/context caused for ITS
  // cursor overlay, per graph-session-entry.js's own comment on that fix).
  function clearOverlay() {
    if (overlayCtx && overlayCanvas) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    RW._crosshairLastState = null;
  }

  // ----- per-frame update + draw -----
  function draw(gd, route) {
    const stage = document.getElementById('graph-canvas-stage');
    const frame = document.getElementById('graph-canvas-frame');
    const previewLayer = document.getElementById('preview-layer');
    const cursorOverlay = gd.cursorOverlay;
    const cursorClient = cursorOverlay && cursorOverlay.cursorClient;
    if (!stage || !frame || !previewLayer || !cursorClient) { clearOverlay(); return; }

    const profile = route ? route.profile : null;
    const widthIn = ductWidthInches(profile);
    if (!widthIn) { clearOverlay(); return; }

    const transform = gd.transform;
    const frameRect = frame.getBoundingClientRect();
    const pixelRatio = frameRect.width ? (previewLayer.width / frameRect.width) : null;
    const frameSize = { width: previewLayer.width, height: previewLayer.height };
    const spatialPoint = gd.pointer;
    const cssPxPerFoot = cssPxPerFootAt(spatialPoint, transform, frameSize, frameRect, pixelRatio);
    const widthCssPx = ductWidthCssPx(widthIn, cssPxPerFoot);
    if (!widthCssPx) { clearOverlay(); return; }

    const canvas = ensureOverlay();
    if (!canvas) return;
    const stageRect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(stageRect.width * dpr));
    const height = Math.max(1, Math.round(stageRect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    overlayCtx.clearRect(0, 0, width, height);

    const centerCanvas = {
      x: (cursorClient.x - stageRect.left) * dpr,
      y: (cursorClient.y - stageRect.top) * dpr,
    };
    const widthCanvasPx = widthCssPx * dpr;
    // Long enough that a band centered ANYWHERE on the canvas still runs off
    // every edge — twice the canvas's own diagonal is generous headroom over
    // the minimum (one diagonal) that guarantees this from a corner.
    const spanPx = 2 * Math.hypot(width, height);
    const diagonal = !!RW._crosshairDiagonal;

    RW._crosshairLastState = {
      activeTool: gd.activeTool, widthIn: widthIn, widthCssPx: widthCssPx,
      cursorClient: cursorClient, diagonal: diagonal,
    };

    const ctx = overlayCtx;
    ctx.save();
    // 20% opacity (Kresna's own request) — reads as a light tint over the
    // drawing rather than an opaque bar, so the PDF linework underneath
    // stays visible through it. Distinct hue from native's own orange/teal
    // cursor crosshair (#F36C3D drawing, #1597A7 selecting) so the two are
    // never confused. Screen-axis-aligned rectangles (see crosshairBands's
    // own header) — no rotation, no translate/rotate needed.
    ctx.fillStyle = 'rgba(6, 182, 212, 0.2)';
    if (diagonal) {
      // Ctrl-toggled "×" state: two 45° polygons, filled as one path per band
      // (still no ctx.translate/rotate).
      const d = crosshairBandsDiagonal(centerCanvas, widthCanvasPx, spanPx);
      [d.a, d.b].forEach((pts) => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fill();
      });
    } else {
      const bands = crosshairBands(centerCanvas, widthCanvasPx, spanPx);
      ctx.fillRect(bands.horizontal.x, bands.horizontal.y, bands.horizontal.width, bands.horizontal.height);
      ctx.fillRect(bands.vertical.x, bands.vertical.y, bands.vertical.width, bands.vertical.height);
    }
    ctx.restore();
  }

  function tick() {
    RW._crosshairRaf = requestAnimationFrame(tick);
    if (RW._crosshairEnabled === false) { clearOverlay(); return; }
    const gd = window.__graphDebug;
    if (!gd) { clearOverlay(); return; }

    if (!DRAWING_TOOLS.includes(gd.activeTool)) { clearOverlay(); return; }

    let route = null;
    try { route = gd.route; } catch (e) { route = null; }
    draw(gd, route);
  }
  RW._crosshairRaf = requestAnimationFrame(tick);

  // ----- bare-Ctrl tap toggles "+" <-> "×" -----
  // Ctrl is also a modifier natively (Ctrl+wheel zoom, Ctrl+Z/Y/D/A, Ctrl+
  // click), so only a Ctrl press-and-release with nothing in between counts.
  // Never preventDefault — native's own Ctrl shortcuts stay untouched.
  if (RW._crosshairDiagonal === undefined) RW._crosshairDiagonal = false;
  let ctrlArmed = false;
  function typingInField() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = String(el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
  }
  function drawingToolActive() {
    const gd = window.__graphDebug;
    return !!gd && DRAWING_TOOLS.includes(gd.activeTool);
  }
  function disarm() { ctrlArmed = false; }
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Control') {
      if (!e.repeat) ctrlArmed = !typingInField() && drawingToolActive();
    } else {
      disarm();
    }
  }, true);
  window.addEventListener('keyup', function (e) {
    if (e.key !== 'Control') return;
    if (ctrlArmed) RW._crosshairDiagonal = !RW._crosshairDiagonal;
    ctrlArmed = false;
  }, true);
  window.addEventListener('pointerdown', disarm, true);
  window.addEventListener('wheel', disarm, true);
  window.addEventListener('blur', disarm);

  // ----- console-facing hatches -----
  // Killswitch: __RW._crosshairEnabled = false stops drawing without needing
  // a page reload.
  if (RW._crosshairEnabled === undefined) RW._crosshairEnabled = true;
  RW._crosshairState = function () { return RW._crosshairLastState || null; };

  status('crosshair ready — draws a duct-width crosshair at the cursor whenever a duct-drawing tool is active (tap Ctrl to toggle 45°)');
})()
