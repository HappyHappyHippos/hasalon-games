# אישה נוהגת (Woman Driving)

The game's id is `dirt` everywhere in the code, and `GameMeta.name` is still the
English "Dirt Racing" — that one is for logs. The displayed name lives only in
`client/i18n.ts`, per the rule in CLAUDE.md.

Implementation notes for `packages/shared/src/games/dirt/` and
`packages/client/src/games/dirt/`. Read this before changing anything in
either directory.

**The four courses are four different shapes, and that is the point of them.**
They were all a perimeter ring at one stage, varying only in width and palette,
which is a lot of work for one track. Now: Canyon Run is a ring with a deep
notch that dives into the middle of the arena, Pine Grove is a dumbbell whose
neck the lap crosses twice in opposite directions with pines between the runs,
The Quarry spends part of its lap inside its own infield on a tongue that climbs
into the centre and doubles back, and Salt Flat is a rounded triangle of three
flat-out sweepers. **Any course whose two runs pass close together needs ~270
units between the centrelines** — less than that and `clampShoulders` has
nothing left to cut, the two surfaces merge into one patch, and the route stops
being readable. That is what killed the first attempt at Pine Grove.

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

**Top speed and turn rate move together or not at all.** This is the one number
pair that has been wrong in both directions. At 430 the turning circle was 134
units — wider than most corners here, so the car spent the lap unable to go
where it was pointed. Walking it back to 300 and then 255 fixed that and took
the urgency out of the race, which is what brought it back up. It now sits at
400 with `TURN_RATE` at 4.1, so the circle is ~98 and still fits every corner on
the four courses.

`tracks.test.ts` pins the other half of the pair: no corner on any course may be
tighter than half the full-speed circle, so raising the speed without redrawing
the courses fails the suite rather than shipping a corner nobody can take. The
binding corner today is The Quarry's exit onto the main straight at r=60, which
is what caps the top speed at roughly 490 before the courses have to change.

**Drift is a feel knob, not a pace knob, and that is why it is safe to turn.**
`TRACK_GRIP` is now 4.0, down from 5.5: a ~173 ms half-life on the sideways
component instead of ~126 ms. Measured with a bot lapping each course, cars
spent 8–18% of a race sideways at the old value and spend 36–68% at this one —
the difference between a racer that occasionally slides and a rally car. Across
a sweep from 3.5 to 5.0 the lap times moved under three tenths of a second,
because `CORNER_DRAG` scrubs back out of the corner whatever the slide costs.
So the knob buys character almost for free; what it must not be turned past is
the point where the car stops being placeable, which is a thing to feel on a
phone rather than to read off a number.

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

**Nothing on these courses is solid except the scenery.** The `solids` lists are
empty: the rocks, pines, machinery and salt pillars that used to line the roads
are drawn now and nothing else. They were never chicanes — they sat on the
shoulder to punish running wide — but a car that clips one stops *dead*, and in a
game with no brake and no reverse that is a much bigger penalty than the mistake
deserved. The shoulder already punishes running wide by being slow, and the
scenery past it is solid by construction, so the course still ends where it looks
like it ends. `tracks.test.ts` keeps checking that no box sits on the racing line;
with no boxes it passes trivially, and it is there for whoever adds one back.

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

**The control is a joystick: point it where you want to go, and the car goes
there.** That is a reversal, and the reasoning it reversed is worth keeping,
because it was good reasoning that turned out to be wrong about people.

The argument for a wheel was that a car can only turn *relative to its own
heading*, which is exactly what the simulation consumes, whereas a heading
control means something different every second on a course that keeps changing
compass direction — "up-left" is not a place. Two versions were built on it: a
small dial in a corner (full lock 78 px away, so every input was near full lock
and the car darted), then the whole lower band as a rotary wheel you turned with
your thumb.

Both worked and neither was *played*. A wheel is a control you have to translate:
it asks which way to turn, relative to a heading you are also tracking, while
the corner arrives. A stick asks where you want to go, and everyone already knows
the answer to that. The translating still has to happen — it just belongs in
`stickSteer.ts`, sixty times a second, rather than in the player's head.

**The steering request is proportional to the heading error, never a direction.**
This is what the analogue axis (`steerBits`) was always for. Full lock while the
car is pointing somewhere else, tapering to nothing as it comes round: the
correction shrinks with the error, so the car settles on the line instead of
oversteering past it and being caught. Asking for full lock right up to the
instant of alignment is how a heading control turns into a car that fights you —
the same failure Tank Trouble's hull had with a bang-bang turn bit, and
`stickSteer.test.ts` pins the loop rather than either half of it, because neither
half looks wrong alone.

**The car's heading has to come from the predictor, not the snapshot**
(`predictor.ts:predictCarAngle`). A heading control subtracts two angles and the
snapshot's is a snapshot interval plus half a round trip old — up to half a
radian of swing at `TURN_RATE` that is already committed and not yet visible. Use
it and the stick asks for lock the car has spent, then unwinds it: the car hunts
either side of the line rather than sitting on it.

**And the stick has to be re-read every tick, not on pointer events.** Both sides
of that subtraction move, and the car's side moves whether or not your thumb
does. A request derived only from `onMove` is stale the moment it is made, and a
thumb held perfectly still would drive the car in a circle. `Controls.tsx`
resamples at 60 Hz, the same rate `bitInput` samples at.

**It also has to be *sent* every tick, not only when it changes** — and this one
cost a working game. `Controls.tsx` used to keep the last field it handed to the
sampler and skip the repeat, which is a cache of state `bitInput.releaseAll`
clears on blur, pagehide and `visibilitychange` without telling anybody. On a
phone that fires for reasons the player never sees, and steering is the one
control that never recovers from it: the request is proportional to the heading
error, so the moment the car settles on the line the value stops changing, and a
control that only speaks on a change has nothing left to say. Full lock, thumb
on the glass, car driving straight on for the rest of the race — and no error
anywhere, because every part in isolation was working.

Every touch pad in the repo had the same cache; `bitInput.ts` now carries the
rule, `setButton` is idempotent while held so re-asserting is free, and
`bitInput.test.ts` pins the recovery.

There is nothing to latch here, unlike the tank: no reverse gear and no throttle,
so a stick pointed behind the car is just a large error and the proportional law
already answers it with full lock the short way round.

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
| `client/public/boxart/dirt.png` | Lobby card | **Done.** `BoxArt.tsx` is the same `<img>` every other game's card is. |
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
