# Worms

Turn-based artillery on destructible terrain. 2–8 players, two worms each in a
small room and one each in a big one, last player with a worm alive wins.

Read this before touching anything under `packages/shared/src/games/worms/` or
`packages/client/src/games/worms/`. Everything here cost real debugging time.

## The one thing that makes this game different

**Terrain is simulation state, not scenery.** Every other game in the repo has a
fixed arena — Gun Mayhem a list of platforms, Tank Trouble a lattice of walls —
and can therefore ship it in the level definition and forget about it. Here the
map changes every time something explodes, both sides have to agree about it
exactly, and a disagreement shows up as a player standing on ground the server
says is gone.

Three decisions follow from that, and they are the spine of the whole game:

1. The collision world is a **bitmask**, generated from the artwork, compiled
   into `masks/` as a string. Server and client decode the same bytes.
2. Destruction is a **list of craters**, not a diff of the mask. Craters are
   four integers each, and `carveCrater` is idempotent, so applying the list
   twice is the same as applying it once. That is what makes catching up
   trivial.
3. The crater list travels on **`privateFor`**, which is not what that channel
   was built for. See *The crater channel* below.

## Terrain

`terrain.ts` is the whole of it: decode, query, carve. `MASK_CELL` is 2 world
units and world units are the pixels of the stage paintings, so anything here
can be measured off a screenshot.

- **One byte per cell, not one bit.** `solidAt` is the innermost loop of both
  projectile marching and worm movement. 384 kB per match on each side is
  nothing; packing it down is a plausible-looking optimisation that makes the
  game slower.
- **Out of bounds is empty, on all four sides.** Leaving the map is a game rule
  (`outOfWorld`), not a collision rule. Encode it in the mask instead and a worm
  punted off the edge bounces off an invisible wall and survives, which is the
  one thing Worms must never do.
- **There is deliberately no waterline.** The painted ocean in `green` sits
  above real, standable grass platforms; a per-stage water height would drown
  worms who are visibly on solid ground.

### The masks are generated, and so is the art

```bash
node scripts/derive-worms-terrain.mjs --overlay out/   # look at it first
node scripts/derive-worms-terrain.mjs --write          # then emit
```

One run produces all three artefacts per stage — the transparent terrain layer,
the reconstructed background plate, and the mask — from one classification, so
the mask and the picture cannot drift into invisible ledges and unstandable
rock. Read that script's header before adding a stage: two of the three existing
ones need hand-authored help, and it records what was tried.

The short version of what it learned: **`arctic` cannot be separated by colour
at all.** A background mountain is `rgb(160,205,250)` and a lit ice face is
`rgb(163,212,249)`. Every threshold that finds the ice also finds the sky. It is
classified by flood-filling from the image border instead, which keys on the
silhouette edge rather than on colour, plus a hand-placed seed under the rope
bridge — the bridge seals the sky beneath it into a pocket the fill cannot
reach, and without the seed that whole pocket comes out solid.

## Movement

`physics.ts:stepWorm` is the only function the client predicts through, so it
must stay a pure function of body, buttons and mask.

Two constants in here are load-bearing and were both tuned against real stages
rather than guessed:

- **`supported` scans every cell the collision box spans.** It started as three
  sample probes inset by one unit, and that one-pixel mismatch with `blocked`
  cost a full session: collision would land a worm on a sliver of ledge no probe
  could see, the next tick declared it unsupported and put it back in the air,
  it fell one unit onto the same sliver, forever. The worm never fell and never
  walked — it just stopped, at that one x, for the rest of the match.
- **`STEP_UP` is 14, and it is not a slope limit.** A worm is a 16-unit-wide
  box, so on any slope its *leading bottom corner* meets the ground several
  units before its feet do. Walking up what the artwork draws as a gentle ramp
  needs a lift of roughly the box's half-width plus the rise — twelve, on the
  living room. At ten the worms stopped partway up ramps that plainly look
  walkable, which every playtester reads as the controls being broken.

