/**
 * Does each game still feel right on the link the players actually have?
 *
 * Every real-time game gets the same three questions asked of it, over a
 * simulated EU-West-to-Israel connection with the jitter and loss a phone on
 * cellular sees. The sims are real, the snapshot cadence is real, and the draw
 * path is the one the renderer uses — so a threshold that moves here is a
 * threshold that moved on screen.
 *
 * The point of the file is that "it lags" is three different faults:
 *
 * 1. **Stutter** — a remote body moving in per-snapshot lurches instead of at a
 *    steady rate. Sampled at 144 Hz, because at 60 Hz one tick and one frame
 *    cover the same ground and the fault is invisible.
 * 2. **Tracking** — how far the drawn position is from where the server really
 *    had them. Extrapolating trades a little of this for a lot of (1).
 * 3. **Freeze** — what a run of lost snapshots looks like: coasting and
 *    rejoining, or stopping dead and teleporting.
 *
 * Tank Trouble failed (1) outright before `RemoteBodies`
 * existed — a remote runner stepped up to 19 units in a frame where smooth
 * motion is 4.
 */
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_EVERY, TICK_MS } from '@mg/shared';
import { RemoteBodies } from '../game/RemoteBodies';
// Namespace imports on purpose: every game exports `createState`, `stepTick`,
// `makeSnapshot` and friends under the same names, so named imports from more
// than one of them cannot coexist in a file.
import * as gm from '@mg/shared/gunmayhem';
import * as tk from '@mg/shared/tanks';
import * as gmAdvance from '../games/gunmayhem/advance';
import * as tkPredictor from '../games/tanks/predictor';
import {
  CELLULAR,
  WIFI,
  newestBy,
  rng,
  ship,
  type Arrival,
  type Link,
  type Point,
} from './lagHarness';

/** A body far enough into the round that nothing is still starting up. */
const FROM_TICK = 60;
const TICKS = 420;
const FPS = 144;
/** The seat being watched. Seat 0 drives, seat 1 is the one drawn remotely. */
const SEAT = 1;

/**
 * One game, reduced to what the harness needs: run the server, and draw a
 * remote body from whatever has arrived.
 */
interface Scenario {
  name: string;
  arrivals: Array<Arrival<unknown>>;
  /** Where the server truly had `SEAT` at this instant. */
  truth(now: number): Point | null;
  /** Where the renderer would draw them, smoothing exactly as it does. */
  draw(now: number, remotes: RemoteBodies): Point | null;
  /**
   * Whether the body is in steady locomotion at this instant — on the ground,
   * alive, not falling.
   *
   * The stutter measurement needs it. A Gun Mayhem character who runs off the
   * edge accelerates downward under gravity, so its per-frame travel genuinely
   * grows by a factor of several; counting those frames measures free fall
   * rather than smoothness. Only stretches where this holds on both sides of a
   * frame boundary are scored.
   */
  steady(now: number): boolean;
  /**
   * How far a smoothed step may exceed the mean per-frame motion.
   *
   * Not zero, and not the same for every game: a gravity flip or a tank hitting
   * a wall is a real event that is deliberately snapped to rather than slid
   * into (see `RemoteBodies`), so a genuinely correct draw still has occasional
   * large frames. What must not happen is a *routine* lurch every snapshot.
   */
  stutterBudget: number;
}

// ---------------------------------------------------------------------------
// Gun Mayhem
// ---------------------------------------------------------------------------

