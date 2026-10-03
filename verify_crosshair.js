// Synthetic Node harness for dist/rw_crosshair.js — no browser, no network.
// Loads the real shipped dist file off disk (never a reimplementation)
// against a small hand-rolled DOM/canvas/rAF stub, in this family's
// established hand-rolled-stub style (boon-duct-workbench/verify_branchmem.js,
// boon-assembly-duplicate/verify_stamp.js). Refuses to run against a stale
// dist/ (see the freshness guard below).
'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; console.error('FAIL: ' + name); }
}

/* ---------- freshness guard ---------- */
const DIST_PATH = path.join(__dirname, 'dist/rw_crosshair.js');
const SRC_DIR = path.join(__dirname, 'src');
function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else newest = Math.max(newest, fs.statSync(full).mtimeMs);
  }
  return newest;
}
if (!fs.existsSync(DIST_PATH)) {
  console.error('dist/rw_crosshair.js does not exist — run `bash build_loader.sh` first');
  process.exit(1);
}
if (newestMtime(SRC_DIR) > fs.statSync(DIST_PATH).mtimeMs) {
  console.error('src/ is newer than dist/rw_crosshair.js — run `bash build_loader.sh` first');
  process.exit(1);
}

/* ---------- minimal DOM stub ---------- */

function makeElement(tag, byId) {
  const listeners = {};
  let _id = '';
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    nodeType: 1,
    get id() { return _id; },
    set id(v) {
      if (byId && _id) delete byId[_id];
      _id = v;
      if (byId && v) byId[v] = el;
    },
    value: '',
    textContent: '',
    style: {},
    width: 0,
    height: 0,
    _attrs: {},
    getAttribute(name) { return (name in this._attrs) ? this._attrs[name] : null; },
    setAttribute(name, val) { this._attrs[name] = String(val); },
    hasAttribute(name) { return name in this._attrs; },
    _children: [],
    parentNode: null,
    get isConnected() {
      let node = this;
      while (node) { if (node === doc.body || node === doc) return true; node = node.parentNode; }
      return false;
    },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      this._children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const i = this._children.indexOf(child);
      if (i !== -1) this._children.splice(i, 1);
      child.parentNode = null;
      if (byId && child.id && byId[child.id] === child) delete byId[child.id];
      return child;
    },
    querySelectorAll(selector) {
      const out = [];
      (function walk(node) {
        (node._children || []).forEach((child) => {
          if (matchesSelector(child, selector)) out.push(child);
          walk(child);
        });
      })(el);
      return out;
    },
    closest(selector) {
      let node = el;
      while (node) {
        if (matchesSelector(node, selector)) return node;
        node = node.parentNode;
      }
      return null;
    },
    getBoundingClientRect() {
      return this._rect || { left: 0, top: 0, width: 500, height: 500, right: 500, bottom: 500 };
    },
    getContext() { return this._ctx || (this._ctx = makeCanvasContext()); },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const arr = listeners[type];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    },
    __listeners: listeners,
  };
  el.dispatchEvent = function (evt) {
    if (evt.target == null) Object.defineProperty(evt, 'target', { value: el, configurable: true });
    let node = el;
    while (node) {
      (node.__listeners[evt.type] || []).slice().forEach((fn) => fn(evt));
      node = (evt.bubbles === false) ? null : node.parentNode;
    }
    return true;
  };
  return el;
}

// Records every translate/rotate/fillRect call it receives (`calls`), so a
// test can assert both what got drawn AND — just as importantly here — what
// did NOT: no translate/rotate call at all is the harness-level proof that
// the shell never rotates the crosshair (Kresna's own "make sure it doesnt
// rotate relative to the duct" correction), not just that the pure geom
// function has no angle parameter to misuse.
function makeCanvasContext() {
  const calls = [];
  return {
    _calls: calls,
    clearRect() { calls.push({ op: 'clearRect' }); },
    beginPath() {}, closePath() {}, stroke() {},
    moveTo(x, y) { calls.push({ op: 'moveTo', x, y }); },
    lineTo(x, y) { calls.push({ op: 'lineTo', x, y }); },
    fill() { calls.push({ op: 'fill' }); },
    save() {}, restore() {}, arc() {},
    fillRect(x, y, width, height) { calls.push({ op: 'fillRect', x, y, width, height }); },
    strokeRect() {},
    translate(x, y) { calls.push({ op: 'translate', x, y }); },
    rotate(angle) { calls.push({ op: 'rotate', angle }); },
    setLineDash() {}, measureText() { return { width: 0 }; }, strokeText() {}, fillText() {},
  };
}

