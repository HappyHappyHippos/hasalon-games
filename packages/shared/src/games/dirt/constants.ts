/**
 * Dirt Racing tuning.
 *
 * Feel is a one-line change here, not a sim-logic change — same contract as
 * `tanks/constants.ts`. Two numbers decide almost everything about how the game
 * plays and are worth understanding before touching the rest: `TRACK_GRIP` (how
 * slippery) and `TRACK_TOP_SPEED` (how fast). Everything below them is derived
 * from a lap taking roughly ten seconds.
 */

import { seconds } from '../../engine';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

/**
 * The arena, in arena units — the resolution every track's centreline, solid
 * box and backdrop painting is authored against.
 *
 * Wider than Tank Trouble's 1280×720 on purpose: a racing line needs sweeping
 * curves rather than corridors, and 16:9 at this size fits a loop with real
 * straights on it without the corners becoming hairpins by accident.
 */
export const ARENA_W = 1600;
export const ARENA_H = 900;

/** Car hull radius. Collision is a circle; the sprite is drawn longer than wide. */
export const CAR_R = 19;

/**
 * How far past the edge of the racing surface you can still drive, before the
 * scenery starts.
 *
 * **This number is the reason the game has no shortcuts nobody intended.** The
 * drivable world is the track plus this shoulder either side of it and nothing
 * else — beyond it is solid. Without that, every track has a fatal exploit: the
 * infield of a loop is a couple of hundred units of grass, and cutting straight
 * across it at offroad speed beats driving half a lap at racing speed by a
 * distance. Closing that by hand means filling every infield with rocks and
 * hoping none of them left a gap; closing it structurally means one number.
 *
 * At 90 the shoulder is about two and a half car widths, which is enough to run wide
 * out of a corner, take to the grass to avoid a spun car, or cut the inside of
 * a bend and pay for it — all the things offroad is *for* — while never being
 * enough to leave the ribbon of the course.
 *
 * This is the *maximum*. Where two parts of the lap pass close to one another
 * the shoulder is narrowed automatically so their drivable ground never joins
 * up — see `track.ts:clampShoulders`.
 */
export const SHOULDER = 90;

/**
 * A strip of scenery this wide is always left between two parts of the lap that
 * pass near each other.
 *
 * Without it, the shoulder of the back straight and the shoulder of the front
 * straight meet somewhere in the infield, and the resulting patch of connected
 * grass is a shortcut across the middle of the map that nobody drew and no
 * amount of scattering rocks reliably closes.
 */
export const SCENERY_GAP = 44;

/**
 * How far apart in arc two bits of track have to be before the shoulder clamp
 * treats them as different parts of the lap.
 *
 * Below this they are the same corner seen twice — the two sides of a hairpin
 * are metres apart and hundreds of units of arc apart, and pinching the shoulder
 * there is right, but pinching it between a segment and its own neighbour
 * would narrow every straight to nothing.
 *
 * Comfortably above `PROGRESS_WINDOW` would be wrong too: what matters is
 * whether cutting the gap *saves time*, and at the ratio between offroad and
 * racing speed anything under a few hundred units of arc cannot.
 */
export const SHOULDER_ARC_SEP = 500;

/**
 * How finely a track's control points are resampled into the polyline that
 * collision and progress actually use.
 *
 * The centreline is authored as a handful of control points and smoothed with a
 * closed Catmull-Rom spline (`track.ts`), because hand-authoring a hundred
 * points that curve nicely is not a thing anyone should do twice. Eight
 * segments per control point puts a typical loop at ~130 segments, which is
 * fine enough that the polyline and the curve are within a unit of each other
 * everywhere.
 */
export const PATH_SUBDIVISIONS = 8;

/**
 * Bucket size and reach for the track's spatial index (`track.ts`).
 *
 * `nearestOnPath` is called for every car every tick — twice, for terrain and
 * for progress — so scanning every segment is the one thing here that would
 * actually show up in a profile. The index is exact rather than approximate:
 * a bucket holds every segment within `INDEX_REACH` of that bucket's rectangle,
 * so a hit closer than `INDEX_REACH` is provably the global nearest, and
 * anything further falls back to the full scan. See `nearestOnPath`.
 */
