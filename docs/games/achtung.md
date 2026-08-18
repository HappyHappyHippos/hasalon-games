# Achtung die Kurve

Implementation notes for `packages/shared/src/games/achtung/` and
`packages/client/src/games/achtung/`. Read this before changing anything
in either directory.

Collision is an occupancy grid (`achtung/grid.ts`), one byte per arena unit.
The probe geometry (radius, `PROBE_EPS`, `PROBE_ARC`, sweep step) is
interdependent — the file's top comment explains why probes can never
self-collide with a curve's own trail as long as the arc stays under 90°, and
why a *shrinking* radius needs `SELF_GRACE_TICKS`. Read it before touching
`achtung/constants.ts` speed/radius values.

The trail canvas is persistent beyond the roughly one-second snapshot feed.
Only the newest snapshot may signal a match rollback; old entries naturally
remain in the interpolation buffer and must never reset the canvas. A new trail
epoch clears once, while older-epoch entries are skipped until they age out.