function matchesSelector(el, selector) {
  if (selector === 'button') return el.tagName === 'BUTTON';
  if (selector === '#graph-click-menu') return el.id === 'graph-click-menu';
  const idMatch = /^#([\w-]+)$/.exec(selector);
  if (idMatch) return el.id === idMatch[1];
  return false;
}

let doc;
function makeDocument(byId) {
  const body = makeElement('body', byId);
  doc = {
    body,
    documentElement: body,
    getElementById(id) { return byId[id] || null; },
    createElement(tag) { return makeElement(tag, byId); },
    addEventListener() {},
    removeEventListener() {},
  };
  return doc;
}

// A real (bubbling) window-level listener registry, separate from element
// listeners — this module's own capture-phase click/keydown handlers are
// registered on `window`, not on any element, matching the real page.
function makeWindowEventTarget() {
  const listeners = {};
  return {
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const arr = listeners[type];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    },
    dispatchEvent(evt) {
      (listeners[evt.type] || []).slice().forEach((fn) => fn(evt));
      return true;
    },
  };
}

function makeFakeRaf() {
  let queue = [];
  return {
    requestAnimationFrame(fn) { queue.push(fn); return queue.length; },
    // Runs exactly one queued frame's worth of callbacks (each frame may
    // itself schedule the next one, matching the module's own tick()).
    runOneFrame() {
      const batch = queue;
      queue = [];
      batch.forEach((fn) => fn());
    },
  };
}

/* ---------- fixture builders ---------- */

function makeConsoleSpy() {
  const logs = [];
  return {
    log(...args) { logs.push(args.join(' ')); },
    warn(...args) { logs.push(args.join(' ')); },
    error(...args) { logs.push(args.join(' ')); },
    _logs: logs,
  };
}

function makeStubWindow(opts) {
  opts = opts || {};
  const byId = {};
  const doc = makeDocument(byId);
  const winTarget = makeWindowEventTarget();
  const raf = makeFakeRaf();
  const consoleSpy = makeConsoleSpy();
  const win = Object.assign(winTarget, {
    document: doc,
    devicePixelRatio: opts.devicePixelRatio || 1,
    requestAnimationFrame: raf.requestAnimationFrame,
    console: consoleSpy,
  });
  win.__raf = raf;
  win.__console = consoleSpy;
  if (opts.graphHost !== false) {
    const root = makeElement('main', byId);
    root.id = 'graph-session-root';
    doc.body.appendChild(root);
  }
  return { win, byId, doc, raf };
}

// Builds #graph-canvas-stage > #graph-canvas-frame + #preview-layer, sized so
// cssPxPerFootAt/framePxToClientPoint produce round numbers: a 1000x1000
// frame-px preview layer over a 500x500 CSS-px frame (pixelRatio 2), 10 world
// feet spanning the whole page in both axes (so 1 world ft = 100 frame px =
// 50 CSS px).
function makeGraphLayers(byId) {
  const stage = makeElement('div', byId);
  stage.id = 'graph-canvas-stage';
  stage._rect = { left: 0, top: 0, width: 500, height: 500, right: 500, bottom: 500 };
  doc.body.appendChild(stage);

  const frame = makeElement('div', byId);
  frame.id = 'graph-canvas-frame';
  frame._rect = { left: 0, top: 0, width: 500, height: 500, right: 500, bottom: 500 };
  stage.appendChild(frame);

  const previewLayer = makeElement('canvas', byId);
  previewLayer.id = 'preview-layer';
  previewLayer.width = 1000;
  previewLayer.height = 1000;
  frame.appendChild(previewLayer);

  return { stage, frame, previewLayer };
}

function makeGraphDebug(overrides) {
  const base = {
    activeTool: 'route',
    currentPageId: 'page-1',
    pointer: { x: 2, y: 2 },
    transform: { origin: { x: 0, y: 0 }, xAxis: { x: 10, y: 0 }, yAxis: { x: 0, y: 10 } },
    cursorOverlay: { cursorClient: { x: 250, y: 250 } },
    route: {
      status: 'capturing', mode: 'route',
      profile: { width_in: 12 },
      vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }],
      startDirection: null,
    },
  };
  return Object.assign({}, base, overrides);
}