Also: a lift is only taken when there is something to stand on at the top of it.
Without that check the worm rises to clear a ledge corner while its feet are
still over the ground below, arrives supported by nothing, falls straight back,
and tries again from the same place.

## The turn machine

```
countdown ─▶ handoff ─▶ turn ──fire──▶ retreat ──▶ resolve ─▶ handoff …
                ▲         └──timeout / died─────────▶ ┘         │
                └───────────────────────────────────────────────┘
                                                 └▶ roundOver ─▶ matchOver
```

**Rotation is by seat, then by that seat's own worms** (`nextLivingWorm`), not by
position in a flat worm list. The two are identical while everyone is alive —
`order` is dealt copy-major so it alternates — and diverge the moment a worm
dies: a flat cursor closes the gap the corpse left and the following seat
inherits that slot as well as its own. Two players with two worms each, one
death, and the survivor took every other turn *and* the dead worm's, i.e. two in
a row for the rest of the round. `state.seatCursor` walks `state.seatOrder`, each
seat remembers its `lastWorm`, and a seat with nothing alive is skipped.

**A turn that runs out of clock goes to `resolve`, never to `retreat`.** Retreat
is only ever entered by firing. That single rule is why "the clock expired while
this worm was mid-flight from someone else's mine" is not a case that needs
handling — it is just `resolve` doing its job, which is to wait until the world
has stopped moving before handing over.

`resolve` has a hard cap (`RESOLVE_MAX_TICKS`). Everything in its settle test
can in principle stay false forever — a worm rocking in the bottom of a crater
it just made is the realistic one — and without the cap the match stops with no
error and nothing on screen to explain it.

**Away seats still get a turn, just a short one** (`AWAY_TURN_TICKS`, via the
`setConnected` hook). Their worm is alive and targetable and they may be back in
three seconds, but a full clock per away worm per round empties the room.

## The crater channel

`GameInstance.privateFor` is documented for secrets. Worms uses it for the
crater list, which is not a secret, and that is deliberate.

What the channel actually provides is *server-pushed state, diffed so an
unchanged value is free, re-sent after detach/resume, and replayed by
`sendCatchUp`*. That is exactly what destructible terrain needs. The
alternatives were measured:

| | Steady state | Reconnect | Late joiner |
|---|---|---|---|
| Full list in every snapshot | ~720 kB/s across 8 sockets | ok | ok |
| Incremental in the snapshot | ~0 | **broken** | **broken** |
| `privateFor` | ~3 kB *per change* | ok | ok |

Incremental is broken because `Room.sendCatchUp` replays one snapshot, and a
delta is not a world.

Two consequences worth knowing:

- `registry.test.ts` asserts that `privateFor` answers null for a stranger.
  **Worms is exempt**, and has to be: spectators need the terrain to draw the
  ground, and a spectator is not seated and is indistinguishable in there from
  an unknown id.
- `broadcastSnapshot` sends the snapshot *then* the privates, and the client
  plays back ~100 ms behind. So the client applies craters to its collision mask
  immediately (append-only and idempotent) but gates the **visual** carve on the
  crater's tick, or the ground vanishes before the explosion that caused it.

If a second game ever wants this, the honest fix is a sibling hook that `Room`
encodes once and broadcasts, rather than once per player. About twenty lines.
Do not write it speculatively for one caller.

## Weapons

`weapons.ts` is a table and `sim.ts:fire` switches on three `kind`s and nothing
else. A new weapon that is a variant of an existing one is a row in that file
and no code anywhere. Resist adding a `switch (spec.id)`.

`aim` and `kind` look like the same axis and are not. `aim` is what the *client*
must collect from the player; `kind` is what the *sim* does with it.
`aim: 'target'` covers both the air strike and the teleport — same reticle — and
they share no code at all.

Three entries are less obvious than they look:

- **The shotgun is not hitscan.** It is a projectile with no gravity and no wind
  at 2000 units a second. Reusing the marcher means it collides with terrain and
  worms by exactly the same code as everything else, rather than by a second
  ray-cast that has to agree with it.
- **`death` is a weapon.** A worm that runs out of health detonates one, and it
  is a table row rather than a bare blast so a death can chain into the next
  death. `selectable: false` keeps it out of the picker and out of `weaponsFor`.
- **`isWeaponId` uses `hasOwnProperty`, not `in`.** `'constructor' in WEAPONS`
  is true, and `in` would hand the simulation `Object.prototype.constructor`,
  whose `kind` is undefined, and `fire`'s exhaustive switch would throw and take
  the room down.

**Dynamite, the mine and the baseball bat were removed**, and with them the
machinery that existed only for those three: the `melee` kind and `aim`, the
`proximity` detonate mode, the `persist`/`resting` projectile flags and the
snapshot's `mines` array. A future melee or persistent weapon re-adds what it
needs; git history has the previous versions. Nothing else read any of it.

**Knockback replaces velocity rather than adding to it**, following
`gunmayhem/sim.ts:damageAndLaunch`. It is why a hit reads the same every time:
adding to whatever the worm was already doing means an identical shot flings a
falling worm across the map and barely moves a standing one, and players read
that as the weapon being unreliable rather than as physics.

## Client

- Shot power is an explicit 15–100 slider and `fire` is a reliable one-off
  command. The old held `IN_FIRE` path remains accepted by the simulation for
  replay/backward compatibility, but no current client emits it. The trajectory
  preview advances a temporary projectile through `stepProjectile`, the same
  marcher the server uses, against the live client terrain mask. It renders only
  the first 62% of that computed path (and caps long paths at roughly 110 ticks),
  so even a nearby collision remains a hint rather than revealing the endpoint.
- The sprite is drawn taller than its movement box, and projectile/blast hit
  tests use `WORM_HIT_R`. Do not enlarge `WORM_HALF_W/H` just to make the art or
  target easier to see: those constants define whether ramps are walkable.
- Touch and desktop controls use translucent fills with no backdrop blur. They
  must remain readable over every stage, but should never hide a worm beneath
  an opaque control panel.
- **The camera is a local, per-client spring**, deliberately unlike a game
  where everyone shares one window and the camera has to be identical
  everywhere. Free pan and zoom is a feature here and two players looking at
  different parts of the battlefield is the intended state.
- The camera transform **composes on top of `CanvasStage`**, which is
  constructed with the *view* size rather than the world size and still owns
  DPR, resizing and the letterbox. Screen-to-world therefore inverts both, which
  is why pointer handlers go through `Renderer.toWorld` and not `stage.toArena`.
- **Squash and stretch takes its walk phase from world x, never from a frame
  counter.** Stateless, so it survives a snapshot correction, and two clients
  watching the same worm draw it mid-stride identically for free.
- **The worm sprite's maximum alpha is 254, never 255.** Whatever cut it out
  shaved a level off every pixel, so any `a === 255` test matches nothing and
  the sprite silently fails to draw. Threshold at 128.
- Only the active worm is predicted, and only when it is yours. Everything else
  goes through the shared `RemoteBodies` slide/snap rule. Knockback is never
  predicted — a blast only lands during `resolve`, when nothing is controllable.

## Testing

`sim.test.ts` holds the determinism test, and its digest deliberately includes
the crater list **and** a hash of the mask itself. Terrain is state here; a
drift in it is a player falling through ground that is still on screen.

For anything you cannot see from a unit test, run `npm run dev` and drive a
second player with a throwaway `bot.tmp.mjs` — two browser tabs is the wrong
tool, for all the reasons in CLAUDE.md. Logging each seat's `ack` and `ib` off
the snapshot is what turns "movement is broken" into "the client is sending the
right bits and the worm is against a wall" in one step.
