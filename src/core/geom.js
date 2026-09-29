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
export function spatialToFramePx(pt, transform, frameSize) {
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
export function framePxToClientPoint(framePx, frameRect, pixelRatio) {
  if (!framePx || !frameRect || !Number.isFinite(pixelRatio) || pixelRatio <= 0) return null;
  return {
    x: frameRect.left + framePx.x / pixelRatio,
    y: frameRect.top + framePx.y / pixelRatio,
  };
}

export function spatialToClientPoint(pt, transform, frameSize, frameRect, pixelRatio) {
  return framePxToClientPoint(spatialToFramePx(pt, transform, frameSize), frameRect, pixelRatio);
}

// CSS pixels spanned by one foot of world distance at the given spatial
// point, direction-independent (geometric mean of the x- and y-sampled local
// scale) — same formula as framePxPerFootAt (graph-session-entry.js:7876-
// 7904), converted from frame px to CSS px by pixelRatio at the end so the
// result is directly usable against clientX/clientY-space measurements.
export function cssPxPerFootAt(spatialPoint, transform, frameSize, frameRect, pixelRatio) {
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
export function ductWidthInches(profile) {
  if (!profile) return null;
  const w = profile.width_in ?? profile.diameter_in;
  return Number.isFinite(w) && w > 0 ? w : null;
}

export function ductWidthCssPx(widthInches, cssPxPerFoot) {
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
export function crosshairBands(center, thicknessPx, spanPx) {
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
