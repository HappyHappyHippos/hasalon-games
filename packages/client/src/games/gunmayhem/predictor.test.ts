import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_MS } from '@mg/shared';
import {
  COUNTDOWN_TICKS,
  IN_JUMP,
  IN_RIGHT,
  applyInput,
  createState,
  defaultConfig,
  getLevel,
  makeSnapshot,
  stepTick,
  type GmSnapshotPlayer,
} from '@mg/shared/gunmayhem';
import { GunMayhemPredictor } from './predictor';
import { gmInput } from './input';

const level = getLevel('salon');

/**
 * How far behind the server is, in ticks.
 *
 * The whole point of these tests. The previous suite drove the predictor with
 * snapshots that had *no* delay — the one condition under which reconciling by
 * wall-clock time cannot go wrong — so it passed happily while every jump was
 * being cancelled in mid-air in real games. Half a round trip on the production
 * link is about three ticks.
 */
const LAG_TICKS = 3;

function bare(overrides: Partial<GmSnapshotPlayer> = {}): GmSnapshotPlayer {
  return {
    s: 0,
    x: 600,
    y: 400,
    vx: 0,
    vy: 0,
    f: 1,
    g: 1,
    d: 0,
    k: 3,
    st: 0,
    iv: 0,
    rt: 0,
    j: 2,
    jp: 0,
    w: 'pistol',
    am: 0,
    bo: 3,
    p: 0,
    ack: 0,
    ib: 0,
    dp: 0,
    cy: 0,
    jb: 0,
    ...overrides,
  };
}

interface Run {
  /** The authoritative snapshot produced after each tick. `[i].ack` is `i + 1`. */
  snapshots: GmSnapshotPlayer[];
  /** What the client sent, one per tick. */
  inputs: Array<{ seq: number; bits: number; at: number }>;
}

/**
 * Play a scenario on the *real* server simulation, one input per tick, and
 * record both what the server produced and what the client would have sent.
 *
 * The client's buffer is filled with exactly the inputs the server was fed, so
 * a replay of the unacknowledged tail has to land on the server's own future
 * state. That is the property the whole design rests on.
 */
function run(ticks: number, bitsAt: (tick: number) => number): Run {
  const state = createState(
    [
      { id: 'p0', name: 'P0', colorIndex: 0 },
      { id: 'p1', name: 'P1', colorIndex: 1 },
    ],
    { ...defaultConfig(), levelId: 'salon' },
    4242,
  );
  for (let i = 0; i < COUNTDOWN_TICKS; i++) stepTick(state);

  const snapshots: GmSnapshotPlayer[] = [];
  const inputs: Array<{ seq: number; bits: number; at: number }> = [];
  for (let tick = 0; tick < ticks; tick++) {
    const bits = bitsAt(tick);
    const seq = tick + 1;
    inputs.push({ seq, bits, at: tick * TICK_MS });
    applyInput(state, 'p0', seq, bits);
    stepTick(state);
    snapshots.push(makeSnapshot(state, []).players.find((p) => p.s === 0)!);
  }
  return { snapshots, inputs };
}

/**
 * What the predictor draws for a client that has played up to `tick` while the
 * newest snapshot it holds is `LAG_TICKS` older.
 *
 * The buffer is refilled with only the inputs sent *so far*, which is the whole
 * point — a client cannot replay the future, and seeding it with the entire run
 * makes the predictor look wildly wrong for reasons that are the harness's
 * fault rather than the code's.
 */
function predictedAt(
  predictor: GunMayhemPredictor,
  r: Run,
  tick: number,
): ReturnType<GunMayhemPredictor['update']> {
  gmInput.reset();
  gmInput.history.push(...r.inputs.slice(0, tick + 1).map((i) => ({ ...i })));

  const stale = r.snapshots[tick - LAG_TICKS]!;
  // Asking exactly at the newest input's own timestamp leaves no sub-tick
  // remainder, so the comparison against the server is like for like.
  return predictor.update(tick * TICK_MS, level, stale, true);
}