export const INDEX_CELL = 100;
export const INDEX_REACH = 220;

// ---------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------

/**
 * Top speed on the racing surface, in units per second.
 *
 * Down from 430, which was simply too fast to drive: at that speed a car turning
 * at `TURN_RATE` sweeps a circle of radius 134 units, which is wider than most
 * of the corners on these courses, so the car spent the whole lap unable to go
 * where it was pointed. Speed in a top-down racer is read from how quickly the
 * scenery goes past rather than from the number, and 300 across a 1600-unit
 * arena still crosses the map in five seconds.
 *
 * Eased again from 300 after a playtest: the courses are compact and a lap is
 * over quickly, so the top end was still arriving faster than a corner could be
 * read. The turning circle is now ~80 units, well inside every corner
 * `tracks.test.ts` allows — which is what makes the car feel like it is being
 * steered rather than aimed.
 */
export const TRACK_TOP_SPEED = 255;

/**
 * Top speed on grass, sand and dirt.
 *
 * Two thirds of the racing surface, up from a little over a third. The old
 * ratio made leaving the road feel like driving into glue — a mistake that took
 * a corner and a half to recover from, which is punishment rather than
 * consequence.
 *
 * Raising it does **not** reopen the shortcut problem, and it is worth being
 * precise about why: nothing about "is cutting worth it" is holding the courses
 * together. Two parts of a lap are never connected by drivable ground at all
 * (see `SHOULDER`), so the ratio only decides how much a corner cut costs, not
 * whether a lap can be skipped. That guarantee is structural and this number
 * cannot weaken it.
 */
export const OFFROAD_TOP_SPEED = 168;

/** ~0.6 s from a standing start to full speed. Cars accelerate on their own. */
export const CAR_ACCEL = 420;
/** Coasting deceleration, used during the countdown and after finishing. */
export const CAR_DECEL = 500;
/**
 * How fast speed carried onto grass bleeds away.
 *
 * Harsher than `CAR_DECEL` — leaving the road should feel like leaving the road
 * — but no longer brutal. Separate from deceleration so that "I lifted off" and
 * "I left the road" are not the same event.
 */
export const OFFROAD_BLEED = 560;

/** Radians per second at full lock and full authority. */
export const TURN_RATE = 3.2;

/**
 * How fast the steering itself moves toward what the player is asking for, in
 * lock-fractions per second.
 *
 * The car has a virtual front wheel that eases toward the input rather than
 * snapping to it, which is most of the difference between "twitchy" and
 * "planted". It matters most on a keyboard, where the input is instantly full
 * lock and the car would otherwise change direction in a single tick; on the
 * touch wheel the thumb is already smooth and this mostly stops a flick from
 * being a spin.
 *
 * At 7 a full sweep from one lock to the other takes about 0.29 s — slow enough
 * to have weight, fast enough that a correction mid-corner still lands.
 */
export const STEER_RATE = 7;
/**
 * Speed at which steering reaches full authority.
 *
 * Below this the car turns proportionally less, which makes a slow corner exit
 * feel heavy. Well under `TRACK_TOP_SPEED`, so ordinary racing is always at
 * full authority — this only shapes the bottom of the range.
 */
export const TURN_FULL_SPEED = 120;

/**
 * The least steering a car has, however slowly it is going.
 *
 * **Without a floor here the car has a deadlock**, and it is not a rare one.
 * Nose a car into a rock: the wall kills its forward speed, turn authority is
 * proportional to that speed, so it cannot steer; it cannot steer, so the
 * automatic throttle drives it straight back into the rock. Measured on The
 * Quarry before this existed, a single car spent 58% of a lap in contact and
 * sat motionless against one obstacle for thirteen seconds — the stuck-recovery
 * was firing seventy-odd times a race, which is the safety net doing the
 * driving.
 *
 * A real car can turn its wheels at a crawl, and so can this one. The car still
 * cannot pivot on the spot at any useful rate, and a slow corner still feels
 * heavy, because a third of `TURN_RATE` is not much — it is just enough to get
 * the nose off the wall and let the throttle do the rest.
 */
export const MIN_TURN_AUTHORITY = 0.32;

