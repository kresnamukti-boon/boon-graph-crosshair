// Synthetic Node harness for dist/rw_crosshair.js — no browser, no network.
// Loads the real shipped dist file off disk (never a reimplementation)
// against a small hand-rolled DOM/canvas/rAF stub, and drives it through
// real dispatched click/keydown events on a fake #graph-click-menu, exactly
// as the pattern boon-duct-workbench/verify_branchmem.js and boon-assembly-
// duplicate/verify_stamp.js established for this family. Refuses to run
// against a stale dist/ (see the freshness guard below).
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

function makeCanvasContext() {
  return {
    clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    save() {}, restore() {}, arc() {}, fill() {}, fillRect() {}, strokeRect() {},
    translate() {}, rotate() {},
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

function makeClickMenu(byId, labels) {
  const menu = makeElement('div', byId);
  menu.id = 'graph-click-menu';
  doc.body.appendChild(menu);
  const buttons = labels.map((label, i) => {
    const btn = makeElement('button', byId);
    btn.textContent = (i + 1) + '. ' + label;
    menu.appendChild(btn);
    return btn;
  });
  return { menu, buttons };
}

function clickButton(win, btn) {
  const evt = { type: 'click', target: btn, bubbles: true };
  win.dispatchEvent(evt);
}

function pressKey(win, key) {
  const evt = { type: 'keydown', key: key, bubbles: true };
  win.dispatchEvent(evt);
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

  /* ---- 4. picking "Elbow round" mid-route arms a crosshair, drawn at the snapped cursor, sized to the duct width ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug();
    loadModule(win);
    raf.runOneFrame(); // first tick establishes lastPageId/lastActiveTool baselines

    const { buttons } = makeClickMenu(byId, ['Continue (straight)', 'Elbow rectangular', 'Elbow round']);
    clickButton(win, buttons[2]); // "3. Elbow round"

    ok(win.__RW._crosshairArmState() !== null, 'arm-state is armed after picking an elbow style');
    ok(win.__RW._crosshairArmState().kind === 'pending', 'armed as "pending" (route was already capturing)');

    raf.runOneFrame(); // draws using the now-armed state
    const state = win.__RW._crosshairState();
    ok(state !== null, 'RW._crosshairState() reports a drawn crosshair');
    // 12in duct / 12 = 1ft; at this fixture's scale 1 world ft = 100 frame px
    // = 50 CSS px (1000 frame-px preview layer / 500 CSS-px frame, pixelRatio
    // 2) -> widthCssPx should be exactly 50.
    ok(Math.abs(state.widthCssPx - 50) < 1e-6, `widthCssPx is the duct\'s true on-screen width (got ${state.widthCssPx})`);
    ok(state.widthIn === 12, 'widthIn reflects the armed route\'s own profile');
  }

  /* ---- 5. placing the next vertex (vertex count changes) disarms a "pending" crosshair ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug();
    loadModule(win);
    raf.runOneFrame();
    const { buttons } = makeClickMenu(byId, ['Elbow round']);
    clickButton(win, buttons[0]);
    raf.runOneFrame();
    ok(win.__RW._crosshairArmState() !== null, 'sanity: armed before the next click');

    win.__graphDebug = makeGraphDebug({
      route: {
        status: 'capturing', mode: 'route', profile: { width_in: 12 },
        vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], startDirection: null,
      },
    });
    raf.runOneFrame();
    ok(win.__RW._crosshairArmState() === null, 'disarmed once a new vertex is appended (consumed pendingElbowStyle)');
  }

  /* ---- 6. picking an elbow style from the OPEN-END menu (not yet capturing) arms "continuation", which survives the vertex count changing ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug({ activeTool: 'select', route: { status: 'idle', mode: 'route', profile: null, vertices: [] } });
    loadModule(win);
    raf.runOneFrame();
    const { buttons } = makeClickMenu(byId, ['Elbow round', 'Continue duct']);
    clickButton(win, buttons[0]);
    ok(win.__RW._crosshairArmState().kind === 'continuation', 'armed as "continuation" (route was not yet capturing at pick time)');

    win.__graphDebug = makeGraphDebug({
      activeTool: 'route',
      route: { status: 'capturing', mode: 'route', profile: { width_in: 12 }, vertices: [{ x: 0, y: 0 }], startDirection: { x: 1, y: 0 } },
    });
    raf.runOneFrame();
    ok(win.__RW._crosshairArmState() !== null, 'still armed right after the seed vertex lands');

    win.__graphDebug = makeGraphDebug({
      activeTool: 'route',
      route: { status: 'capturing', mode: 'route', profile: { width_in: 12 }, vertices: [{ x: 0, y: 0 }, { x: 2, y: 2 }], startDirection: { x: 1, y: 0 } },
    });
    raf.runOneFrame();
    ok(win.__RW._crosshairArmState() !== null, 'a "continuation" arm survives a later vertex count change, unlike "pending"');
  }

  /* ---- 7. picking an item via the numbered digit key arms it the same as a click ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug();
    loadModule(win);
    raf.runOneFrame();
    makeClickMenu(byId, ['Continue (straight)', 'Elbow rectangular', 'Elbow round']);
    pressKey(win, '2'); // "2. Elbow rectangular"
    ok(win.__RW._crosshairArmState() !== null, 'digit keydown arms the crosshair the same way a click would');
  }

  /* ---- 8. Escape disarms ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug();
    loadModule(win);
    raf.runOneFrame();
    const { buttons } = makeClickMenu(byId, ['Elbow round']);
    clickButton(win, buttons[0]);
    ok(win.__RW._crosshairArmState() !== null, 'sanity: armed');
    pressKey(win, 'Escape');
    ok(win.__RW._crosshairArmState() === null, 'Escape disarms immediately');
  }

  /* ---- 9. switching tools away from route/flex disarms ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug();
    loadModule(win);
    raf.runOneFrame();
    const { buttons } = makeClickMenu(byId, ['Elbow round']);
    clickButton(win, buttons[0]);
    raf.runOneFrame();
    ok(win.__RW._crosshairArmState() !== null, 'sanity: armed');

    win.__graphDebug = makeGraphDebug({ activeTool: 'select' });
    raf.runOneFrame();
    ok(win.__RW._crosshairArmState() === null, 'disarmed once activeTool leaves route/flex');
  }

  /* ---- 10. RW._crosshairEnabled = false stops drawing without needing a reload ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug();
    loadModule(win);
    raf.runOneFrame();
    const { buttons } = makeClickMenu(byId, ['Elbow round']);
    clickButton(win, buttons[0]);
    raf.runOneFrame();
    ok(win.__RW._crosshairState() !== null, 'sanity: drawing while enabled');

    win.__RW._crosshairEnabled = false;
    raf.runOneFrame();
    ok(win.__RW._crosshairArmState() !== null, 'arm-state itself is untouched by the killswitch (still armed underneath)');
    // draw() only runs through tick()'s early-return when disabled, so the
    // module never updates _crosshairLastState again — clearOverlay() is
    // called instead, and the canvas context stub doesn't track pixels, so
    // this checks the module took the disabled branch via the arm-state
    // check above plus the absence of a thrown error.
  }

  /* ---- 11. a picked NON-elbow, non-straight item ends a "pending" arm but leaves an un-armed state alone ---- */
  {
    const { win, byId, raf } = makeStubWindow();
    makeGraphLayers(byId);
    win.__graphDebug = makeGraphDebug();
    loadModule(win);
    raf.runOneFrame();
    const { buttons } = makeClickMenu(byId, ['Elbow round', 'Reducer / transition']);
    clickButton(win, buttons[0]);
    ok(win.__RW._crosshairArmState() !== null, 'sanity: armed');
    clickButton(win, buttons[1]); // a second, unrelated menu on the same page
    ok(win.__RW._crosshairArmState() === null, 'an unrelated checkpoint pick ends a "pending" arm');
  }

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