function loadModule(win) {
  const src = fs.readFileSync(DIST_PATH, 'utf8');
  const sandboxGlobals = {
    window: win, document: win.document, console: win.console,
    requestAnimationFrame: win.requestAnimationFrame,
    __graphDebug: win.__graphDebug,
  };
  const fn = new Function(
    ...Object.keys(sandboxGlobals),
    src + '\n//# sourceURL=rw_crosshair.js',
  );
  return fn(...Object.values(sandboxGlobals));
}

/* ---------- tests ---------- */

(function () {
  /* ---- 1. installs and reports ready on the graph host ---- */
  {
    const { win } = makeStubWindow();
    win.__graphDebug = makeGraphDebug();
    loadModule(win);
    ok(win.__RWcrosshairInstalled === true, 'the install-guard flag is set');
    ok(win.__RW.vcrosshair === true, 'the version marker is set on the shared __RW namespace');
    ok(win.__RW._crosshairEnabled === true, 'enabled by default');
    ok(win.__console._logs.some((l) => l.includes('crosshair ready')), 'logs a ready message on a normal graph-host install');
  }

  /* ---- 2. does nothing at all on a non-graph host ---- */
  {
    const { win } = makeStubWindow({ graphHost: false });
    win.__graphDebug = makeGraphDebug();
    loadModule(win);
    ok(win.__RWcrosshairInstalled === true, 'the install-guard flag is still set (set before the host check)');
    ok(win.__RW._crosshairState === undefined, 'nothing else is set up — the module bailed before reaching any of it');
    ok(win.__console._logs.some((l) => l.includes('not the graph')), 'logs that it is not the graph host, instead of the ready message');
  }

  /* ---- 3. re-pasting is a no-op — the ready message is logged once, not twice, and the second paste says so ---- */
  {
    const { win } = makeStubWindow();
    win.__graphDebug = makeGraphDebug();
    loadModule(win);
    win.__console._logs.length = 0;
    loadModule(win);
    ok(win.__console._logs.length === 0, 'a second paste on the same page logs nothing at all (the install guard returns before any log call)');
  }

  /* ---- 4. always active the instant a duct-drawing tool is active (no arming needed), sized to the duct width ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug(); // activeTool: 'route' by default
    loadModule(win);
    raf.runOneFrame(); // draws on the very first tick — nothing to arm first

    const state = win.__RW._crosshairState();
    ok(state !== null, 'RW._crosshairState() reports a drawn crosshair immediately');
    // 12in duct / 12 = 1ft; at this fixture's scale 1 world ft = 100 frame px
    // = 50 CSS px (1000 frame-px preview layer / 500 CSS-px frame, pixelRatio
    // 2) -> widthCssPx should be exactly 50.
    ok(Math.abs(state.widthCssPx - 50) < 1e-6, `widthCssPx is the duct\'s true on-screen width (got ${state.widthCssPx})`);
    ok(state.widthIn === 12, 'widthIn reflects the route\'s own profile');
  }

  /* ---- 5. stays active across every duct-drawing tool native's own guide circle covers (route/flex/extend/transition/branch) ---- */
  {
    for (const tool of ['route', 'flex', 'extend', 'transition', 'branch']) {
      const { win, byId, raf } = makeStubWindow();
      makeGraphLayers(byId);
      win.__graphDebug = makeGraphDebug({ activeTool: tool });
      loadModule(win);
      raf.runOneFrame();
      ok(win.__RW._crosshairState() !== null, `active while activeTool is "${tool}"`);
    }
  }

  /* ---- 6. not active on any OTHER tool, e.g. select ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug({ activeTool: 'select' });
    loadModule(win);
    raf.runOneFrame();
    ok(win.__RW._crosshairState() === null, 'inactive while a non-drawing tool (select) is active');
  }

  /* ---- 7. active even BEFORE the first vertex is placed (route.status "idle", no vertices yet) — matches native's own guide-circle condition, which never gates on status ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug({
      route: { status: 'idle', mode: 'route', profile: { width_in: 12 }, vertices: [], startDirection: null },
    });
    loadModule(win);
    raf.runOneFrame();
    ok(win.__RW._crosshairState() !== null, 'active with an armed tool and a real profile even before any vertex is placed');
  }

  /* ---- 8. no duct size set yet -> nothing drawn ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug({ route: { status: 'idle', mode: 'route', profile: null, vertices: [], startDirection: null } });
    loadModule(win);
    raf.runOneFrame();
    ok(win.__RW._crosshairState() === null, 'nothing drawn without a usable duct width');
  }

  /* ---- 9. switching away from a drawing tool clears the crosshair on the very next tick ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug();
    loadModule(win);
    raf.runOneFrame();
    ok(win.__RW._crosshairState() !== null, 'sanity: drawing while route is active');

    win.__graphDebug = makeGraphDebug({ activeTool: 'select' });
    raf.runOneFrame();
    ok(win.__RW._crosshairState() === null, 'cleared the instant activeTool leaves the drawing-tool set');
  }

  /* ---- 10. RW._crosshairEnabled = false stops drawing without needing a reload ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug();
    loadModule(win);
    raf.runOneFrame();
    ok(win.__RW._crosshairState() !== null, 'sanity: drawing while enabled');
    const ctx = byId['rw-crosshair-layer'].getContext('2d');
    const fillCountWhileEnabled = ctx._calls.filter((c) => c.op === 'fillRect').length;
    ok(fillCountWhileEnabled === 2, 'sanity: exactly 2 band fills happened while enabled');

    win.__RW._crosshairEnabled = false;
    raf.runOneFrame();
    const fillCountAfterDisable = ctx._calls.filter((c) => c.op === 'fillRect').length;
    ok(fillCountAfterDisable === fillCountWhileEnabled, 'no new band is drawn on the tick after disabling');
    ok(ctx._calls.some((c) => c.op === 'clearRect'), 'the overlay is cleared instead');
    ok(win.__RW._crosshairState() === null, 'the debug hatch reports null too, not a stale last-drawn snapshot');
  }

  /* ---- 11. never rotates: no translate/rotate call is EVER made, and both fillRect calls are plain axis-aligned rectangles matching the duct width ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    const { stage } = makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug();
    loadModule(win);
    raf.runOneFrame();

    const overlay = byId['rw-crosshair-layer'];
    ok(!!overlay, 'the overlay canvas was created');
    const ctx = overlay.getContext('2d');
    const rotateOrTranslateCalls = ctx._calls.filter((c) => c.op === 'translate' || c.op === 'rotate');
    ok(rotateOrTranslateCalls.length === 0, 'no translate/rotate call was ever made — the crosshair never rotates');
    const fillRectCalls = ctx._calls.filter((c) => c.op === 'fillRect');
    ok(fillRectCalls.length === 2, 'exactly two fillRect calls (the horizontal and vertical band)');
    // dpr defaults to 1 in this fixture, so canvas px == CSS px: widthCanvasPx
    // should be 50 (same math as test 4), matching one call's thickness on
    // its thin axis (height for the horizontal band, width for the vertical
    // one) — this is a genuinely independent check from RW._crosshairState(),
    // reading what was actually handed to the canvas API.
    const horizontal = fillRectCalls.find((c) => c.width > c.height);
    const vertical = fillRectCalls.find((c) => c.height > c.width);
    ok(!!horizontal && !!vertical, 'one call is wide+short (horizontal band), the other tall+narrow (vertical band)');
    ok(Math.abs(horizontal.height - 50) < 1e-6, `horizontal band thickness matches the duct width (got ${horizontal && horizontal.height})`);
    ok(Math.abs(vertical.width - 50) < 1e-6, `vertical band thickness matches the duct width (got ${vertical && vertical.width})`);
  }

  /* ---- 12. bare Ctrl tap toggles the "×" (45°) state and back; modifiers/other input in between do not ---- */
  {
    const setup = (opts) => {
      const { win, byId, raf } = makeStubWindow();
      makeGraphLayers(byId);
      win.__graphDebug = makeGraphDebug(opts);
      loadModule(win);
      raf.runOneFrame();
      const overlay = byId['rw-crosshair-layer'];
      const ctx = overlay ? overlay.getContext('2d') : { _calls: [] };
      const count = (op) => ctx._calls.filter((c) => c.op === op).length;
      const tap = () => {
        win.dispatchEvent({ type: 'keydown', key: 'Control' });
        win.dispatchEvent({ type: 'keyup', key: 'Control' });
      };
      return { win, raf, ctx, count, tap };
    };

    {
      const { win, raf, ctx, count, tap } = setup();
      ok(win.__RW._crosshairState().diagonal === false, 'starts axis-aligned');
      tap();
      raf.runOneFrame();
      ok(win.__RW._crosshairState().diagonal === true, 'a bare Ctrl tap switches to diagonal');
      ok(count('fillRect') === 2, 'no new fillRect while diagonal');
      ok(count('fill') === 2, 'two polygon fills while diagonal');
      ok(ctx._calls.filter((c) => c.op === 'translate' || c.op === 'rotate').length === 0, 'diagonal mode still never calls translate/rotate');
      tap();
      raf.runOneFrame();
      ok(win.__RW._crosshairState().diagonal === false, 'a second tap returns to axis-aligned');
      ok(count('fillRect') === 4, 'fillRect bands are drawn again');
    }
    {
      const { win, tap } = setup();
      win.dispatchEvent({ type: 'keydown', key: 'Control' });
      win.dispatchEvent({ type: 'keydown', key: 'Control', repeat: true });
      win.dispatchEvent({ type: 'keyup', key: 'Control' });
      ok(win.__RW._crosshairDiagonal === true, 'key auto-repeat keydowns do not break the tap');
    }
    {
      const { win } = setup();
      win.dispatchEvent({ type: 'keydown', key: 'Control' });
      win.dispatchEvent({ type: 'keydown', key: 'z' });
      win.dispatchEvent({ type: 'keyup', key: 'Control' });
      ok(win.__RW._crosshairDiagonal === false, 'Ctrl+Z does not toggle');
    }
    for (const evt of ['wheel', 'pointerdown', 'blur']) {
      const { win } = setup();
      win.dispatchEvent({ type: 'keydown', key: 'Control' });
      win.dispatchEvent({ type: evt });
      win.dispatchEvent({ type: 'keyup', key: 'Control' });
      ok(win.__RW._crosshairDiagonal === false, `Ctrl held through a ${evt} does not toggle`);
    }
    {
      const { win, tap } = setup({ activeTool: 'select' });
      tap();
      ok(win.__RW._crosshairDiagonal === false, 'a Ctrl tap while no drawing tool is active does not toggle');
    }
  }

  /* ---- 13. on-screen panel: on/off button and 1px button ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug();
    loadModule(win);
    raf.runOneFrame();
    const onBtn = byId['rw-crosshair-btn-enabled'];
    const thinBtn = byId['rw-crosshair-btn-thin'];
    ok(!!onBtn && !!thinBtn, 'both panel buttons exist');
    ok(onBtn.textContent === 'Crosshair: On' && thinBtn.textContent === 'Width: Duct', 'initial labels');
    const ctx = byId['rw-crosshair-layer'].getContext('2d');
    const fills = () => ctx._calls.filter((c) => c.op === 'fillRect');

    thinBtn.dispatchEvent({ type: 'click' });
    raf.runOneFrame();
    ok(thinBtn.textContent === 'Width: 1px', 'thin label flips');
    ok(win.__RW._crosshairState().thin === true, 'state reports thin');
    const last2 = fills().slice(-2);
    ok(last2.some((c) => c.height === 1) && last2.some((c) => c.width === 1), 'both bands are 1px thick');

    thinBtn.dispatchEvent({ type: 'click' });
    raf.runOneFrame();
    ok(Math.abs(fills().slice(-2).find((c) => c.width > c.height).height - 50) < 1e-6, 'back to duct width');

    onBtn.dispatchEvent({ type: 'click' });
    const before = fills().length;
    raf.runOneFrame();
    ok(onBtn.textContent === 'Crosshair: Off', 'on/off label flips');
    ok(fills().length === before && win.__RW._crosshairState() === null, 'nothing drawn while off');
    onBtn.dispatchEvent({ type: 'click' });
    raf.runOneFrame();
    ok(win.__RW._crosshairState() !== null, 'drawing again after switching back on');
  }

  /* ---- 14. thin mode needs no duct width ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug({ route: { status: 'idle', mode: 'route', profile: null, vertices: [], startDirection: null } });
    loadModule(win);
    win.__RW._crosshairThin = true;
    raf.runOneFrame();
    ok(win.__RW._crosshairState() !== null, '1px crosshair draws even without a duct profile');
  }

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