/**
 * Lateral grip: how quickly sideways velocity bleeds off, per second.
 *
 * **This is the drift knob.** The car's velocity is decomposed against its old
 * heading, the heading is rotated, and the velocity is recomposed against the
 * new one — so the car keeps travelling the way it was pointed a moment ago and
 * this number decides how long for. Higher is grippier and duller; lower slides
 * for longer and eventually becomes uncontrollable. At 5.5 the sideways
 * component has a ~180 ms half-life, which is a car that rotates into a corner
 * and washes out of it.
 */
export const TRACK_GRIP = 5.5;
/** Grass is slidier as well as slower — a corner cut punishes twice. */
export const OFFROAD_GRIP = 3.1;

/**
 * How much forward speed a sideways slide scrubs off, per unit of lateral
 * speed, per second.
 *
 * **This is the brake pedal.** There is no brake pedal, which sounds like a
 * simplification and is actually a hard constraint: a car doing
 * `TRACK_TOP_SPEED` and turning at `TURN_RATE` sweeps a circle of radius
 * `430 / 3.2 ≈ 134` units, so without this every corner tighter than that is
 * one no car can physically take — it simply drives into the outside wall,
 * every lap, forever. Measured before this existed, a lap of Canyon Run took
 * 102 seconds and a lap of Salt Flat took 6.4, and the only difference between
 * them was how tight the corners were.
 *
 * Scrubbing speed in proportion to how sideways the car is fixes it the way an
 * arcade racer always has: turn in, the tyres wash, the car slows itself into
 * the corner and drives out the other side. It also makes drifting a skill
 * rather than a decoration — a tidy drift loses less than a full slide, because
 * a tidy drift has less lateral speed to pay for.
 */
export const CORNER_DRAG = 1.05;

/**
 * Sideways speed at which the car is considered to be drifting.
 *
 * Cosmetic only — skid marks, dust and the drift flag in the snapshot. Nothing
 * in the physics branches on it, so raising it cannot change how the car
 * handles, only how much it looks like it is working.
 */
export const DRIFT_THRESHOLD = 70;

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

/**
 * How bouncy a solid object is. Well under 1 — a rock should cost you the
 * corner, not fire you back across the track.
 */
export const WALL_RESTITUTION = 0.28;
/** Fraction of speed kept after scraping a solid. */
export const WALL_SCRUB = 0.55;

/**
 * How hard cars shove each other.
 *
 * 1 is a clean elastic swap of the closing velocity; above it, contact adds
 * energy, which is what makes a deliberate ram feel like a move rather than an
 * accident. Kept modest — pushing should win you a corner, not delete a rival.
 */
export const BUMP_RESTITUTION = 1.15;
/** Minimum closing speed that counts as a bump worth a sound and a spark. */
export const BUMP_EVENT_SPEED = 120;
/** Passes of shove-apart / resolve-solids per tick. See `WALL_SEPARATE_PASSES` in tanks. */
export const CONTACT_PASSES = 4;

// ---------------------------------------------------------------------------
// Never permanently stuck
// ---------------------------------------------------------------------------

/**
 * Below this speed a racing car is considered to be going nowhere.
 *
 * Cars accelerate on their own, so the only ways to sit still are to be nosed
 * into a rock, wedged against the arena edge, or pinned by someone else — all
 * of which are recoverable and none of which the player can fix, because there
 * is no reverse gear to fix them with.
 */
export const STUCK_SPEED = 42;
/** How long that has to last before the car is put back on the track. */
export const STUCK_TICKS = seconds(1.4);
/**
 * Grace after a recovery during which the car cannot collide with other cars.
 *
 * Without it a car recovered inside a scrum is instantly shoved back into the
 * scenery and re-enters the stuck timer, which reads as the recovery not
 * working. Solids still stop it — the recovery puts it on the centreline, where
 * there are none.
 */
export const RESPAWN_GHOST_TICKS = seconds(1.2);

// ---------------------------------------------------------------------------
// Progress, laps and checkpoints
// ---------------------------------------------------------------------------

/**
 * Roughly how far apart checkpoints sit along the centreline.
 *
 * Checkpoints here are a *view* of continuous progress rather than gates the
 * sim tests against — see `sim.ts:advanceProgress`. That is what makes them
 * impossible to skip and impossible to disagree with the lap counter.
 */