function gunMayhem(link: Link, seed: number): Scenario {
  const level = gm.getLevel('candyland');
  const state = gm.createState(
    [
      { id: 'p0', name: 'P0', colorIndex: 0 },
      { id: 'p1', name: 'P1', colorIndex: 1 },
    ],
    { ...gm.defaultConfig(), levelId: 'candyland' },
    seed,
  );
  for (let i = 0; i < gm.COUNTDOWN_TICKS; i++) gm.stepTick(state);

  const authored: Array<{ snap: unknown; serverAt: number }> = [];
  const truth: Point[] = [];
  let seq = 0;

  for (let tick = 0; tick < TICKS; tick++) {
    // Held in one direction, deliberately. Stutter is about ordinary drift —
    // the small amount extrapolation gets wrong between snapshots — and a
    // scenario full of direction changes measures something else, because a
    // reversal is a velocity event that `RemoteBodies` snaps to on purpose.
    // Event handling is pinned in `RemoteBodies.test.ts` instead.
    const bits = gm.IN_RIGHT;
    gm.applyInput(state, 'p1', ++seq, bits);
    gm.stepTick(state);

    const player = state.players.find((p) => p.seat === SEAT)!;
    truth.push({ x: player.x, y: player.y });
    if (tick % SNAPSHOT_EVERY === 0) {
      authored.push({ snap: gm.makeSnapshot(state, []), serverAt: tick * TICK_MS });
    }
  }

  const arrivals = ship(authored, link, rng(seed));

  const bodyAt = (now: number) => {
    const newest = newestBy(arrivals, now);
    if (!newest) return null;
    const snap = newest.snap as import('@mg/shared/gunmayhem').GunMayhemSnapshot;
    const player = snap.players.find((p) => p.s === SEAT);
    if (!player) return null;
    const body = gmAdvance.advancePlayer(
      player,
      level,
      gmAdvance.ticksBehind(now, newest.serverAt),
      snap.phase === 'playing',
    );
    return body ? { body, player } : null;
  };

  return {
    name: 'Gun Mayhem',
    arrivals,
    truth: (now) => truth[Math.round(now / TICK_MS)] ?? null,
    steady(now) {
      const newest = newestBy(arrivals, now);
      if (!newest) return false;
      const snap = newest.snap as import('@mg/shared/gunmayhem').GunMayhemSnapshot;
      const player = snap.players.find((p) => p.s === SEAT);
      return !!player && player.g === 1 && player.rt <= 0 && player.k > 0;
    },
    draw(now, remotes) {
      const found = bodyAt(now);
      if (!found) return null;
      const newest = newestBy(arrivals, now)!;
      remotes.beginFrame(newest.serverAt);
      return remotes.draw(
        SEAT,
        found.body.x,
        found.body.y,
        { vx: found.player.vx, vy: found.player.vy },
        now,
      );
    },
    stutterBudget: 6,
  };
}

// ---------------------------------------------------------------------------
// Tank Trouble
// ---------------------------------------------------------------------------

function tanks(link: Link, seed: number): Scenario {
  const config = tk.defaultConfig();
  const state = tk.createState(
    [
      { id: 'p0', name: 'P0', colorIndex: 0 },
      { id: 'p1', name: 'P1', colorIndex: 1 },
    ],
    config,
    seed,
  );
  const maze = state.maze;

  const authored: Array<{ snap: unknown; serverAt: number }> = [];
  const truth: Point[] = [];
  let seq = 0;

  for (let tick = 0; tick < TICKS; tick++) {
    // Throttle and a constant turn: a steady arc that stays inside the maze.
    const bits = tk.IN_FWD | tk.IN_TLEFT;
    tk.applyInput(state, 'p1', ++seq, bits);
    tk.stepTick(state);

    const player = state.players.find((p) => p.seat === SEAT)!;
    truth.push({ x: player.x, y: player.y });
    if (tick % SNAPSHOT_EVERY === 0) {
      authored.push({ snap: tk.makeSnapshot(state, []), serverAt: tick * TICK_MS });
    }
  }

  const arrivals = ship(authored, link, rng(seed));

  return {
    name: 'Tank Trouble',
    arrivals,
    truth: (now) => truth[Math.round(now / TICK_MS)] ?? null,
    // A tank has no airborne state; if it is alive it is driving.
    steady(now) {
      const newest = newestBy(arrivals, now);
      if (!newest) return false;
      const snap = newest.snap as import('@mg/shared/tanks').TanksSnapshot;
      return snap.players.find((p) => p.s === SEAT)?.al === 1;
    },
    draw(now, remotes) {
      const newest = newestBy(arrivals, now);
      if (!newest) return null;
      const snap = newest.snap as import('@mg/shared/tanks').TanksSnapshot;
      const player = snap.players.find((p) => p.s === SEAT);
      if (!player) return null;
      const body = tkPredictor.advanceTank(
        player,
        maze,
        tkPredictor.ticksBehind(now, newest.serverAt),
        snap.phase === 'playing',
      );
      if (!body) return null;
      remotes.beginFrame(newest.serverAt);
      return remotes.draw(
        SEAT,
        body.x,
        body.y,
        { vx: Math.cos(body.angle) * body.speed, vy: Math.sin(body.angle) * body.speed },
        now,
      );
    },
    stutterBudget: 6,
  };
}

const BUILDERS = [gunMayhem, tanks];

