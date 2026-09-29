#!/usr/bin/env bash
# Rebuild console_loader.js from src/core/*.js + src/console/shell.js after
# editing them. GRAPH ("Duct Takeoff") HOST ONLY — this add-on checks that
# itself and does nothing at all on the annotate-job host, since there is no
# window.__graphDebug there. See CLAUDE.md.
set -euo pipefail
cd "$(dirname "$0")"

node scripts/build-dist.js
DIST=dist/rw_crosshair.js
node --check "$DIST"

OUT=console_loader.js

cat > "$OUT" <<'HEADER'
/* Boon Crosshair — console loader.
 * Usage: F12 -> Console -> paste this entire block -> Enter.
 * While an elbow style ("Elbow rectangular"/"Elbow round") is armed for the
 * route/flex tool's next click on the graph ("Duct Takeoff") session, draws a
 * crosshair at the cursor whose arms span the armed duct's own real plan
 * width (rectangular width_in, or diameter_in for round) in screen pixels —
 * so each arm's ends can be lined up on the duct's two already-drawn edges
 * for precise corner placement. Read-only: never clicks, drags, or mutates
 * any annotation state. Does nothing on the annotate-job host. Standalone —
 * no coupling to any sibling RW-family add-on. Paste again after each page
 * navigation. */
(async function(){
  function ready(){
    return document.getElementById('graph-session-root')
        && typeof __graphDebug !== 'undefined';
  }
  for (let i=0; i<60 && !ready(); i++) await new Promise(r=>setTimeout(r,500));
  if (!ready()){ console.warn('[RW] not the graph ("Duct Takeoff") host after 30s — try pasting again once the page renders, or this may simply be the wrong page for this add-on'); return; }

HEADER

echo "// ===== $DIST =====" >> "$OUT"
cat "$DIST" >> "$OUT"
printf '\n' >> "$OUT"

cat >> "$OUT" <<'FOOTER'
})()
FOOTER

node --check "$OUT" && echo "rebuilt $OUT ($(wc -c < "$OUT") bytes) — syntax OK"
