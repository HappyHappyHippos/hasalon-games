/**
 * How far behind the truth each playback model draws a moving player.
 *
 * This is the measurement the whole change is justified by, so it is pinned
 * here rather than left to the eye. A real match is simulated, real snapshots
 * are produced from it at the real cadence, a real one-way network delay is
 * applied, and then both models are asked the same question every frame:
 * *where do you think seat 1 is right now?* The answer is compared against
 * where the server actually had them at that instant.
 *
 * Interpolation cannot win this. It draws positions the server genuinely
 * reported, which means it is drawing the past, and the error is simply how far
 * the player moved during the delay. That is not a bug in it — it is what it is
 * for. The question is only whether the estimate beats it by enough to be worth
 * the estimate being occasionally wrong.
 */
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_EVERY, TICK_MS } from '@mg/shared';
import {
  COUNTDOWN_TICKS,
  IN_LEFT,
  IN_RIGHT,
  applyInput,
  createState,
  defaultConfig,
  getLevel,
  makeSnapshot,
  stepTick,
  type GunMayhemSnapshot,
} from '@mg/shared/gunmayhem';
import { bracket, lerp } from '../../game/interpolation';
import type { FeedEntry } from '../../net/feed';
import { advancePlayer, ticksBehind } from './advance';

const level = getLevel('candyland');
const SEAT = 1;

/** Half of a 100 ms round trip — roughly the production link. */
const ONE_WAY_MS = 50;
/** What `feed.updateDelay` settles on for that link with steady arrivals. */
const INTERP_DELAY_MS = ONE_WAY_MS + SNAPSHOT_EVERY * TICK_MS + 8;

interface Recorded {
  entries: FeedEntry[];
  /** Where the server actually had the player, indexed by tick. */
  truth: number[];
  ticks: number;
}

function record(ticks: number, bitsAt: (tick: number) => number): Recorded {
  const state = createState(
    [
      { id: 'p0', name: 'P0', colorIndex: 0 },
      { id: 'p1', name: 'P1', colorIndex: 1 },
    ],
    { ...defaultConfig(), levelId: 'candyland' },
    4242,
  );
  for (let i = 0; i < COUNTDOWN_TICKS; i++) stepTick(state);

  const entries: FeedEntry[] = [];
  const truth: number[] = [];
  let seq = 0;
  let held = -1;

  for (let tick = 0; tick < ticks; tick++) {
    const bits = bitsAt(tick);
    if (bits !== held) {
      held = bits;
      applyInput(state, 'p1', ++seq, bits);
    }
    stepTick(state);
    const player = state.players.find((p) => p.seat === SEAT)!;
    truth.push(player.x);

    if (tick % SNAPSHOT_EVERY === 0) {
      const snap = makeSnapshot(state, []) as GunMayhemSnapshot;
      const serverAt = tick * TICK_MS;
      entries.push({ snap, at: serverAt + ONE_WAY_MS, serverAt });
    }
  }
  return { entries, truth, ticks };
}

/** Entries that have physically arrived by `now`. */
function arrived(entries: FeedEntry[], now: number): FeedEntry[] {
  return entries.filter((e) => e.at <= now);
}

function truthAt(truth: number[], now: number): number | null {
  const tick = Math.round(now / TICK_MS);
  return truth[tick] ?? null;
}

function drawnByPredict(entries: FeedEntry[], now: number): number | null {
  const available = arrived(entries, now);
  const newest = available[available.length - 1];
  if (!newest) return null;
  const snap = newest.snap as GunMayhemSnapshot;
  const player = snap.players.find((p) => p.s === SEAT)!;
  const body = advancePlayer(player, level, ticksBehind(now, newest.serverAt), true);
  return body?.x ?? null;
}

function drawnByInterpolate(entries: FeedEntry[], now: number): number | null {
  const found = bracket(arrived(entries, now), now - INTERP_DELAY_MS);
  if (!found) return null;
  const from = (found.from.snap as GunMayhemSnapshot).players.find((p) => p.s === SEAT)!;
  const to = found.to
    ? (found.to.snap as GunMayhemSnapshot).players.find((p) => p.s === SEAT)
    : undefined;
  if (!to) return from.x + from.vx * (found.overshootMs / 1000);
  return lerp(from.x, to.x, found.alpha);
}

/**
 * Frame-to-frame motion, sampled at an arbitrary display rate.
 *
 * The measurement the first version of this file was missing. Everything here
 * used to sample at 60 fps, which is exactly the rate at which a bug that
 * advances the drawing in whole simulation ticks is invisible — one tick of
 * travel and one frame of travel are the same distance, so quantised motion and
 * smooth motion produce identical samples. On any other refresh rate they do
 * not, and 120 and 144 Hz displays are ordinary.
 *
 * Reports the spread of per-frame deltas. Genuinely smooth motion at a constant
 * speed has near-zero spread; motion pinned to tick boundaries alternates
 * between standing still and jumping a whole tick's worth.
 */
