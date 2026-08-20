# Dirt Racing

Implementation notes for `packages/shared/src/games/dirt/` and
`packages/client/src/games/dirt/`. Read this before changing anything in
either directory.

**The course is one polyline, and everything is derived from it.** A track
(`tracks.ts`) is a closed centreline of control points, a half-width at each of
them, and a handful of solid boxes. `track.ts` derives *everything* else from
those: which of the three surfaces a point is on, how far round the lap a car
is, where the grid is, where the checkpoints are, where the powerup pads are,
where a stuck car is put back, and the ribbons the renderer paints. That is the
property to protect — the grass that slows you down is the grass you can see,
and the lap the HUD counts is the distance the car drove, because there is only
one description of the course.

**The drivable world is the track plus a shoulder, and everything else is
scenery.** `SHOULDER` is the whole reason this game has no shortcuts nobody
intended. A loop's infield is a couple of hundred units of grass, and cutting
straight across it at offroad speed comfortably beats driving half a lap at
racing speed — so with a fixed shoulder either side, *every track has a fatal
exploit*. Closing that by scattering rocks means hoping no gap was left
anywhere on any course, which is not something you can check by looking.
`clampShoulders` closes it structurally instead: the shoulder is narrowed at
build time wherever two parts of the lap pass close together, so their drivable
ground never joins up. Before that pass existed, Canyon Run had fifty-one
distinct crossings, the best saving 0.7 s. `tracks.test.ts` samples every pair
of far-apart points on every course and bounds how much the best drivable
alternative may save — a bound rather than zero, because an authored shortcut
*is* a drivable route between two parts of the lap, and forbidding those
outright would forbid the feature.

The pleasant side effect is that it shapes the courses the way a designer would
anyway — wide forgiving shoulders down a straight, nothing at all to run onto
through a hairpin. The cost is that **widening a track somewhere can quietly
narrow its shoulder somewhere else**, which is worth knowing before moving a
corner.

**Progress is a distance, not a set of gates.** A car's `progress` is its
projection onto the centreline, accumulated. Laps, checkpoints and race
positions are all views of that one number, which is why they cannot disagree
with each other and why there is no checkpoint to miss. Cutting a corner
credits exactly the arc it covered, which is what makes a shortcut faster
without any special handling.

Three things keep it honest, and all three were found the hard way:

- **The projection searches near where the car already was** (`nearestNear`),
  not globally. At a hairpin the two legs run alongside each other, so a car
  hugging the inside kerb is nearly equidistant from its own centreline and the
  one coming back — a global nearest flips between two points half a lap apart,
  and the lap never completes. The *fast line* would be the one that stopped
  counting your laps.
- **A rejected jump still re-anchors `lastU`.** This one line is load-bearing.
  The search window is centred on `lastU`, so leaving it behind after a single
  rejected tick meant the window drifted further from the car every tick, every
  later delta was also too big, and the lap counter froze for the rest of the
  race — while the car kept driving perfectly, so nothing looked wrong.
  Measured on Pine Grove: one clipped corner, no more laps, ever.
- **Progress only accrues from real movement.** A car that is shoved or
  recovered neither gains the distance it did not drive nor loses the distance
  it did.

**There is no brake, and that is a hard constraint rather than a
simplification.** A car at `TRACK_TOP_SPEED` turning at `TURN_RATE` sweeps a
circle whose radius has to fit inside the corners, or *every corner tighter than
that is one no car can take* — it drives into the outside wall, every lap,
forever. `CORNER_DRAG` is the brake pedal: sliding sideways scrubs forward
speed, so turning in slows the car into the corner and drives it out the other
side. Before it existed a lap of Canyon Run took 102 seconds and a lap of Salt
Flat took 6.4, and the only difference between them was how tight the corners
were.

