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

// Screen-space angle (radians, atan2 convention) of the leg the armed elbow
// bends off of — the last placed segment (vertices[len-2] -> vertices[len-1]),
// or the source connector's own direction when only a seed vertex exists yet
// (a fresh continuation). Converted through the SAME world->client mapping as
// the crosshair's own center, so a rotated/flipped page transform still lines
// the crosshair up with the real drawn duct edges, not with raw world axes.
// Returns null when no direction is known yet — callers fall back to an
// axis-aligned (unrotated) crosshair rather than guessing.
export function legAngleClient(vertices, startDirection, transform, frameSize, frameRect, pixelRatio) {
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

// The crosshair itself: two perpendicular BANDS (thick lines, not hairlines)
// crossing at `center` (whatever pixel space the caller is drawing in — CSS
// or canvas-backing — as long as thicknessPx/spanPx are in the same space).
// Each band is `thicknessPx` thick (the duct's own true on-screen width) and
// `spanPx` long, centered on `center` — `spanPx` is the CALLER's job to make
// large enough (e.g. the overlay canvas's own diagonal, doubled) that both
// bands visibly run off every edge of the canvas regardless of rotation,
// reading as a full alignment guide rather than a small mark at the cursor
// (Kresna's own correction: "a solid crosshair expanding beyond the canvas
// with the width of the duct", replacing an earlier round's small
// width-length tick-mark crosshair). `angleRad` rotates the "across" band to
// sit perpendicular to the run's own direction (the one that actually needs
// to line up with the two parallel duct walls elsewhere on the page);
// axis-aligned (0 rad) when the direction isn't known. Returns each band as
// a center + angle + length + thickness, for the caller to fill as a rotated
// rectangle (`ctx.translate`/`ctx.rotate`/`ctx.fillRect`) rather than a list
// of points — a rotated filled rectangle isn't expressible as a flat point
// list the way the two short segments this replaces were.
export function crosshairBands(center, thicknessPx, angleRad, spanPx) {
  const angle = Number.isFinite(angleRad) ? angleRad : 0;
  const band = { cx: center.x, cy: center.y, length: spanPx, thickness: thicknessPx };
  return {
    thickness: thicknessPx,
    along: { ...band, angle },
    across: { ...band, angle: angle + Math.PI / 2 },
  };
}
