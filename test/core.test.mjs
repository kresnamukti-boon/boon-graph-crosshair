// Pure unit tests for src/core/ — no DOM, no browser, real node:test/assert.
// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  spatialToFramePx, framePxToClientPoint, spatialToClientPoint,
  cssPxPerFootAt, ductWidthInches, ductWidthCssPx, legAngleClient,
  crosshairBands,
} from '../src/core/geom.js';
import {
  isElbowStyleLabel, isStraightLabel, reduceArmState,
} from '../src/core/arm-state.js';

// An identity-ish transform: origin at world (0,0), x/y axes span 10 world
// feet across the whole normalized page (0..1), frame is 1000x1000px, a
// frameRect of {left:0,top:0,width:500,height:500} (pixelRatio 2, i.e. a
// 2x backing store over a 500 CSS-px viewport) — round numbers throughout so
// expected values are easy to hand-check.
const TRANSFORM = { origin: { x: 0, y: 0 }, xAxis: { x: 10, y: 0 }, yAxis: { x: 0, y: 10 } };
const FRAME_SIZE = { width: 1000, height: 1000 };
const FRAME_RECT = { left: 0, top: 0, width: 500, height: 500 };
const PIXEL_RATIO = 2;

test('spatialToFramePx maps world origin to frame origin', () => {
  const p = spatialToFramePx({ x: 0, y: 0 }, TRANSFORM, FRAME_SIZE);
  assert.deepEqual(p, { x: 0, y: 0 });
});

test('spatialToFramePx maps a world point proportionally through the axes', () => {
  // (5,5) world is halfway along both a 10-unit axis -> normalized (0.5,0.5)
  // -> frame (500,500)
  const p = spatialToFramePx({ x: 5, y: 5 }, TRANSFORM, FRAME_SIZE);
  assert.deepEqual(p, { x: 500, y: 500 });
});

test('spatialToFramePx returns null on a singular (zero-determinant) transform', () => {
  const singular = { origin: { x: 0, y: 0 }, xAxis: { x: 1, y: 1 }, yAxis: { x: 2, y: 2 } };
  assert.equal(spatialToFramePx({ x: 1, y: 1 }, singular, FRAME_SIZE), null);
});

test('spatialToFramePx returns null on missing inputs', () => {
  assert.equal(spatialToFramePx(null, TRANSFORM, FRAME_SIZE), null);
  assert.equal(spatialToFramePx({ x: 1, y: 1 }, null, FRAME_SIZE), null);
  assert.equal(spatialToFramePx({ x: 1, y: 1 }, TRANSFORM, null), null);
});

test('framePxToClientPoint scales by pixelRatio and offsets by frameRect', () => {
  const p = framePxToClientPoint({ x: 500, y: 500 }, FRAME_RECT, PIXEL_RATIO);
  assert.deepEqual(p, { x: 250, y: 250 });
});

test('framePxToClientPoint honors a non-zero frameRect origin', () => {
  const rect = { left: 100, top: 50, width: 500, height: 500 };
  const p = framePxToClientPoint({ x: 500, y: 500 }, rect, PIXEL_RATIO);
  assert.deepEqual(p, { x: 350, y: 300 });
});

test('framePxToClientPoint returns null without a usable pixelRatio', () => {
  assert.equal(framePxToClientPoint({ x: 1, y: 1 }, FRAME_RECT, 0), null);
  assert.equal(framePxToClientPoint({ x: 1, y: 1 }, FRAME_RECT, null), null);
});

test('spatialToClientPoint chains both steps', () => {
  const p = spatialToClientPoint({ x: 5, y: 5 }, TRANSFORM, FRAME_SIZE, FRAME_RECT, PIXEL_RATIO);
  assert.deepEqual(p, { x: 250, y: 250 });
});

test('cssPxPerFootAt: 10 world feet per axis -> 1000 frame px -> 500 CSS px, so 50 CSS px/ft', () => {
  const scale = cssPxPerFootAt({ x: 5, y: 5 }, TRANSFORM, FRAME_SIZE, FRAME_RECT, PIXEL_RATIO);
  assert.ok(Math.abs(scale - 50) < 1e-9, `expected ~50, got ${scale}`);
});

