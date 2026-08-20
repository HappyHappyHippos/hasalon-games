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

**The probes and the stamp are a pair, and `PROBE_EPS` is the gap between
them.** Probes ride the head's drawn outline at exactly `radius`; the grid trail
is laid `PROBE_EPS` *inside* it by `stampRadiusFor`. Only their difference
matters to the self-collision proof, which is why the clearance used to be added
to the probe instead — and why that was wrong for everything the proof is not
about. It put the lethal ring outside the drawn head, so a curve died with a
visible sliver of daylight left and every close call was a lie. Stamping thinner
instead moves the error to the generous side: you may clip the outer `PROBE_EPS`
of a drawn line and you may drive right up to a wall. `sim.test.ts`'s "only just
touching" pins both ends of that.

**Speed and radius each drag two other constants with them.** `BASE_TURN_RATE`
scales with `BASE_SPEED` so the turning *circle* keeps its size (the lobby's
`speedScale` presets multiply both, for the same reason), and
`HOLE_DURATION_TICKS` is really "four line widths of daylight" — a slower or
fatter curve needs more ticks of gap to thread the same hole. Both are spelled
out in `constants.ts`; neither has a test that would catch you.

The trail canvas is persistent beyond the roughly one-second snapshot feed.
Only the newest snapshot may signal a match rollback; old entries naturally
remain in the interpolation buffer and must never reset the canvas. A new trail
epoch clears once, while older-epoch entries are skipped until they age out.