/** Per-game event thresholds, matching what each renderer constructs. */
const THRESHOLD: Record<string, number> = {
  'Gun Mayhem': 260,
  'Tank Trouble': 90,
};

function windowMs(): { fromMs: number; toMs: number } {
  return { fromMs: FROM_TICK * TICK_MS, toMs: TICKS * TICK_MS };
}

/**
 * The stutter statistic: the worst frame against the average one.
 *
 * Only meaningful because the scenarios hold a steady input. A body moving at a
 * constant rate should advance the same distance every frame, so anything above
 * about 1 is a correction being paid for in a single frame — which is exactly
 * what a missing smoother produces, once per snapshot, forever.
 */
function stutterRatio(deltas: number[]): number {
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return mean > 0 ? Math.max(...deltas) / mean : Infinity;
}

function frameDeltas(scenario: Scenario, remotes: RemoteBodies, fps: number): number[] {
  const { fromMs, toMs } = windowMs();
  const frameMs = 1000 / fps;
  const deltas: number[] = [];
  let previous: Point | null = null;

  for (let now = fromMs; now < toMs; now += frameMs) {
    // The smoother is stateful, so it must be driven on every frame — skipping
    // the unsteady ones would hand it a discontinuous view of time.
    const point = scenario.draw(now, remotes);
    const steady = point !== null && scenario.steady(now);
    if (!steady) {
      previous = null;
      continue;
    }
    if (previous) deltas.push(Math.hypot(point!.x - previous.x, point!.y - previous.y));
    previous = point;
  }

  if (deltas.length < 100) throw new Error(`${scenario.name}: only ${deltas.length} steady frames`);
  return deltas;
}