test('cssPxPerFootAt returns null on a degenerate (zero-scale) transform', () => {
  const degenerate = { origin: { x: 0, y: 0 }, xAxis: { x: 0, y: 0 }, yAxis: { x: 0, y: 10 } };
  assert.equal(cssPxPerFootAt({ x: 1, y: 1 }, degenerate, FRAME_SIZE, FRAME_RECT, PIXEL_RATIO), null);
});

test('ductWidthInches prefers width_in over diameter_in (rectangular wins if both present)', () => {
  assert.equal(ductWidthInches({ width_in: 12, diameter_in: 8 }), 12);
});

test('ductWidthInches falls back to diameter_in for round profiles', () => {
  assert.equal(ductWidthInches({ diameter_in: 10 }), 10);
});

test('ductWidthInches returns null for a missing/zero/negative width', () => {
  assert.equal(ductWidthInches(null), null);
  assert.equal(ductWidthInches({}), null);
  assert.equal(ductWidthInches({ width_in: 0 }), null);
  assert.equal(ductWidthInches({ width_in: -4 }), null);
});

test('ductWidthCssPx converts inches to CSS px at the given scale', () => {
  // 12in duct at 50 CSS px/ft -> 1ft * 50 = 50px
  assert.equal(ductWidthCssPx(12, 50), 50);
  // 6in -> 0.5ft -> 25px
  assert.equal(ductWidthCssPx(6, 50), 25);
});

test('ductWidthCssPx returns null for invalid width or scale', () => {
  assert.equal(ductWidthCssPx(0, 50), null);
  assert.equal(ductWidthCssPx(12, 0), null);
  assert.equal(ductWidthCssPx(12, null), null);
});

test('legAngleClient reads the direction of the last placed segment', () => {
  // vertices along +x world axis -> screen +x too (identity-ish transform,
  // no flip) -> angle 0
  const vertices = [{ x: 0, y: 0 }, { x: 5, y: 0 }];
  const angle = legAngleClient(vertices, null, TRANSFORM, FRAME_SIZE, FRAME_RECT, PIXEL_RATIO);
  assert.ok(Math.abs(angle - 0) < 1e-9);
});

test('legAngleClient reads a +y world segment as a screen-space downward angle', () => {
  const vertices = [{ x: 0, y: 0 }, { x: 0, y: 5 }];
  const angle = legAngleClient(vertices, null, TRANSFORM, FRAME_SIZE, FRAME_RECT, PIXEL_RATIO);
  assert.ok(Math.abs(angle - Math.PI / 2) < 1e-9);
});

test('legAngleClient falls back to startDirection with only a seed vertex', () => {
  const vertices = [{ x: 0, y: 0 }];
  const angle = legAngleClient(vertices, { x: 1, y: 0 }, TRANSFORM, FRAME_SIZE, FRAME_RECT, PIXEL_RATIO);
  assert.ok(Math.abs(angle - 0) < 1e-9);
});

test('legAngleClient returns null with no direction to read at all', () => {
  assert.equal(legAngleClient([{ x: 0, y: 0 }], null, TRANSFORM, FRAME_SIZE, FRAME_RECT, PIXEL_RATIO), null);
  assert.equal(legAngleClient([], null, TRANSFORM, FRAME_SIZE, FRAME_RECT, PIXEL_RATIO), null);
  assert.equal(legAngleClient(null, null, TRANSFORM, FRAME_SIZE, FRAME_RECT, PIXEL_RATIO), null);
});

test('legAngleClient returns null for a degenerate (zero-length) segment', () => {
  const vertices = [{ x: 3, y: 3 }, { x: 3, y: 3 }];
  assert.equal(legAngleClient(vertices, null, TRANSFORM, FRAME_SIZE, FRAME_RECT, PIXEL_RATIO), null);
});

test('crosshairBands: both bands are centered on the given point, at the given thickness and span length', () => {
  const bands = crosshairBands({ x: 100, y: 100 }, 20, 0, 5000);
  assert.equal(bands.thickness, 20);
  for (const band of [bands.along, bands.across]) {
    assert.equal(band.cx, 100);
    assert.equal(band.cy, 100);
    assert.equal(band.thickness, 20);
    assert.equal(band.length, 5000);
  }
});

