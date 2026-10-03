// Pure unit tests for src/core/ — no DOM, no browser, real node:test/assert.
// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  spatialToFramePx, framePxToClientPoint, spatialToClientPoint,
  cssPxPerFootAt, ductWidthInches, ductWidthCssPx, crosshairOutline,
} from '../src/core/geom.js';

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

test('crosshairOutline: 12-point plus outline, axis-aligned and 45°', () => {
  const o = crosshairOutline({ x: 10, y: 20 }, 4, 100, false);
  assert.equal(o.length, 12);
  assert.deepEqual(o[0], { x: 10 - 50, y: 20 - 2 });
  assert.deepEqual(o[2], { x: 10 - 2, y: 20 - 50 });
  const d = crosshairOutline({ x: 10, y: 20 }, 4, 100, true);
  assert.equal(d.length, 12);
  // every vertex keeps its distance from the centre under the 45° turn
  o.forEach((p, i) => {
    assert.ok(Math.abs(Math.hypot(p.x - 10, p.y - 20) - Math.hypot(d[i].x - 10, d[i].y - 20)) < 1e-9);
  });
  // the first edge (along the old x axis) now runs along a diagonal
  assert.ok(Math.abs((d[1].x - d[0].x) - (d[1].y - d[0].y)) < 1e-9);
});

test('crosshairOutline: has no angle parameter — only a diagonal flag', () => {
  assert.equal(crosshairOutline.length, 4); // (center, thicknessPx, spanPx, diagonal)
});