describe('remote playback across every real-time game', () => {
  it('draws other players at a steady rate rather than stepping once a snapshot', () => {
    const results = BUILDERS.map((build) => {
      const scenario = build(CELLULAR, 20260807);

      // Smoothed, as shipped.
      const smoothed = new RemoteBodies(THRESHOLD[scenario.name]!);
      const withSmoothing = stutterRatio(frameDeltas(scenario, smoothed, FPS));

      // And with smoothing off, which is what Tank Trouble
      // actually shipped. A threshold of -1 classifies every step as an event,
      // so nothing is ever absorbed — the behaviour being replaced.
      const never = new RemoteBodies(-1);
      const without = stutterRatio(frameDeltas(scenario, never, FPS));

      return { name: scenario.name, withSmoothing, without };
    });

    // Report every game before asserting, so one regression does not hide the
    // other two.
    for (const r of results) {
      console.log(
        `${r.name.padEnd(14)} @${FPS}Hz cellular  worst frame / mean frame  ` +
          `unsmoothed ${r.without.toFixed(2)}  smoothed ${r.withSmoothing.toFixed(2)}`,
      );
    }

    for (const r of results) {
      // Exponential absorption cannot be flat: the frame that takes the
      // correction moves barely at all and the ones after it carry normal
      // travel plus what is left of the offset. Around 2-3x the mean is what
      // that costs. Unsmoothed runs 7-10x, so this is a wide, meaningful gap.
      expect(r.withSmoothing, r.name).toBeLessThan(3.5);
      // And the smoother must be doing the work, not the scenario being easy.
      expect(r.withSmoothing, r.name).toBeLessThan(r.without / 2);
    }
  });

  it('keeps the drawn position close to where the server really had them', () => {
    const results = BUILDERS.map((build) => {
      const scenario = build(WIFI, 991);
      const remotes = new RemoteBodies(THRESHOLD[scenario.name]!);

      const errors: number[] = [];
      const { fromMs, toMs } = windowMs();
      for (let now = fromMs; now < toMs; now += TICK_MS) {
        const drawn = scenario.draw(now, remotes);
        const actual = scenario.truth(now);
        if (drawn && actual && scenario.steady(now)) {
          errors.push(Math.hypot(drawn.x - actual.x, drawn.y - actual.y));
        }
      }
      expect(errors.length, scenario.name).toBeGreaterThan(100);
      return { name: scenario.name, mean: errors.reduce((a, b) => a + b, 0) / errors.length };
    });

    for (const r of results) {
      console.log(`${r.name.padEnd(14)} tracking error mean ${r.mean.toFixed(1)}`);
    }

    // Interpolating instead would sit a whole buffer behind — on this link
    // about 90 ms of travel, which for a sprinting character is over 50 units.
    // Extrapolation should be comfortably inside that.
    for (const r of results) expect(r.mean, r.name).toBeLessThan(25);
  });

  it('coasts through a run of lost snapshots instead of freezing and teleporting', () => {
    const HOLE_MS = 250;

    const results = BUILDERS.map((build) => {
      // Build once to find a stretch where the body is actually going
      // somewhere. A tank that has driven into a wall, or a runner between
      // rounds, travels zero with or without a hole — punching one there proves
      // nothing. So the window is chosen from the truth rather than fixed.
      const probe = build({ oneWayMs: 57, jitterMs: 8, loss: 0 }, 5150);
      let holeFrom = -1;
      let truthTravel = 0;
      for (let start = FROM_TICK * TICK_MS; start < (TICKS - 40) * TICK_MS; start += 100) {
        let travel = 0;
        let ok = true;
        for (let t = start; t < start + HOLE_MS; t += TICK_MS) {
          const a = probe.truth(t);
          const b = probe.truth(t + TICK_MS);
          if (!a || !b || !probe.steady(t)) {
            ok = false;
            break;
          }
          travel += Math.hypot(b.x - a.x, b.y - a.y);
        }
        // 15 units in 250 ms. Low enough that a tank — top speed 135 u/s, so
        // ~34 units in the window even flat out — can clear it, and high enough
        // that a body idling against a wall cannot.
        if (ok && travel > 15) {
          holeFrom = start;
          truthTravel = travel;
          break;
        }
      }
      expect(holeFrom, `${probe.name}: no moving stretch to test`).toBeGreaterThan(0);

      // A 250 ms hole: eight consecutive snapshots gone, roughly what a
      // cellular handover does.
      const scenario = build({ oneWayMs: 57, jitterMs: 8, loss: 0 }, 5150);
      const holeTo = holeFrom + HOLE_MS;
      for (const arrival of scenario.arrivals) {
        if (arrival.serverAt >= holeFrom && arrival.serverAt < holeTo) arrival.at = Infinity;
      }

      // What the server actually covered over the whole observation window —
      // the hole plus the recovery after it. Comparing against travel over the
      // hole alone would make the ratio below flatter than it looks.
      const observedTo = holeTo + 400;
      let serverTravel = 0;
      for (let t = holeFrom; t < observedTo; t += TICK_MS) {
        const a = scenario.truth(t);
        const b = scenario.truth(t + TICK_MS);
        if (a && b) serverTravel += Math.hypot(b.x - a.x, b.y - a.y);
      }

      const remotes = new RemoteBodies(THRESHOLD[scenario.name]!);
      const steps: number[] = [];
      // `null` means the server owns the body outright — respawning, or out of
      // the round. Those frames break the series rather than joining across it:
      // stitching a pre-death position to a post-respawn one manufactures a
      // teleport nobody ever saw.
      let previous: Point | null = null;
      for (let now = holeFrom; now < observedTo; now += 1000 / FPS) {
        const point = scenario.draw(now, remotes);
        if (!point) {
          previous = null;
          continue;
        }
        if (previous) steps.push(Math.hypot(point.x - previous.x, point.y - previous.y));
        previous = point;
      }

      expect(steps.length, scenario.name).toBeGreaterThan(20);
      void truthTravel;
      return {
        name: scenario.name,
        serverTravel,
        travelled: steps.reduce((a, b) => a + b, 0),
        worst: Math.max(...steps),
      };
    });

    for (const r of results) {
      console.log(
        `${r.name.padEnd(14)} across a ${HOLE_MS}ms hole: server moved ${r.serverTravel.toFixed(0)}, ` +
          `drawn ${r.travelled.toFixed(0)}, worst frame ${r.worst.toFixed(1)}`,
      );
    }

    for (const r of results) {
      // It has to keep going. Extrapolation is capped at `MAX_ADVANCE_TICKS`,
      // so it will not cover the whole hole — but a body that stops dead and
      // then teleports is the "freeze then catch up" players report, and that
      // shows up here as travel near zero.
      expect(r.travelled, r.name).toBeGreaterThan(r.serverTravel * 0.7);
      // And the rejoin must be absorbed rather than jumped. This is what the
      // gap-scaled event threshold buys: without it a quarter second of
      // ordinary gravity looks exactly like a knockback, gets snapped to, and
      // the whole missing stretch lands in one frame.
      expect(r.worst, r.name).toBeLessThan(40);
    }
  });
});
