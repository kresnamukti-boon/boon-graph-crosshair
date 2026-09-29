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

export function isElbowStyleLabel(label) {
  return ELBOW_LABEL_RE.test(String(label ?? '').trim());
}

export function isStraightLabel(label) {
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
export function initialArmState() {
  return null;
}

export function reduceArmState(state, event) {
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
