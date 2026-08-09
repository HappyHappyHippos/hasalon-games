# Gun Mayhem

Implementation notes for `packages/shared/src/games/gunmayhem/` and
`packages/client/src/games/gunmayhem/`. Read this before changing anything
in either directory.

`gunmayhem/physics.ts:stepMovement` is the movement half, shared verbatim by
server and client prediction. Two things make it feel right: coyote time and
jump buffering (`COYOTE_TICKS`/`JUMP_BUFFER_TICKS` in `constants.ts`) — don't
remove these while "simplifying" the jump code, they're most of what
separates responsive from broken. Platforms are `solid` or `oneWay` (land
from above / jump up through / drop through on Down); bullets pass through
`oneWay` but not `solid`. Knockback (`gunmayhem/sim.ts:damageAndLaunch`)
*replaces* velocity rather than adding to it — that's intentional, it's what
makes every hit read consistently regardless of prior momentum — and scales
with accumulated damage per `KB_BASE`/`KB_PER_DAMAGE`.

`gunmayhem/constants.ts` is meant to be tuned; movement feel and weapon
balance are one-line changes there, not sim-logic changes.

Input is a bitmask + sequence number (`IN_LEFT`/`IN_JUMP`/etc in `types.ts`),
not per-key messages — taps shorter than one tick still register because the
server ORs rising edges (`sim.ts:applyInput`), and the sequence lets the
client replay unacknowledged inputs after a correction
(`client/games/gunmayhem/predictor.ts`). Prediction only runs while the local
player is actually in control (not respawning or out of stocks) —
knockback isn't predictable so the code deliberately doesn't try.
