/**
 * How long between pressing a button and seeing your own character react.
 *
 * This is the half of "lag" that prediction exists to remove, and the one that
 * is easiest to regress without noticing: everything still *looks* smooth,
 * because the fault is only ever on the screen of the person holding the
 * controller. Nobody else runs this code.
 *
 * The measurement runs two complete simulations of the same match — one where
 * the button is pressed, one where it is not — and reports the first frame on
 * which the drawn body differs. Doing it that way avoids having to know what
 * "reacting" looks like in each game: it is simply the moment your character
 * stops doing what it would have done anyway.
 *
 * The server only learns about the press one one-way delay later, so without
 * prediction the answer is a full round trip plus however long until the next
 * snapshot. With it, the answer should be a frame or two, no matter how far
 * away the server is — that is the entire claim, and it is what makes a
 * 114 ms link playable.
 */
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_EVERY, TICK_MS } from '@mg/shared';
// Namespace imports: every game exports the same symbol names.
import * as gm from '@mg/shared/gunmayhem';
import * as tk from '@mg/shared/tanks';
import { gmInput } from '../games/gunmayhem/input';
import { tanksInput } from '../games/tanks/input';
import { GunMayhemPredictor } from '../games/gunmayhem/predictor';
import { TanksPredictor } from '../games/tanks/predictor';
import { CELLULAR, NEARBY, type Link, type Point } from './lagHarness';

const TICKS = 150;
/** The press happens here, well clear of the countdown and of startup. */
const PRESS_TICK = 40;
/** Anything smaller than this is not a reaction, it is float noise. */
const MOVED = 0.5;

interface Probe {
  name: string;
  /** Bits held before the press, and after it. */
  idle: number;
  press: number;
  /**
   * Run one whole match and return the body drawn on each tick, or null on the
   * ticks the server owned it.
   *
   * @param pressed whether the button is ever pressed at all
   * @param predict whether the client predicts, or just follows the server
   */
  run(link: Link, pressed: boolean, predict: boolean): Array<Point | null>;
}

/**
 * The shape every probe shares: a server ticking at 60 Hz that only sees input
 * after one one-way delay, snapshots every other tick that take another
 * one-way delay to arrive, and a client drawing from the newest one that has.
 */
function drive<S, B extends Point>(options: {
  link: Link;
  pressed: boolean;
  predict: boolean;
  idle: number;
  press: number;
  /** Apply an input the server has just received. */
  serverApply: (seq: number, bits: number) => void;
  step: () => void;
  snapshot: () => S;
  /** Record the client's own copy of an input, for replay. */
  record: (seq: number, bits: number, at: number) => void;
  /** Predict from the newest arrived snapshot, or follow it verbatim. */
  draw: (now: number, snap: S, predict: boolean) => B | null;
}): Array<Point | null> {
  const { link, pressed, predict, idle, press } = options;
  const arrivals: Array<{ snap: S; at: number }> = [];
  const inFlight: Array<{ seq: number; bits: number; arrivesAt: number }> = [];
  const drawn: Array<Point | null> = [];

  for (let tick = 0; tick < TICKS; tick++) {
    const now = tick * TICK_MS;
    const bits = pressed && tick >= PRESS_TICK ? press : idle;

    // The client samples and sends every tick; the server gets it later.
    options.record(tick + 1, bits, now);
    inFlight.push({ seq: tick + 1, bits, arrivesAt: now + link.oneWayMs });

    while (inFlight.length > 0 && inFlight[0]!.arrivesAt <= now) {
      const packet = inFlight.shift()!;
      options.serverApply(packet.seq, packet.bits);
    }

    options.step();
    if (tick % SNAPSHOT_EVERY === 0) {
      arrivals.push({ snap: options.snapshot(), at: now + link.oneWayMs });
    }

    let newest: S | null = null;
    for (const arrival of arrivals) if (arrival.at <= now) newest = arrival.snap;
    drawn.push(newest ? options.draw(now, newest, predict) : null);
  }

  return drawn;
}

// ---------------------------------------------------------------------------

const gunMayhem: Probe = {
  name: 'Gun Mayhem',
  idle: 0,
  press: gm.IN_RIGHT,
  run(link, pressed, predict) {
    const level = gm.getLevel('candyland');
    const state = gm.createState(
      [
        { id: 'p0', name: 'P0', colorIndex: 0 },
        { id: 'p1', name: 'P1', colorIndex: 1 },
      ],
      { ...gm.defaultConfig(), levelId: 'candyland' },
      7,
    );
    for (let i = 0; i < gm.COUNTDOWN_TICKS; i++) gm.stepTick(state);

    gmInput.reset();
    gmInput.seq = 0;
    const predictor = new GunMayhemPredictor();

    return drive({
      link,
      pressed,
      predict,
      idle: this.idle,
      press: this.press,
      serverApply: (seq, bits) => gm.applyInput(state, 'p0', seq, bits),
      step: () => gm.stepTick(state),
      snapshot: () => gm.makeSnapshot(state, []) as gm.GunMayhemSnapshot,
      record: (seq, bits, at) => gmInput.history.push({ seq, bits, at }),
      draw: (now, snap, withPrediction) => {
        const me = snap.players.find((p) => p.s === 0);
        if (!me) return null;
        if (!withPrediction) return { x: me.x, y: me.y };
        return predictor.update(now, level, me, snap.phase === 'playing');
      },
    });
  },
};