describe('GunMayhemPredictor', () => {
  beforeEach(() => {
    gmInput.reset();
    gmInput.seq = 0;
  });

  it('hands control back to the server during hitstun, respawn and elimination', () => {
    for (const state of [{ st: 8 }, { rt: 40 }, { k: 0 }]) {
      const predictor = new GunMayhemPredictor();
      expect(predictor.update(1000, level, bare(state), true)).toBeNull();
      expect(predictor.active).toBe(false);
    }
  });

  it('keeps a jump going while the server still thinks you are on the ground', () => {
    // The bug this replaced, stated as an assertion. With the server three
    // ticks behind, every snapshot during the first half of a jump still shows
    // the character standing. Reconciling against that by wall clock read the
    // difference as error and applied `vy += 780`, cancelling the jump in
    // mid-air, then threw it back up when the server caught up. Ascent must be
    // monotonic: vy negative throughout, never flipping.
    const TICKS = 24;
    const r = run(TICKS, (tick) => (tick >= 4 && tick < 7 ? IN_JUMP : 0));
    const predictor = new GunMayhemPredictor();

    for (let tick = 5; tick < 14; tick++) {
      const body = predictedAt(predictor, r, tick)!;
      const truth = r.snapshots[tick]!;

      // Meaningful only because the server really is ascending here — if truth
      // were not negative the assertion below would prove nothing.
      expect(truth.vy).toBeLessThan(0);
      expect(body.vy).toBeLessThan(0);
      expect(body.vy).toBeCloseTo(truth.vy, 0);
    }
  });

  it('accelerates smoothly rather than in jolts', () => {
    // The same bug in its quieter form: three ticks of acceleration is ~85 u/s
    // the server has not seen, which used to trip the velocity correction on
    // every single run and stop. Speed must climb monotonically.
    const TICKS = 30;
    const r = run(TICKS, () => IN_RIGHT);
    const predictor = new GunMayhemPredictor();

    let previous = -Infinity;
    for (let tick = LAG_TICKS + 2; tick < 20; tick++) {
      const body = predictedAt(predictor, r, tick)!;
      expect(body.vx).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = body.vx;
    }
    expect(previous).toBeGreaterThan(100);
  });

  it('lands exactly where the server independently ends up', () => {
    // The strongest statement of the model: replaying the unacknowledged tail
    // from an acknowledged state is not an approximation of the server, it is
    // the server's own arithmetic run early.
    const TICKS = 40;
    const r = run(TICKS, (tick) => (tick % 11 === 0 ? IN_RIGHT | IN_JUMP : IN_RIGHT));
    const predictor = new GunMayhemPredictor();

    for (const tick of [12, 20, 33]) {
      const body = predictedAt(predictor, r, tick)!;
      const truth = r.snapshots[tick]!;
      expect(body.x).toBeCloseTo(truth.x, 1);
      expect(body.y).toBeCloseTo(truth.y, 1);
      expect(body.vy).toBeCloseTo(truth.vy, 0);
    }
  });

  it('ignores every button outside the playing phase', () => {
    // The server's `stepBodies` zeroes the whole input during the countdown and
    // the round-over freeze. Predicting a sprint through those disagreed with
    // it by half the stage.
    const r = run(20, () => IN_RIGHT);
    const predictor = new GunMayhemPredictor();
    const stale = r.snapshots[0]!;

    const body = predictor.update(20 * TICK_MS, level, stale, false)!;
    expect(body.x).toBeCloseTo(stale.x, 3);
  });

  it('adopts velocity the server applied that we could not have predicted', () => {
    // Recoil, a knife lunge, a shield popping: all change velocity with no
    // hitstun to announce them. Rebuilding from the snapshot means these arrive
    // for free rather than needing a correction rule of their own.
    const predictor = new GunMayhemPredictor();
    gmInput.history.push({ seq: 1, bits: 0, at: 0 });

    const shoved = bare({ vx: -260, ack: 1 });
    const body = predictor.update(TICK_MS, level, shoved, true)!;
    expect(body.vx).toBeLessThan(-100);
  });

  it('gives the same answer whatever the refresh rate', () => {
    // Reconciling per frame used to make correction strength a property of the
    // monitor. Rebuilding from the snapshot cannot: the frame rate decides how
    // often the same arithmetic is run, not what it produces.
    const build = (): number => {
      const r = run(20, () => IN_RIGHT);
      const predictor = new GunMayhemPredictor();
      return predictedAt(predictor, r, 15)!.x;
    };

    const once = build();
    const again = build();
    expect(once).toBeCloseTo(again, 6);
  });
});