The top speed was later dropped from 430 to 300 for the same reason from the
other end: at 430 the turning circle was 134 units, wider than most of the
corners on these courses, so the car spent the lap unable to go where it was
pointed. At 300 it is ~94, comfortably inside every corner `tracks.test.ts`
allows. Speed in a top-down racer is read from how fast the scenery goes past,
not from the number.

**`MIN_TURN_AUTHORITY` is not a feel knob, it is a deadlock guard.** Steering
authority scales with speed, so a car nosed into a rock cannot steer; with no
brake, the automatic throttle drives it straight back into the rock. Measured on
The Quarry before the floor existed, one car spent 58% of a lap in contact and
sat motionless against a single obstacle for thirteen seconds, and the
stuck-recovery was firing seventy-odd times a race — the safety net doing the
driving.

**Cars can never be permanently stuck, and the sim has to promise that
explicitly** because nothing else can: cars accelerate on their own and have no
reverse gear, so a car wedged against scenery or pinned by a scrum has no input
that would free it. `recover` puts it back on the centreline near where it
already was, facing the way the track goes, with a brief window where it cannot
collide with other cars — without that grace it is immediately shoved back into
the scrum that caused the problem, which reads as the recovery not working.

**The drift is an ordering, and getting it backwards is silent.** The heading
rotates *first*, then velocity is decomposed against the **new** heading — and
the lateral component is non-zero precisely because rotating the nose did not
move the momentum. `TRACK_GRIP` bleeds that away over the next few ticks, which
is the slide.

This was wrong for a while and nothing said so. Decomposing against the *old*
heading and recomposing against the new one rotates the velocity vector by
exactly the steering angle every tick, so the momentum follows the nose
perfectly and no slide is possible — a brick on rails wearing a drift model's
comments. The test that was supposed to catch it passed anyway, off a wall
bounce that happened to produce sideways velocity. Cars now spend 14–22% of a
race actually drifting; before the fix, structurally none.

**Steering is analogue, and the magnitude rides in the input bitmask.** Two
direction bits alone were the single worst thing about how this game felt: the
wheel produces a deflection from 0 to 1, the wire carried one bit, so nudging it
a fifth of the way and hauling it to full lock steered identically. There was no
fine control anywhere. The magnitude now sits in bits 3–6 (`steerOf` /
`steerBits`), which costs nothing downstream because the 60 Hz sampler, the
replay history and the snapshot's `ib` all treat `bits` as an opaque integer. A
bare direction bit with no magnitude means full lock, which is how the keyboard
keeps working without knowing the field exists.

**The wheel is eased, not snapped.** `body.steer` is where the front wheel
actually is, moving toward the input at `STEER_RATE`. It is part of the body and
therefore part of the snapshot, or the predictor would replay from a straighter
wheel than the server's. This is most of the difference between twitchy and
planted, and it matters most on a keyboard, where the input is instantly full
lock.

**There are two powerups, and neither of them slows anybody.** `speed` helps
you, `mine` hurts whoever is behind. There used to be a third, `reverse`, which
flipped everyone else's steering — it was removed, and the removal is worth
recording because the thing that made it interesting is also what made it wrong.
A bot that ignored the indicator went from 0 respawns to 66 and doubled its lap
times; one that noticed paid almost nothing. That is a huge swing decided by
whether you happened to be looking, applied to people who did nothing to deserve
it, and no amount of signposting fixes the underlying shape.

The spin-out's speed penalty went the same way. A mine takes the wheel away and
that is the whole punishment — stacking a slow on top of a loss of control
turned one mine into most of a lap. Cornering drag does the rest for free: a car
rotating that fast is sideways, and sideways scrubs speed.

**A race ends when the second-to-last car is home.** Nobody wants to watch one
car do a lap on its own, and the driver of that car wants it least. In a two-car
race that is the winner crossing the line, which is the rule working rather than
an edge case. The stragglers are still placed, on the progress they managed.