function frameDeltaSpread(recorded: Recorded, fps: number): { mean: number; sd: number; max: number } {
  const { entries, ticks } = recorded;
  const frameMs = 1000 / fps;
  const deltas: number[] = [];
  let previous: number | null = null;

  for (let now = 30 * TICK_MS; now < ticks * TICK_MS; now += frameMs) {
    const drawn = drawnByPredict(entries, now);
    if (drawn === null) {
      previous = null;
      continue;
    }
    if (previous !== null) deltas.push(Math.abs(drawn - previous));
    previous = drawn;
  }

  // The runner eventually goes off the stage and respawns, which breaks the
  // series; there is still plenty of steady running before that.
  expect(deltas.length).toBeGreaterThan(50);
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const variance = deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / deltas.length;
  return { mean, sd: Math.sqrt(variance), max: Math.max(...deltas) };
}

interface Error {
  mean: number;
  worst: number;
}

/**
 * Both models scored over the same frames.
 *
 * Scoring them separately is not a fair fight: `advancePlayer` declines to
 * place a player who is respawning, so those frames drop out of its average
 * while interpolation is still counted lerping across the teleport. Judging
 * only the frames where both answered keeps the comparison honest.
 */
function errorsOf(recorded: Recorded): { predict: Error; interpolate: Error } {
  const { entries, truth, ticks } = recorded;
  const totals = { predict: 0, interpolate: 0 };
  const worsts = { predict: 0, interpolate: 0 };
  let count = 0;

  // Start once the buffer has had time to fill, so neither model is judged on
  // its first frames before it has anything to work with.
  for (let tick = 30; tick < ticks; tick++) {
    const now = tick * TICK_MS;
    const actual = truthAt(truth, now);
    const p = drawnByPredict(entries, now);
    const i = drawnByInterpolate(entries, now);
    if (actual === null || p === null || i === null) continue;

    const pe = Math.abs(p - actual);
    const ie = Math.abs(i - actual);
    totals.predict += pe;
    totals.interpolate += ie;
    worsts.predict = Math.max(worsts.predict, pe);
    worsts.interpolate = Math.max(worsts.interpolate, ie);
    count += 1;
  }

  expect(count).toBeGreaterThan(50);
  return {
    predict: { mean: totals.predict / count, worst: worsts.predict },
    interpolate: { mean: totals.interpolate / count, worst: worsts.interpolate },
  };
}

const TICKS = 180;

function report(label: string, predict: Error, interpolate: Error): void {
  console.log(
    `${label}\n` +
      `  predict     mean ${predict.mean.toFixed(1)}px  worst ${predict.worst.toFixed(1)}px\n` +
      `  interpolate mean ${interpolate.mean.toFixed(1)}px  worst ${interpolate.worst.toFixed(1)}px`,
  );
}

describe('playback lag against the truth', () => {
  it('tracks a running player far closer than interpolating', () => {
    const { predict, interpolate } = errorsOf(record(TICKS, () => IN_RIGHT));

    report(
      `holding one direction (one-way ${ONE_WAY_MS}ms, buffer ${INTERP_DELAY_MS.toFixed(0)}ms)`,
      predict,
      interpolate,
    );

    expect(predict.mean).toBeLessThan(interpolate.mean / 3);
  });

  it('still wins when the player keeps reversing — prediction is not free, but it is cheaper', () => {
    // The adversarial case, and the honest one. Every direction change is a
    // guess the model gets wrong for as long as the news takes to arrive, so
    // this is where predicting costs something. Reversing every ~200 ms is far
    // twitchier than real play; if it holds up here it holds up in a match.
    const jinking = record(TICKS, (tick) => (Math.floor(tick / 12) % 2 === 0 ? IN_RIGHT : IN_LEFT));
    const { predict, interpolate } = errorsOf(jinking);

    report('reversing every 12 ticks', predict, interpolate);

    // A far weaker claim than the steady case on purpose. The point is that the
    // worst case is still an improvement, not that it is free.
    expect(predict.mean).toBeLessThan(interpolate.mean);
  });

  it('draws smooth motion at a refresh rate that is not 60 Hz', () => {
    // A running player at a constant speed should advance by the same distance
    // every frame. If the drawing is pinned to whole simulation ticks it
    // instead alternates between not moving and moving a full tick's worth,
    // which on a 144 Hz display is a visible judder — and is what a 60 Hz
    // sample cannot see, because there one tick and one frame coincide.
    const run = record(TICKS, () => IN_RIGHT);

    const at60 = frameDeltaSpread(run, 60);
    const at144 = frameDeltaSpread(run, 144);
    console.log(
      `per-frame motion — 60Hz mean ${at60.mean.toFixed(2)}px sd ${at60.sd.toFixed(2)} max ${at60.max.toFixed(2)}\n` +
        `                  144Hz mean ${at144.mean.toFixed(2)}px sd ${at144.sd.toFixed(2)} max ${at144.max.toFixed(2)}`,
    );

    // At 144 Hz a player running at RUN_SPEED covers ~2.4px per frame. Quantised
    // motion instead produces a stream of 0s and 5.75s, whose spread is larger
    // than the mean step itself.
    expect(at144.sd).toBeLessThan(at144.mean);
    // And no single frame should lurch by much more than a smooth step.
    expect(at144.max).toBeLessThan(3 * at144.mean);
  });

  it('interpolation is behind by about what the player covers in the delay', () => {
    // Sanity on the comparison itself: the interpolated error should be close
    // to run speed times the buffer depth. If it is not, the harness is wrong
    // rather than the model.
    expect(errorsOf(record(TICKS, () => IN_RIGHT)).interpolate.mean).toBeGreaterThan(20);
  });
});
