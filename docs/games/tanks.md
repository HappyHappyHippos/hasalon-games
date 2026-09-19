# Tank Trouble

Implementation notes for `packages/shared/src/games/tanks/` and
`packages/client/src/games/tanks/`. Read this before changing anything
in either directory.

**The arena is a wall lattice, not a tilemap.** `tanks/types.ts:Maze` is two
`Uint8Array`s of cell *edges*. Every wall is therefore an axis-aligned segment at
a known coordinate, which is what makes shell reflection exact and tank collision
a lookup rather than a broadphase. Almost everything else follows from it.

**Generation cannot fail, by construction** (`tanks/maze.ts`): a randomised-DFS
spanning tree is connected by definition, and the braid pass only *removes*
walls, which cannot disconnect anything. So there is no generate-and-retry loop.
`validateMaze` and `fallbackMaze` exist to prove that in tests and to guard a
live match, not because generation is expected to misbehave. `BRAID_FRACTION` is
the one number that decides whether the arena plays like Tank Trouble or like a
hedge maze — a perfect maze is all dead ends with nowhere to circle.

**Shells march the lattice** (`tanks/ballistics.ts`), they do not integrate. Three
things in that file are load-bearing and all three were found by the tests:

- The crossed axis is **assigned** to the grid line, not integrated onto it.
  `pos + vel * ((line - pos) / vel)` does not land exactly on `line`, and the
  residue accumulates until a shell sits a hair past a wall and walks out of the
  arena.
- The *un*-crossed axis is clamped so it cannot slip past its own next line at a
  corner, for the same reason.
- The crossing test is `t <= remaining`, not `<`. A shell landing exactly on a
  line as the tick runs out would otherwise arrive untested, and the next march —
  which treats "sitting on a line" as meaning the next one is a full cell away —
  skips that wall entirely.

**The maze is never in the snapshot.** It is deterministic from `(matchSeed,
round)`, so the snapshot carries `az`/`aw`/`ah` and the client regenerates and
memoises. A mid-round joiner gets the arena from the first frame they receive.

Tank-vs-tank shoving is the one place prediction is not exact — the predictor
only knows the others as of the last snapshot. `PositionSmoother` absorbs it;
don't add rollback for a shove.

**The thumbstick is a travel control, not a heading control** (`stickBits.ts`).
Point it behind the tank and the tank *reverses* toward it — it aims its tail at
the stick and drives `back` — rather than swinging the hull through a half
circle, which in a corridor a tank barely fits down is how you die in the corner
you were leaving. Two latches — whether to drive at all, and which end of the
tank is doing the aiming — plus an analogue turn axis that needs none. The
reverse latch has a deliberately wide hysteresis band (115°/65°) because it
decides which way the tank *travels*, and a thumb resting near the crossover
would otherwise rock it back and forth on the spot.

`TouchPad.tsx:STICK_BITS` has to list every bit the stick can emit, `IN_BACK`
included. It is the set the pointer diff walks, so a bit missing from it is
never pressed *and never released*. The desktop keys are unaffected: they were
always fwd/back/turn, and there is no "opposite direction" to interpret.

**A travel control is a closed loop, and every part of it has to be honest.**
The stick holds a turn until the hull's heading has reached where your thumb is
pointing, so it steers by feedback — and it waddled because three separate parts
of that loop were lying. Each of these alone is enough to make a tank oscillate
across the line you asked it to drive, which is why fixing the first two did not
fix it:

- **The turn was one bit per direction, so the hull could only rotate at the
  full `TURN_RATE` or not at all.** "Nearly aligned" and "pointing the wrong way"
  asked for exactly the same thing, and a control that can only be on or off has
  to *guess* when to stop. Every guess that is wrong lands past centre, where it
  turns back, and past centre again. The turn is analogue now
  (`types.ts:IN_TURN_SHIFT`, packed into the mask exactly as Dirt's steering is)
  and `stickBits.ts:turnFor` asks for a fraction proportional to the error, so
  the correction shrinks as the error does and no threshold has to be right.
  Hysteresis went with it: an axis that fades to zero has nothing to chatter
  between. The drive and reverse latches stay, because those *are* either/or.
- **It only got to change its mind while your thumb was moving.** The decision
  was made in `Thumbstick`'s `onMove`, so a thumb that had arrived where it
  wanted and stopped generated nothing and the last request stood. `TouchPad`
  now re-reads the held vector on its own 60 Hz interval.
- **It compared against a photograph.** `currentAngle` read `snap.players[].a`
  straight off the newest snapshot, which is a snapshot interval *plus half a
  round trip* old — about 0.3 rad of swing on a 114 ms link.
  `predictor.ts:predictAngle` replays the unacknowledged turn requests, so the
  comparison includes the turning already in flight.

The turn field goes through `setField`, not `setButton`: `setButton` re-arms a
tap latch so a press shorter than one sample still reaches the server, which is
right for a trigger and wrong for an axis — it would pin the hull at whatever
magnitude it brushed past on the way through centre.

`stickBits.test.ts` drives the real `TURN_RATE` integration from the real stick
output and asserts the hull arrives and never crosses to the far side. The bug
lived in the loop, and neither half of it looked wrong on its own.