**The steering wheel is a relative control, not a thumbstick, and the two are
not interchangeable.** A stick is a *direction* control — you point it where you
want to go — which is meaningless for a car that can only turn relative to its
own heading. Pointing a stick "up-left" means something different every second
on a course that changes compass direction constantly. Drag left or right
instead: it matches the axis the sim actually consumes.

**The whole lower band of the screen is the wheel; the drawn wheel is a
readout.** The first version was a small graphic in a corner that you had to
hit, with full lock only 78 px away — so the usable travel was a few dozen
pixels, every input was near full lock, and the car darted. It also looked
rotary while behaving linear, so the gesture it invited was not the one it
wanted. Now: press anywhere in the band and that point becomes centre (the same
floating origin `Thumbstick` uses, for the same reason), full lock is 190 px
away so the middle of the range is somewhere you can sit, and the corner dial
plus the bar along the bottom show how much lock is on without looking away
from the road.

**Skid marks are local and deliberately not in the snapshot.** They are pure
decoration derived from a flag the server already sends, so putting the marks
themselves on the wire would pay 30 Hz of bandwidth for something every client
can draw from what it has. Two clients disagreeing about where a smudge is costs
nothing — Achtung's trail is in its snapshot precisely because there it would
cost everything.

**The track is never in the snapshot.** It is deterministic from the track id,
so the snapshot carries `tk` and the client rebuilds and memoises the geometry.
A mid-race joiner gets the whole course from the first frame they receive — the
same trick as Tank Trouble's maze.

Car-on-car contact is the one place prediction is not exact: the predictor only
knows the others as of the last snapshot. `RemoteBodies` absorbs it; don't add
rollback for a shove.

## Assets

Each course has its own palette in `tracks.ts` — red rock, pine, grey stone,
bleached salt — because that is most of what makes them feel like different
places rather than one loop with the corners moved. The renderer reads those and
decides nothing itself.

There is no art for this game yet, and **the placeholders are not
approximations**. The renderer paints the course from `TrackGeometry` — the
same segment array the server collides against — so a car stops where the
picture says it stops because there is only one description of where that is.
If no file ever arrives, the game looks exactly as it does now.

Every place a file would be used is marked `ASSET SWAP POINT` in the source.
All of them fail soft (see `game/images.ts`), and all of them are one path each.
Dropping files at these paths needs no code change:

| Path | What | Notes |
|---|---|---|
| `client/public/stages/dirt/dirt_track_<id>.png` | The painted course | 1600×900. Drawn *under* the ribbons; the kerbs stay geometry-drawn, because they mark the real edge. `<id>` is `canyon`, `grove`, `quarry`, `saltflat`. |
| `client/public/cars/car_<colorIndex>.png` | Car sprite | Drawn nose-right, about 3:2. One per seat colour (0–7). |
| `client/public/powerups/powerup_dirt_<kind>.png` | Powerup icons | Square. `<kind>` is `speed`, `mine`, `reverse`. |
| `client/public/boxart/dirt.png` | Lobby card | 200×130. `BoxArt.tsx` currently draws inline SVG — swap the whole body for the same `<img>` the other games use. |
| `client/public/music/dirt.mp3` | Music bed | **mp3 only** — see the Ogg note in `public/music/ATTRIBUTION.md`. Currently points at `tanks.mp3`, deliberately at a file that *exists*; change the one line in `music.ts` and add the attribution. |

**If a backdrop is painted, the centreline has to be traced onto it rather than
the other way round.** The geometry is the truth about where the track is; art
only changes how it looks. Trace the centreline over the painting, adjust the
half-widths to match, box the props that should be solid, and re-run
`tracks.test.ts` — it will tell you if the pads have ended up unreachable, the
racing line has ended up inside a rock, or the new shape has opened a route
across the middle.

`?debugTerrain` on the game URL overlays the real terrain function — green
track, yellow shoulder, red scenery — sampled from `surfaceAt` itself rather
than from a second copy of it.
