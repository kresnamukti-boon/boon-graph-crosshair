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
    legAngleClient, crosshairBands,
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
    // Long enough that a band centered anywhere on the canvas, at ANY
    // rotation, still runs off every edge — twice the canvas's own diagonal
    // is generous headroom over the minimum (one diagonal) that guarantees
    // this from a corner.
    const spanPx = 2 * Math.hypot(width, height);
    const bands = crosshairBands(centerCanvas, widthCanvasPx, angle, spanPx);

    RW._crosshairLastState = {
      kind: armState.kind, widthIn: widthIn, widthCssPx: widthCssPx,
      cursorClient: cursorClient, angle: angle,
    };

    const ctx = overlayCtx;
    ctx.save();
    // Solid (fully opaque) fill, distinct from native's own orange/teal
    // cursor crosshair (#F36C3D drawing, #1597A7 selecting) so the two are
    // never confused — a thin outline keeps the band's edges legible over
    // both light and dark drawing backgrounds, matching native's own
    // white-halo convention on its text labels.
    ctx.fillStyle = 'rgb(6, 182, 212)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = Math.max(1, dpr);
    function drawBand(band) {
      ctx.save();
      ctx.translate(band.cx, band.cy);
      ctx.rotate(band.angle);
      const half = band.thickness / 2;
      ctx.fillRect(-band.length / 2, -half, band.length, band.thickness);
      ctx.strokeRect(-band.length / 2, -half, band.length, band.thickness);
      ctx.restore();
    }
    drawBand(bands.along);
    drawBand(bands.across);
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
