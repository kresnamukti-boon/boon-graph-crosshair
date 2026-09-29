/* Boon Crosshair — console loader.
 * Usage: F12 -> Console -> paste this entire block -> Enter.
 * While an elbow style ("Elbow rectangular"/"Elbow round") is armed for the
 * route/flex tool's next click on the graph ("Duct Takeoff") session, draws a
 * crosshair at the cursor whose arms span the armed duct's own real plan
 * width (rectangular width_in, or diameter_in for round) in screen pixels —
 * so each arm's ends can be lined up on the duct's two already-drawn edges
 * for precise corner placement. Read-only: never clicks, drags, or mutates
 * any annotation state. Does nothing on the annotate-job host. Standalone —
 * no coupling to any sibling RW-family add-on. Paste again after each page
 * navigation. */
(async function(){
  function ready(){
    return document.getElementById('graph-session-root')
        && typeof __graphDebug !== 'undefined';
  }
  for (let i=0; i<60 && !ready(); i++) await new Promise(r=>setTimeout(r,500));
  if (!ready()){ console.warn('[RW] not the graph ("Duct Takeoff") host after 30s — try pasting again once the page renders, or this may simply be the wrong page for this add-on'); return; }

// ===== dist/rw_crosshair.js =====
// ===== src/core/arm-state.js =====
const __m_arm_state = (function(){
// Pure reducer: tracks whether an elbow style is currently ARMED for the
// bend that will form on the route/flex tool's NEXT click, from nothing but
// (a) the checkpoint/continuation click-menu picks the shell observes, and
// (b) a periodic snapshot of window.__graphDebug.route/activeTool.
//
// Why a menu-click observer at all, not a direct state read: confirmed via
// exploration of the local app source copy (construction-tagger-webv2/
// project_graph/js/graph-session-entry.js's own window.__graphDebug.route
// getter, :32336-32355) that route.pendingElbowStyle/continuationElbowStyle/
// elbowStyleOverrides are NOT exposed to a pasted console script — they live
// only in native's own module-private store. The only externally-visible
// trace of "an elbow style was just armed" is the click-menu item the user
// picked (or its numbered-digit-key equivalent) to arm it. This reducer
// mirrors native's own two arming paths (duct-routing-controller.js's
// armPendingElbowStyle/route.continuationElbowStyle; see that file's own
// comments) closely enough for the crosshair's purpose, but is inherently a
// best-effort shadow of state this add-on cannot read directly — verify live
// before trusting an edge case not covered by the tests here (see CLAUDE.md's
// "not live-verified yet" section).
//
// route shape (subset of __graphDebug.route this module reads):
//   { status: 'capturing'|..., mode: 'route'|'flex'|..., vertices: [{x,y,z?}, ...] }

const ELBOW_LABEL_RE = /^\d+\.\s*Elbow (rectangular|round)\b/;
const STRAIGHT_LABEL_RE = /^\d+\.\s*Continue \(straight/;

function isElbowStyleLabel(label) {
  return ELBOW_LABEL_RE.test(String(label ?? '').trim());
}

function isStraightLabel(label) {
  return STRAIGHT_LABEL_RE.test(String(label ?? '').trim());
}

// state is either null (disarmed) or:
//   { kind: 'pending'|'continuation', armedVertexCount: number, armedTool: string }
// 'pending' — a mid-route checkpoint pick (armPendingElbowStyle): one-shot,
//   consumed by the very next appendRouteVertex, so it disarms the instant
//   route.vertices.length changes from armedVertexCount.
// 'continuation' — an open-end "Elbow rectangular/round" pick
//   (armRouteContinuation): standing for the whole run, so it only disarms
//   when the route stops capturing or leaves route/flex mode entirely.
function initialArmState() {
  return null;
}

function reduceArmState(state, event) {
  switch (event.type) {
    case 'menuPick': {
      const { label, route, activeTool } = event;
      const text = String(label ?? '').trim();
      if (isElbowStyleLabel(text)) {
        if (!route || !['route', 'flex'].includes(route.mode)) return state;
        // Picked mid-draw (status already "capturing" from the PREVIOUS
        // click) -> the one-shot pending path. Picked from the open-end
        // menu (route not yet capturing — armRouteContinuation hasn't run
        // yet at the moment of the click handler) -> the standing
        // continuation path.
        const kind = route.status === 'capturing' ? 'pending' : 'continuation';
        return {
          kind,
          armedVertexCount: route.vertices?.length ?? 0,
          armedTool: activeTool ?? route.mode,
        };
      }
      // "Continue (straight)" explicitly clears any pending style
      // (setStraightLocked's own pendingElbowStyle:null, duct-routing-
      // controller.js) and makes a standing continuation moot (every
      // subsequent leg is forced straight until unlocked) — disarm either way.
      if (isStraightLabel(text)) return null;
      // Any OTHER checkpoint item ("Continue as flex", "Reducer /
      // transition", "Unlock (allow turns)") concludes THIS checkpoint
      // without arming a style — a standing 'continuation' survives it
      // (it isn't checkpoint-specific), but a one-shot 'pending' does not.
      return state && state.kind === 'pending' ? null : state;
    }
    case 'routeUpdate': {
      if (!state) return null;
      const { route, activeTool } = event;
      if (!route || route.status !== 'capturing' || !['route', 'flex'].includes(route.mode)) {
        return null;
      }
      if (activeTool && !['route', 'flex'].includes(activeTool)) return null;
      if (state.kind === 'pending' && (route.vertices?.length ?? 0) !== state.armedVertexCount) {
        return null;
      }
      return state;
    }
    case 'escape':
    case 'toolChanged':
    case 'pageChanged':
      return null;
    default:
      return state;
  }
}

return {isElbowStyleLabel, isStraightLabel, initialArmState, reduceArmState};
})();

// ===== src/core/geom.js =====
const __m_geom = (function(){
// Pure, DOM-free geometry: replicates just enough of native's own world<->screen
// math (graph-session-entry.js's spatialToFramePx/framePxToClientPoint/
// framePxPerFootAt, confirmed live/read against the local source copy under
// construction-tagger-webv2/project_graph/js/) to size and orient a crosshair
// at the cursor to the ARMED duct's real plan width, in CSS pixels — without
// ever reaching into native's own module-private state (there is none to
// reach into from a pasted console script; see src/console/shell.js's own
// header).
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

// Screen-space angle (radians, atan2 convention) of the leg the armed elbow
// bends off of — the last placed segment (vertices[len-2] -> vertices[len-1]),
// or the source connector's own direction when only a seed vertex exists yet
// (a fresh continuation). Converted through the SAME world->client mapping as
// the crosshair's own center, so a rotated/flipped page transform still lines
// the crosshair up with the real drawn duct edges, not with raw world axes.
// Returns null when no direction is known yet — callers fall back to an
// axis-aligned (unrotated) crosshair rather than guessing.
function legAngleClient(vertices, startDirection, transform, frameSize, frameRect, pixelRatio) {
  let a = null;
  let b = null;
  if (Array.isArray(vertices) && vertices.length >= 2) {
    a = vertices[vertices.length - 2];
    b = vertices[vertices.length - 1];
  } else if (Array.isArray(vertices) && vertices.length === 1 && startDirection
    && (startDirection.x !== 0 || startDirection.y !== 0)) {
    a = vertices[0];
    b = { x: a.x + startDirection.x, y: a.y + startDirection.y, z: a.z ?? 0 };
  } else {
    return null;
  }
  const pa = spatialToClientPoint(a, transform, frameSize, frameRect, pixelRatio);
  const pb = spatialToClientPoint(b, transform, frameSize, frameRect, pixelRatio);
  if (!pa || !pb) return null;
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  if (dx === 0 && dy === 0) return null;
  return Math.atan2(dy, dx);
}

// The crosshair itself: two perpendicular segments centered on `center`
// (whatever pixel space the caller is drawing in — CSS or canvas-backing —
// as long as widthPx is in the same space), each spanning exactly widthPx —
// so either arm's two ends can be sat directly on the duct's two drawn edge
// lines at the corner. `angleRad` rotates the "across" arm to sit
// perpendicular to the run's own direction (the arm that actually needs to
// land on the two parallel duct walls); axis-aligned (0 rad) when the
// direction isn't known. Both arms are drawn at the same length rather than
// only the perpendicular one, so the guide still reads as a normal crosshair
// (not a single rotated bar) and remains useful even if the direction guess
// is wrong.
function crosshairSegments(center, widthPx, angleRad) {
  const half = widthPx / 2;
  const angle = Number.isFinite(angleRad) ? angleRad : 0;
  const perp = angle + Math.PI / 2;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const vx = Math.cos(perp);
  const vy = Math.sin(perp);
  return {
    half,
    along: {
      a: { x: center.x - ux * half, y: center.y - uy * half },
      b: { x: center.x + ux * half, y: center.y + uy * half },
    },
    across: {
      a: { x: center.x - vx * half, y: center.y - vy * half },
      b: { x: center.x + vx * half, y: center.y + vy * half },
    },
  };
}

return {spatialToFramePx, framePxToClientPoint, spatialToClientPoint, cssPxPerFootAt, ductWidthInches, ductWidthCssPx, legAngleClient, crosshairSegments};
})();

// ===== src/console/shell.js =====
// Boon Crosshair — console shell (impure, never ported). While an elbow
// style is armed for the route/flex tool's NEXT click (see src/core/
// arm-state.js's own header for exactly what "armed" means and why it has to
// be inferred from click-menu picks rather than read directly), draws a
// crosshair at the snapped cursor position whose arms span the armed duct's
// own real plan width in CSS pixels — so the two arm-ends can be sat
// directly on the duct's two already-drawn edge lines when placing a corner.
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
    spatialToClientPoint, cssPxPerFootAt, ductWidthInches, ductWidthCssPx,
    legAngleClient, crosshairSegments,
  } = __m_geom;
  const { isElbowStyleLabel, isStraightLabel, reduceArmState } = __m_arm_state;

  function status(msg) {
    if (RW._commitStatus) RW._commitStatus(msg); else console.log('[RW crosshair] ' + msg);
  }

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
  function clearOverlay() {
    if (overlayCtx && overlayCanvas) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }

  // ----- arm-state wiring -----
  // route/activeTool snapshots are read straight off window.__graphDebug —
  // see arm-state.js's own header for why this shell can't read
  // pendingElbowStyle/continuationElbowStyle directly and has to watch the
  // click-menu instead.
  let armState = null;

  function readRoute() {
    const gd = window.__graphDebug;
    if (!gd) return null;
    try { return gd.route; } catch (e) { return null; }
  }

  function dispatchMenuPick(labelText) {
    const gd = window.__graphDebug;
    const route = readRoute();
    const activeTool = gd ? gd.activeTool : null;
    armState = reduceArmState(armState, { type: 'menuPick', label: labelText, route, activeTool });
  }

  function isClickMenuButton(el) {
    return !!(el && el.tagName === 'BUTTON' && el.closest && el.closest('#graph-click-menu'));
  }

  // Capture phase on window: sees a real click on a numbered click-menu item
  // before the menu's own handler can remove it from the DOM (showClickMenu's
  // runItem, graph-session-entry.js), and runs regardless of whichever
  // sibling add-on's own listeners are also registered on this page.
  window.addEventListener('click', function (event) {
    if (RW._crosshairEnabled === false) return;
    if (!isClickMenuButton(event.target)) return;
    dispatchMenuPick(event.target.textContent);
  }, true);

  // The click-menu also accepts a numbered digit keystroke in place of a
  // click (native's own clickMenuKeydownHandler, graph-session-entry.js) —
  // read the same button's text off the menu's own DOM before native's
  // handler removes the menu, rather than trying to reproduce its own
  // index math independently.
  window.addEventListener('keydown', function (event) {
    if (RW._crosshairEnabled === false) return;
    if (event.key === 'Escape') {
      armState = reduceArmState(armState, { type: 'escape' });
      return;
    }
    const menu = document.getElementById('graph-click-menu');
    if (!menu) return;
    const index = Number(event.key) - 1;
    if (!Number.isInteger(index) || index < 0) return;
    const buttons = menu.querySelectorAll('button');
    const button = buttons && buttons[index];
    if (!button) return;
    dispatchMenuPick(button.textContent);
  }, true);

  // ----- per-frame update + draw -----
  let lastPageId;
  let lastActiveTool;

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

    const angle = legAngleClient(
      route ? route.vertices : null,
      route ? route.startDirection : null,
      transform, frameSize, frameRect, pixelRatio,
    );

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
    const segs = crosshairSegments(centerCanvas, widthCanvasPx, angle);

    RW._crosshairLastState = {
      kind: armState.kind, widthIn: widthIn, widthCssPx: widthCssPx,
      cursorClient: cursorClient, angle: angle,
    };

    const ctx = overlayCtx;
    ctx.save();
    ctx.lineWidth = Math.max(1.5, 1.25 * dpr);
    // Cyan, distinct from native's own orange/teal cursor crosshair
    // (#F36C3D drawing, #1597A7 selecting) so the two are never confused.
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.95)';
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(segs.along.a.x, segs.along.a.y);
    ctx.lineTo(segs.along.b.x, segs.along.b.y);
    ctx.moveTo(segs.across.a.x, segs.across.a.y);
    ctx.lineTo(segs.across.b.x, segs.across.b.y);
    ctx.stroke();
    ctx.restore();
  }

  function tick() {
    RW._crosshairRaf = requestAnimationFrame(tick);
    if (RW._crosshairEnabled === false) { clearOverlay(); return; }
    const gd = window.__graphDebug;
    if (!gd) { clearOverlay(); return; }

    const currentPageId = gd.currentPageId;
    if (currentPageId !== lastPageId) {
      lastPageId = currentPageId;
      armState = reduceArmState(armState, { type: 'pageChanged' });
    }
    const activeTool = gd.activeTool;
    if (activeTool !== lastActiveTool) {
      lastActiveTool = activeTool;
      if (!['route', 'flex'].includes(activeTool)) {
        armState = reduceArmState(armState, { type: 'toolChanged' });
      }
    }

    const route = readRoute();
    armState = reduceArmState(armState, { type: 'routeUpdate', route: route, activeTool: activeTool });

    if (!armState) { clearOverlay(); return; }
    draw(gd, route);
  }
  RW._crosshairRaf = requestAnimationFrame(tick);

  // ----- console-facing hatches -----
  // Killswitch: __RW._crosshairEnabled = false stops drawing (and stops
  // observing menu picks) without needing a page reload.
  if (RW._crosshairEnabled === undefined) RW._crosshairEnabled = true;
  RW._crosshairState = function () { return RW._crosshairLastState || null; };
  RW._crosshairArmState = function () { return armState; };
  RW._crosshairIsElbowLabel = isElbowStyleLabel;
  RW._crosshairIsStraightLabel = isStraightLabel;

  status('crosshair ready — draws a duct-width crosshair at the cursor while an elbow style is armed for the route/flex tool\'s next click');
})()

})()
