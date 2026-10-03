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

    // Thin mode (panel button) draws a 1px line, so it needs no duct width.
    const thin = !!RW._crosshairThin;
    const profile = route ? route.profile : null;
    const widthIn = ductWidthInches(profile);
    if (!widthIn && !thin) { clearOverlay(); return; }

    const transform = gd.transform;
    const frameRect = frame.getBoundingClientRect();
    const pixelRatio = frameRect.width ? (previewLayer.width / frameRect.width) : null;
    const frameSize = { width: previewLayer.width, height: previewLayer.height };
    const spatialPoint = gd.pointer;
    const cssPxPerFoot = cssPxPerFootAt(spatialPoint, transform, frameSize, frameRect, pixelRatio);
    const widthCssPx = thin ? 1 : ductWidthCssPx(widthIn, cssPxPerFoot);
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
      cursorClient: cursorClient, diagonal: diagonal, thin: thin,
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

  // ----- on-screen toggle panel -----
  // Two buttons: crosshair on/off (RW._crosshairEnabled) and duct-width vs
  // 1px line (RW._crosshairThin). Labels re-sync every tick so console
  // changes to either flag show up too.
  if (RW._crosshairThin === undefined) RW._crosshairThin = false;
  let panelEl = null;
  let enabledBtn = null;
  let thinBtn = null;
  function makeButton(onClick) {
    const b = document.createElement('button');
    b.id = 'rw-crosshair-btn-' + (enabledBtn ? 'thin' : 'enabled');
    b.style.cssText = 'font:12px system-ui,sans-serif;padding:4px 8px;cursor:pointer;'
      + 'border:1px solid #06b6d4;border-radius:4px;background:#fff;color:#0e7490;';
    b.addEventListener('click', onClick);
    panelEl.appendChild(b);
    return b;
  }
  // Draggable (grip on the left) because the native toolbar layout isn't
  // reachable from here — the user moves it off whatever it covers. Position
  // is remembered in localStorage (best effort, never required).
  const POS_KEY = 'rw_crosshair_panel_pos';
  function loadPos() {
    try {
      const v = JSON.parse(window.localStorage.getItem(POS_KEY));
      if (v && Number.isFinite(v.left) && Number.isFinite(v.top)) return v;
    } catch (e) { /* ignore */ }
    return null;
  }
  function savePos(left, top) {
    try { window.localStorage.setItem(POS_KEY, JSON.stringify({ left: left, top: top })); } catch (e) { /* ignore */ }
  }
  function placePanel(left, top) {
    const vw = window.innerWidth || 1000;
    const vh = window.innerHeight || 800;
    const l = Math.min(Math.max(0, left), Math.max(0, vw - 40));
    const t = Math.min(Math.max(0, top), Math.max(0, vh - 24));
    panelEl.style.left = l + 'px';
    panelEl.style.top = t + 'px';
    panelEl.style.bottom = 'auto';
    return { left: l, top: t };
  }
  function makeGrip() {
    const g = document.createElement('div');
    g.id = 'rw-crosshair-grip';
    g.textContent = '\u2630';
    g.style.cssText = 'font:12px system-ui,sans-serif;padding:4px 6px;cursor:move;user-select:none;'
      + 'border:1px solid #06b6d4;border-radius:4px;background:#fff;color:#0e7490;';
    let drag = null;
    g.addEventListener('pointerdown', function (e) {
      const r = panelEl.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      e.preventDefault();
    });
    window.addEventListener('pointermove', function (e) {
      if (drag) placePanel(e.clientX - drag.dx, e.clientY - drag.dy);
    });
    window.addEventListener('pointerup', function () {
      if (!drag) return;
      drag = null;
      const r = panelEl.getBoundingClientRect();
      savePos(r.left, r.top);
    });
    panelEl.appendChild(g);
  }
  function ensurePanel() {
    if (panelEl && panelEl.isConnected) return;
    panelEl = document.createElement('div');
    panelEl.id = 'rw-crosshair-panel';
    panelEl.style.cssText = 'position:fixed;z-index:2147483001;display:flex;gap:6px;';
    document.body.appendChild(panelEl);
    // Default: bottom-centre; a saved position (if any) wins.
    const saved = loadPos();
    if (saved) placePanel(saved.left, saved.top);
    else { panelEl.style.left = '50%'; panelEl.style.bottom = '12px'; }
    makeGrip();
    enabledBtn = null; thinBtn = null;
    enabledBtn = makeButton(function () { RW._crosshairEnabled = RW._crosshairEnabled === false; });
    thinBtn = makeButton(function () { RW._crosshairThin = !RW._crosshairThin; });
  }
  function syncPanel() {
    ensurePanel();
    const on = RW._crosshairEnabled !== false;
    const enabledText = 'Crosshair: ' + (on ? 'On' : 'Off');
    const thinText = 'Width: ' + (RW._crosshairThin ? '1px' : 'Duct');
    if (enabledBtn.textContent !== enabledText) enabledBtn.textContent = enabledText;
    if (thinBtn.textContent !== thinText) thinBtn.textContent = thinText;
  }

  function tick() {
    RW._crosshairRaf = requestAnimationFrame(tick);
    syncPanel();
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

  status('crosshair ready — draws a duct-width crosshair at the cursor whenever a duct-drawing tool is active (tap Ctrl to toggle 45°; draggable panel for on/off and 1px)');
})()
