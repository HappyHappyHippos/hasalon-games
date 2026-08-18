# Bomb It

Implementation notes for `packages/shared/src/games/bombit/` and
`packages/client/src/games/bombit/`. Read this before changing anything in
either directory.

**The board is a tilemap, and a map is four characters on a grid.** `#` wall,
`.` floor, `x` crate *candidate*, `S` spawn — see the header of `maps.ts`. `x`
means "a crate may stand here", not "a crate stands here": the layout is
re-rolled every round from the candidate cells at the host's density, so one map
plays differently twice running while its walls, routes and sight lines stay
exactly as authored. Adding a map is one entry in `BOMBIT_MAPS`, one id in
`BombitMapId`, and one name in both dictionaries.

**Every board is 23×13, and a new one must be too.** That is 1.769:1 — 16:9 to
within half a percent, and the closest an odd×odd grid gets. Odd is not
negotiable: the pillar lattice wants walls on the even coordinates *and* a solid
border on both, and an even dimension puts two pillars or two open rows together
at one edge. The grid's shape is the *display* shape — `Renderer.stageFor` sizes
its `CanvasStage` at `cols * TILE` by `rows * TILE` — so a near-square board
(they were 15×13 and 15×11) spent most of a sideways phone on letterbox bars and
cropped the 16:9 stage art hard to cover it. Both fit now.

**`validateMap` is what makes hand-editing a map safe**, and `maps.test.ts` runs
it over every one. It catches a short row, an unknown glyph, an open edge, a
region walled off from the spawns, and — the one that actually bites — a spawn
with no *off-axis* escape. That last is the game's only safety promise: a bomb
on your own spawn must be survivable, which means a reachable tile in neither
its row nor its column, and therefore safe at **any** blast range rather than
just the one you start with. `escapePocket` clears the L that gets you there,
searching every L the spawn can reach rather than only the two directions free
at the spawn itself — Classic's side spawns sit in a one-wide corridor where
nothing turns at the spawn and the way out is one tile up and then across.

**Movement is rails plus a corner assist, and that is the whole feel**
(`movement.ts`). A body always travels the centre line of a row or a column;
pressing into an axis first *slides* onto its nearest rail, and the slide spends
the same movement budget travelling would, so nothing ever moves diagonally at
√2 speed. When the nearest rail is blocked ahead but the next one over is not,
and it is within `CORNER_ASSIST`, the body takes that one instead.

Three things in that file are load-bearing and each was found by a test:

- **The axis arbitration ignores the corner assist** (`canAdvance`). Letting the
  assist answer "can I go this way" as well makes two blocked directions point
  at each other: in an L-shaped dead end, holding both keys had the body slide
  back to the rail it just left, find that way open from there, and jitter
  between the two for as long as both were held.
- **The sweep is a box, not a point.** During a corner slide the body genuinely
  straddles two rows and both have to be tested, or it clips the pillar it is
  rounding. The sweep also has three off-by-one hazards — the cell a lead edge
  sitting exactly on a boundary counts as, the perpendicular extent, and the
  last cell of the run — which is what the fuzz test in `movement.test.ts` is
  for.
- **A kicked bomb only ever aims at the next tile centre**, and only tests entry
  *from* a centre. Integrating and rounding at the end accumulates a residue and
  eventually explodes a tile away from where it looked.

**A kick that cannot move the bomb is not a kick.** `bombCanStart` is checked
before one is committed. Without it, leaning on a bomb wedged against a wall
re-kicks it every tick — set moving, blocked in the same tick, resting again
next tick — and a live match produced twenty-odd kick events, and twenty-odd
thumps of sound effect, for two bombs that never moved.

**The blast shape is computed once and used twice.** `blast.ts:blastCells` is
what the server explodes with *and* what the client draws its danger overlay
from. A telegraph drawn from a second, similar-looking rule is worse than no
telegraph: it teaches a blast pattern that is right almost always, and the game
becomes unfair precisely where the two disagree.

**The crate layer rides in every snapshot, packed** (`bits.ts`, six bits per
character). The walls never change and the client has them from the template, so
the map is three characters on the wire; the crates do change, and sending the
*live* layer rather than a seed plus a growing list of holes is what lets a
player who joins mid-round draw the same ground as everybody else from their
first frame.

**The tick order is part of the contract.** `stepPlaying` runs place → move →
slide bombs → burn → damage → collect, and the client's predictor replays the
first three in the same order. Sliding before moving would let a kicked bomb
pull a tick ahead of the body that kicked it.

**The predictor replays bombs, not just the body** (`client/predictor.ts`).
Kicking is the headline mechanic, and prediction that stopped at the body would
have the local character walk up to a bomb, stand still for half a round trip
while the server decided it had been shoved, and then set off after it. The
same replay covers a bomb the player has just placed, so the tile they are
standing on stops being walkable at the moment they step off it rather than an
RTT later. `playerWorld` and `bombSlideWorld` live in shared `movement.ts` so
both sides collide through the same definition.

**Players are the Gun Mayhem fighter, seen from the front.** Same proportions,
same helmet, same `game/appearance.ts` for hat and face, so the person you
dressed in the lobby is the person on the board. Facing is the *last horizontal*
direction: there is no back or front pose to switch to, and flipping the sprite
on every turn would strobe. `FIGHTER_HALF_W/H` are copied rather than imported —
Gun Mayhem's are its collision numbers, and importing them would let a hitbox
tweak there resize the cast here.

**Everything a player earns lasts one round.** `resetToSpawn` clears bombs,
range, speed and shields. Carrying them over compounds whoever won the last
round into an unloseable next one.

## Assets

- `public/stages/bombit/bombit_stage_*.png` — one backdrop per stage, named by
  the map's `stage` field. Drawn **cover**, not stretched. The art is 16:9 and
  the boards now are too, so cover crops almost nothing; keep it on `cover`
  anyway, since a stage whose art is off-ratio should letterbox its picture
  rather than the board. A darkening wash goes over it so bombs, fire and eight
  seat colours stay legible on artwork drawn to be looked at.
- `public/bombit/wall.png` and `crate.png` — one tile each, drawn at `TILE`
  square.
- `public/boxart/bombit.png` — the lobby card.
- Music is Gun Mayhem's bed until a track of its own is sourced; the entry in
  `client/music.ts` deliberately points at a file that **exists** (see the note
  there).