const tanks: Probe = {
  name: 'Tank Trouble',
  idle: 0,
  press: tk.IN_FWD,
  run(link, pressed, predict) {
    const state = tk.createState(
      [
        { id: 'p0', name: 'P0', colorIndex: 0 },
        { id: 'p1', name: 'P1', colorIndex: 1 },
      ],
      tk.defaultConfig(),
      11,
    );
    // Past the countdown: outside the playing phase every button is ignored, on
    // the server and in the predictor alike, so a press there moves nothing.
    for (let i = 0; i < tk.COUNTDOWN_TICKS; i++) tk.stepTick(state);
    const maze = state.maze;

    tanksInput.reset();
    tanksInput.seq = 0;
    const predictor = new TanksPredictor();

    return drive({
      link,
      pressed,
      predict,
      idle: this.idle,
      press: this.press,
      serverApply: (seq, bits) => tk.applyInput(state, 'p0', seq, bits),
      step: () => tk.stepTick(state),
      snapshot: () => tk.makeSnapshot(state, []) as tk.TanksSnapshot,
      record: (seq, bits, at) => tanksInput.history.push({ seq, bits, at }),
      draw: (now, snap, withPrediction) => {
        const me = snap.players.find((p) => p.s === 0);
        if (!me) return null;
        if (!withPrediction) return { x: me.x, y: me.y };
        return predictor.update(now, maze, me, snap.phase === 'playing');
      },
    });
  },
};

const PROBES = [gunMayhem, tanks];

/** Ticks between the press and the first frame that shows it. */
function reactionTicks(probe: Probe, link: Link, predict: boolean): number | null {
  const pressed = probe.run(link, true, predict);
  const idle = probe.run(link, false, predict);

  for (let tick = PRESS_TICK; tick < TICKS; tick++) {
    const a = pressed[tick];
    const b = idle[tick];
    if (!a || !b) continue;
    if (Math.hypot(a.x - b.x, a.y - b.y) > MOVED) return tick - PRESS_TICK;
  }
  return null;
}

describe('input latency', () => {
  it('shows your own press immediately, however far away the server is', () => {
    const results = PROBES.map((probe) => ({
      name: probe.name,
      predicted: reactionTicks(probe, CELLULAR, true),
      followed: reactionTicks(probe, CELLULAR, false),
      nearby: reactionTicks(probe, NEARBY, false),
    }));

    for (const r of results) {
      const ms = (t: number | null) => (t === null ? 'never' : `${(t * TICK_MS).toFixed(0)}ms`);
      console.log(
        `${r.name.padEnd(14)} press to pixel — predicted ${ms(r.predicted).padStart(6)}  ` +
          `server-only ${ms(r.followed).padStart(6)}  (server-only on a nearby box ${ms(r.nearby)})`,
      );
    }

    for (const r of results) {
      expect(r.predicted, `${r.name}: prediction never reacted`).not.toBeNull();
      expect(r.followed, `${r.name}: server-only never reacted`).not.toBeNull();

      // Two ticks. The press is sampled on the tick it happens and the body is
      // drawn from the replay on the same frame, so this is as close to
      // instant as a 60 Hz sample allows.
      expect(r.predicted!, r.name).toBeLessThanOrEqual(2);

      // And it has to be prediction doing it, not the link being kind. Without
      // prediction the same press costs a round trip plus the wait for the next
      // snapshot.
      expect(r.followed!, r.name).toBeGreaterThan(r.predicted! + 4);
    }
  });

  it('costs the same on a distant server as on a near one', () => {
    // The point of replaying unacknowledged input by sequence: the answer must
    // not depend on the round trip at all. If this ever starts scaling with
    // distance, prediction has quietly stopped working and the game will feel
    // fine in testing and awful in Israel.
    for (const probe of PROBES) {
      const near = reactionTicks(probe, NEARBY, true);
      const far = reactionTicks(probe, CELLULAR, true);
      expect(near, probe.name).not.toBeNull();
      expect(far, probe.name).not.toBeNull();
      expect(Math.abs(far! - near!), probe.name).toBeLessThanOrEqual(1);
    }
  });
});