test('crosshairBands: "across" is perpendicular to "along" (90 degrees apart) at any angle', () => {
  for (const angle of [0, 0.4, Math.PI / 2, 2.1, -1.1]) {
    const bands = crosshairBands({ x: 5, y: -7 }, 33, angle, 1000);
    const diff = bands.across.angle - bands.along.angle;
    // Normalize to [0, 2*PI) before comparing to PI/2, since angle addition
    // isn't itself wrapped.
    const normalized = ((diff % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    assert.ok(Math.abs(normalized - Math.PI / 2) < 1e-9, `expected 90deg apart at angle ${angle}, got ${normalized}`);
  }
});

test('crosshairBands: undefined/NaN angle falls back to axis-aligned (along = 0 rad)', () => {
  const bands = crosshairBands({ x: 0, y: 0 }, 10, undefined, 1000);
  assert.equal(bands.along.angle, 0);
  assert.ok(Math.abs(bands.across.angle - Math.PI / 2) < 1e-9);
});

test('crosshairBands: a real angle is preserved verbatim on "along", not silently defaulted', () => {
  const bands = crosshairBands({ x: 0, y: 0 }, 10, 0.73, 1000);
  assert.equal(bands.along.angle, 0.73);
});

// ---------- arm-state ----------

test('isElbowStyleLabel matches native\'s exact numbered-menu labels', () => {
  assert.ok(isElbowStyleLabel('2. Elbow rectangular'));
  assert.ok(isElbowStyleLabel('3. Elbow round'));
  assert.ok(!isElbowStyleLabel('1. Continue (straight)'));
  assert.ok(!isElbowStyleLabel('Elbow rectangular')); // no leading digit — not a real menu item
});

test('isStraightLabel matches only the straight-continuation item', () => {
  assert.ok(isStraightLabel('1. Continue (straight)'));
  assert.ok(!isStraightLabel('2. Elbow rectangular'));
});

const CAPTURING_ROUTE = (vertexCount) => ({
  status: 'capturing', mode: 'route',
  vertices: Array.from({ length: vertexCount }, (_, i) => ({ x: i, y: 0 })),
});

test('reduceArmState: picking "Elbow rectangular" mid-route (already capturing) arms "pending"', () => {
  const route = CAPTURING_ROUTE(1);
  const state = reduceArmState(null, { type: 'menuPick', label: '2. Elbow rectangular', route, activeTool: 'route' });
  assert.deepEqual(state, { kind: 'pending', armedVertexCount: 1, armedTool: 'route' });
});

test('reduceArmState: picking an elbow style while NOT yet capturing arms "continuation"', () => {
  const route = { status: 'idle', mode: 'route', vertices: [] };
  const state = reduceArmState(null, { type: 'menuPick', label: '1. Elbow round', route, activeTool: 'select' });
  assert.equal(state.kind, 'continuation');
});

test('reduceArmState: a non-route/flex mode never arms', () => {
  const route = { status: 'capturing', mode: 'transition', vertices: [{ x: 0, y: 0 }] };
  const state = reduceArmState(null, { type: 'menuPick', label: '2. Elbow round', route, activeTool: 'transition' });
  assert.equal(state, null);
});

test('reduceArmState: "pending" disarms the instant a new vertex is appended (vertex count changes)', () => {
  let state = reduceArmState(null, { type: 'menuPick', label: '2. Elbow round', route: CAPTURING_ROUTE(1), activeTool: 'route' });
  assert.equal(state.kind, 'pending');
  state = reduceArmState(state, { type: 'routeUpdate', route: CAPTURING_ROUTE(2), activeTool: 'route' });
  assert.equal(state, null);
});

test('reduceArmState: "continuation" survives the vertex count changing (it is standing, not one-shot)', () => {
  let state = reduceArmState(null, { type: 'menuPick', label: '1. Elbow round', route: { status: 'idle', mode: 'route', vertices: [] }, activeTool: 'select' });
  assert.equal(state.kind, 'continuation');
  state = reduceArmState(state, { type: 'routeUpdate', route: CAPTURING_ROUTE(1), activeTool: 'route' });
  assert.equal(state.kind, 'continuation');
  state = reduceArmState(state, { type: 'routeUpdate', route: CAPTURING_ROUTE(2), activeTool: 'route' });
  assert.equal(state.kind, 'continuation');
});

test('reduceArmState: routeUpdate disarms once the route stops capturing', () => {
  let state = reduceArmState(null, { type: 'menuPick', label: '2. Elbow round', route: CAPTURING_ROUTE(1), activeTool: 'route' });
  state = reduceArmState(state, { type: 'routeUpdate', route: { status: 'committed', mode: 'route', vertices: [] }, activeTool: 'route' });
  assert.equal(state, null);
});

test('reduceArmState: routeUpdate disarms once activeTool leaves route/flex', () => {
  let state = reduceArmState(null, { type: 'menuPick', label: '2. Elbow round', route: CAPTURING_ROUTE(1), activeTool: 'route' });
  state = reduceArmState(state, { type: 'routeUpdate', route: CAPTURING_ROUTE(1), activeTool: 'select' });
  assert.equal(state, null);
});

test('reduceArmState: picking "Continue (straight)" disarms both pending and continuation', () => {
  let pending = reduceArmState(null, { type: 'menuPick', label: '2. Elbow round', route: CAPTURING_ROUTE(1), activeTool: 'route' });
  pending = reduceArmState(pending, { type: 'menuPick', label: '1. Continue (straight)', route: CAPTURING_ROUTE(1), activeTool: 'route' });
  assert.equal(pending, null);

  let cont = reduceArmState(null, { type: 'menuPick', label: '1. Elbow round', route: { status: 'idle', mode: 'route', vertices: [] }, activeTool: 'select' });
  cont = reduceArmState(cont, { type: 'menuPick', label: '1. Continue (straight)', route: CAPTURING_ROUTE(1), activeTool: 'route' });
  assert.equal(cont, null);
});

test('reduceArmState: picking an unrelated checkpoint item ends a "pending" arm but not a "continuation" one', () => {
  let pending = reduceArmState(null, { type: 'menuPick', label: '2. Elbow round', route: CAPTURING_ROUTE(1), activeTool: 'route' });
  pending = reduceArmState(pending, { type: 'menuPick', label: '3. Reducer / transition', route: CAPTURING_ROUTE(1), activeTool: 'route' });
  assert.equal(pending, null);

  let cont = reduceArmState(null, { type: 'menuPick', label: '1. Elbow round', route: { status: 'idle', mode: 'route', vertices: [] }, activeTool: 'select' });
  cont = reduceArmState(cont, { type: 'routeUpdate', route: CAPTURING_ROUTE(1), activeTool: 'route' });
  cont = reduceArmState(cont, { type: 'menuPick', label: '3. Reducer / transition', route: CAPTURING_ROUTE(1), activeTool: 'route' });
  assert.equal(cont.kind, 'continuation');
});

test('reduceArmState: escape/toolChanged/pageChanged always disarm', () => {
  const armed = () => reduceArmState(null, { type: 'menuPick', label: '2. Elbow round', route: CAPTURING_ROUTE(1), activeTool: 'route' });
  assert.equal(reduceArmState(armed(), { type: 'escape' }), null);
  assert.equal(reduceArmState(armed(), { type: 'toolChanged' }), null);
  assert.equal(reduceArmState(armed(), { type: 'pageChanged' }), null);
});

test('reduceArmState: routeUpdate on an already-null state stays null (no spurious re-arm)', () => {
  assert.equal(reduceArmState(null, { type: 'routeUpdate', route: CAPTURING_ROUTE(3), activeTool: 'route' }), null);
});

test('reduceArmState: an unknown event type is a no-op', () => {
  const armed = reduceArmState(null, { type: 'menuPick', label: '2. Elbow round', route: CAPTURING_ROUTE(1), activeTool: 'route' });
  assert.deepEqual(reduceArmState(armed, { type: 'somethingElse' }), armed);
});
