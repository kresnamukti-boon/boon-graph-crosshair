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
export function crosshairSegments(center, widthPx, angleRad) {
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