export const CHECKPOINT_SPACING = 420;

/**
 * How far either way along the lap progress is allowed to look for the car.
 *
 * Progress projects the car onto the centreline, and it does so *near where the
 * car already was* rather than globally — see `track.ts:nearestNear` for why a
 * global nearest breaks every hairpin. A car covers ~7 units a tick, so this is
 * two orders of magnitude more room than movement needs; the width is for the
 * legitimate case where the projection runs ahead of the car, which is what
 * cutting the inside of a bend does.
 */
export const PROGRESS_WINDOW = 420;

/**
 * The same window, widened, for putting a stuck car back on the track.
 *
 * A car that has to be recovered has usually been shoved somewhere strange, so
 * the search has to reach further than the one that runs every tick — but still
 * not globally, or a car wedged at a hairpin gets put back on the wrong leg and
 * facing the wrong way.
 */
export const RESPAWN_WINDOW = 900;

/**
 * The largest jump in projected track position accepted as real movement, in
 * units per tick.
 *
 * Belt and braces behind `PROGRESS_WINDOW`: the windowed search makes a
 * half-lap flip impossible in the first place, and this catches whatever is
 * left — a car teleported by a recovery, or one shoved clean across the infield
 * by a scrum. Generous next to the ~7 units a car covers, because a projection
 * legitimately outruns the car on the inside of a bend.
 */
export const MAX_PROGRESS_JUMP = 90;

/**
 * How far behind the start line the grid is laid out, and how far apart.
 *
 * Two columns, staggered, so eight cars fit into a normal-width track without
 * anyone starting on the grass.
 */
export const GRID_ROW_GAP = 74;
export const GRID_COLUMN_OFFSET = 0.42;

// ---------------------------------------------------------------------------
// Powerups
// ---------------------------------------------------------------------------

/** Pad radius, and how long a pad takes to grow a new powerup after being taken. */
export const PAD_R = 26;
export const PAD_RESPAWN_TICKS = seconds(6);

/** Speed: a short, unmistakable shove. */
export const BOOST_TICKS = seconds(2.4);
export const BOOST_SPEED_MUL = 1.55;
export const BOOST_ACCEL_MUL = 2.4;
/** Boost holds the car together as well as pushing it, or it is unusable in a corner. */
export const BOOST_GRIP_MUL = 1.35;

/** Landmine: dropped behind, arms shortly after, spins whoever touches it. */
export const MINE_R = 20;
export const MINE_DROP_BACK = CAR_R + 16;
export const MINE_ARM_TICKS = seconds(0.5);
export const MINE_LIFE_TICKS = seconds(30);

/** Spin-out: what a mine does to you. */
export const SPIN_TICKS = seconds(1.5);
/** Radians per second while spun out — fast enough to read as a loss of control. */
export const SPIN_RATE = 9.5;

/**
 * Reverse: everyone else's steering swaps for this long.
 *
 * Long enough to cost the leader a corner, short enough that it is a moment
 * rather than a punishment. The car it is used on keeps full speed and full
 * grip — it is a *control* effect, not a slow, so a good driver can still nurse
 * a reversed car round a bend and that is the skill it tests.
 */
export const REVERSE_TICKS = seconds(4.5);

// ---------------------------------------------------------------------------
// Race flow
// ---------------------------------------------------------------------------

export const COUNTDOWN_TICKS = seconds(3.5);
export const RACE_OVER_TICKS = seconds(4);

/**
 * Points by finishing position, best first.
 *
 * Front-loaded but not winner-take-all: the gap between first and second is one
 * place's worth, so a bad race is recoverable and the last race still decides
 * the match. Positions past the end of the list score nothing.
 */
export const POSITION_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

/**
 * Hard ceiling on a race, per lap.
 *
 * A clean lap takes about ten seconds and a scrappy one perhaps twenty, so this
 * is several times what anybody needs. It is not a race clock the players are
 * meant to feel — it is the guarantee that the match ends even if something
 * upstream goes wrong. When it expires the field is placed on the progress it
 * managed, exactly as it is for anyone still out when the winner's grace runs
 * out.
 */
export const RACE_LIMIT_PER_LAP = seconds(45);

export const DEFAULT_LAPS = 3;
export const DEFAULT_RACES = 3;
