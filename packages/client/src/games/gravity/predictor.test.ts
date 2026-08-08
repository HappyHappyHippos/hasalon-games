/**
 * The local predictor and the remote extrapolator.
 *
 * Both are replays of `stepRunner`, so what is worth testing is not the physics
 * — `physics.test.ts` owns that — but the three things this file adds on top of
 * it: which inputs get replayed, what the edge diff starts from, and how far
 * forward a runner may be carried before the guess stops being one.
 */

import { describe, expect, it } from 'vitest';
import { DT, TICK_MS, type GameSeat } from '@mg/shared';
import {
  COUNTDOWN_TICKS,
  IN_FLIP,
  createState,
  defaultConfig,
  stepRunner,
  stepTick,
  type RunnerBody,
  type RunnerSnapshot,
  type Track,
} from '@mg/shared/gravity';
import type { InputRecord } from '../bitInput';
import { gravityInput } from './input';
import { GravityPredictor, MAX_ADVANCE_TICKS, advanceRunner, ticksBehind } from './predictor';

function seats(count: number): GameSeat[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    colorIndex: i,
  }));
}

/** A real running body on real geometry, rather than a hand-placed one. */
function running(): { track: Track; server: RunnerSnapshot; speed: number } {
  const state = createState(seats(1), defaultConfig(), 2024);
  for (let i = 0; i < COUNTDOWN_TICKS + 90; i += 1) stepTick(state);
  const p = state.players[0]!;
  return {
    track: state.track,
    speed: state.runSpeed,
    server: {
      s: 0,
      p: 0,
      x: p.x,
      y: p.y,
      vy: p.vy,
      g: p.g,
      al: 1,
      gr: p.grounded ? 1 : 0,
      ib: p.heldBits,
      ack: 0,
      sp: state.runSpeed,
    },
  };
}

function bodyOf(server: RunnerSnapshot): RunnerBody {
  return { x: server.x, y: server.y, vy: server.vy, g: server.g, grounded: server.gr === 1 };
}

function records(count: number, now: number, bitsAt: (i: number) => number): InputRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    seq: i + 1,
    bits: bitsAt(i),
    at: now - (count - 1 - i) * TICK_MS,
  }));
}

function load(list: InputRecord[]): void {
  gravityInput.reset();
  gravityInput.seq = list.length;
  gravityInput.history.push(...list);
}

/** What the predictor should produce, computed the long way round. */
function replay(
  server: RunnerSnapshot,
  track: Track,
  speed: number,
  list: InputRecord[],
): RunnerBody {
  const body = bodyOf(server);
  let previous = server.ib;
  for (const record of list) {
    const flip = (record.bits & IN_FLIP) !== 0 && (previous & IN_FLIP) === 0;
    previous = record.bits;
    const result = stepRunner(body, { flip, controllable: true }, track, DT, speed);
    if (result.crushed || result.fell) break;
  }
  return body;
}

describe('gravity local prediction', () => {
  it('replays the unacknowledged inputs exactly', () => {
    const { track, server, speed } = running();
    const now = 50_000;
    const list = records(10, now, (i) => (i % 3 === 0 ? IN_FLIP : 0));

    load(list);
    // `now` sits on the last sample, so there is no sub-tick carry to account
    // for and this compares whole ticks against whole ticks.
    const predicted = new GravityPredictor().update(now, track, server, speed, true);

    expect(predicted).toEqual(replay(server, track, speed, list));
    gravityInput.reset();
  });

  it('replays only what the server has not acknowledged', () => {
    const { track, server, speed } = running();
    const now = 50_000;
    const list = records(20, now, (i) => (i % 4 === 0 ? IN_FLIP : 0));

    load(list);
    const acked: RunnerSnapshot = { ...server, ack: 12 };
    const predicted = new GravityPredictor().update(now, track, acked, speed, true);

    // Seqs are 1-based, so an ack of 12 leaves records 13..20 outstanding.
    expect(predicted).toEqual(replay(acked, track, speed, list.slice(12)));
    gravityInput.reset();
  });

  it('does not invent a press the server had already seen held', () => {
    const { track, server, speed } = running();
    const now = 50_000;
    const held = records(4, now, () => IN_FLIP);

    // The button was already down when the server took this snapshot, so the
    // first replayed tick is a continuation, not a rising edge.
    load(held);
    const continued = new GravityPredictor().update(
      now,
      track,
      { ...server, ib: IN_FLIP },
      speed,
      true,
    );
    expect(continued!.g).toBe(server.g);

    // Same records, but the server held nothing — now it is a real press.
    load(held);
    const pressed = new GravityPredictor().update(now, track, { ...server, ib: 0 }, speed, true);
    expect(pressed!.g).toBe(server.g === 1 ? -1 : 1);

    gravityInput.reset();
  });

  it('stops predicting a runner who is out of the round', () => {
    const { track, server, speed } = running();
    gravityInput.reset();

    const predictor = new GravityPredictor();
    expect(predictor.update(50_000, track, { ...server, al: 0 }, speed, true)).toBeNull();
    expect(predictor.active).toBe(false);
  });

  it('flags a teleport as a resync but a bump-sized nudge as motion', () => {
    const { track, server, speed } = running();
    gravityInput.reset();
    const predictor = new GravityPredictor();

    predictor.update(50_000, track, server, speed, true);
    expect(predictor.resynced).toBe(false);

    // A sustained bump moves a body ~12 units between snapshot arrivals, which
    // is real displacement and must be drawn, not smoothed away.
    predictor.update(50_016, track, { ...server, y: server.y - 12 }, speed, true);
    expect(predictor.resynced).toBe(false);

    // A round start or a lag spike outrunning MAX_REPLAY_TICKS is not motion.
    predictor.update(50_032, track, { ...server, y: server.y - 220 }, speed, true);
    expect(predictor.resynced).toBe(true);
  });
});

describe('gravity remote extrapolation', () => {
  it('never carries a runner further than the horizon, however old the snapshot', () => {
    const { track, server, speed } = running();

    const atHorizon = advanceRunner(server, track, MAX_ADVANCE_TICKS, speed, true);
    const twoSeconds = advanceRunner(server, track, 120, speed, true);

    expect(twoSeconds).toEqual(atHorizon);
    // The point of the cap: a 2 s hole must not fling anyone across the track.
    expect(twoSeconds!.x - server.x).toBeLessThanOrEqual(MAX_ADVANCE_TICKS * speed * DT + 1e-6);
  });

  it('does not guess at a flip, even with the button held', () => {
    const { track, server, speed } = running();

    const carried = advanceRunner(
      { ...server, ib: IN_FLIP },
      track,
      MAX_ADVANCE_TICKS,
      speed,
      true,
    );

    // A flip is a decision. Synthesising one would teleport somebody across the
    // track on a guess, so a held button carries no edge forward.
    expect(carried!.g).toBe(server.g);
  });

  it('returns nothing for a runner who is out', () => {
    const { track, server, speed } = running();
    expect(advanceRunner({ ...server, al: 0 }, track, 2, speed, true)).toBeNull();
  });

  it('measures staleness against the server clock and never runs backwards', () => {
    expect(ticksBehind(1_000, 1_000)).toBe(0);
    // A snapshot authored slightly ahead of our clock estimate is not a reason
    // to rewind anyone.
    expect(ticksBehind(1_000, 1_050)).toBe(0);
    expect(ticksBehind(1_000 + TICK_MS * 3, 1_000)).toBeCloseTo(3, 9);
  });
});
