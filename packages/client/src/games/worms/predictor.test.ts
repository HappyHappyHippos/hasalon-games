import { beforeEach, describe, expect, it } from 'vitest';
import {
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  MASK_CELL,
  stepWorm,
  type TerrainMask,
  type WormBody,
  type WormSnapWorm,
} from '@mg/shared/worms';
import { wormsInput } from './input';
import { predictWorm, predictionError } from './predictor';

function world(floorY = 400): TerrainMask {
  const cols = 500;
  const rows = 400;
  const bits = new Uint8Array(cols * rows);
  for (let row = Math.floor(floorY / MASK_CELL); row < rows; row += 1) {
    bits.fill(1, row * cols, row * cols + cols);
  }
  return { cols, rows, bits };
}

/** Land a body so the tests start from a worm that is actually standing. */
function standing(mask: TerrainMask, x = 200): WormBody {
  const body: WormBody = { x, y: 100, vx: 0, vy: 0, facing: 1, onGround: false };
  for (let i = 0; i < 240 && !body.onGround; i += 1) stepWorm(body, mask, 0, 0, false);
  return body;
}

function snapOf(body: WormBody, over: Partial<WormSnapWorm> = {}): WormSnapWorm {
  return {
    i: 1,
    s: 0,
    x: body.x,
    y: body.y,
    vx: body.vx,
    vy: body.vy,
    f: body.facing,
    g: body.onGround ? 1 : 0,
    hp: 100,
    al: 1,
    ai: 128,
    pw: 0,
    ...over,
  };
}

/** Pretend the sampler has been running: one record per tick, in order. */
function log(bits: number[], from = 1): void {
  wormsInput.history.length = 0;
  bits.forEach((value, i) => {
    wormsInput.history.push({ seq: from + i, bits: value, at: i });
  });
}

beforeEach(() => {
  wormsInput.history.length = 0;
  wormsInput.bits = 0;
  wormsInput.seq = 0;
});

describe('predictWorm', () => {
  it('returns the server position when nothing is unacknowledged', () => {
    const mask = world();
    const body = standing(mask);
    const predicted = predictWorm(snapOf(body), mask, 10, 0, true);
    expect(predicted).not.toBeNull();
    expect(predicted!.x).toBe(body.x);
    expect(predicted!.replayed).toBe(0);
  });

  it('gives up rather than guessing when there is no mask yet', () => {
    expect(predictWorm(snapOf(standing(world())), null, 0, 0, true)).toBeNull();
  });

  /**
   * The property the whole thing exists for. Replaying the same inputs from
   * the same acknowledged state through the same `stepWorm` must land exactly
   * where the server will, or the correction that arrives a round trip later
   * is a visible snap.
   */
  it('lands exactly where the server does for the same input log', () => {
    const mask = world();
    const server = standing(mask);
    const snapshot = snapOf(server);

    const bits = Array.from({ length: 45 }, (_, i) => (i === 10 ? IN_JUMP : IN_RIGHT));
    log(bits, 101);

    // The server applies the same log, from the same state, one tick at a time.
    let previous = 0;
    for (const value of bits) {
      stepWorm(server, mask, value, value & ~previous, true);
      previous = value;
    }

    const predicted = predictWorm(snapshot, mask, 100, 0, true);
    expect(predicted).not.toBeNull();
    expect(predicted!.replayed).toBe(bits.length);
    expect(predictionError(predicted!, snapOf(server))).toBeCloseTo(0, 9);
    expect(predicted!.onGround).toBe(server.onGround);
  });

  it('drops inputs the server has already applied', () => {
    const mask = world();
    const body = standing(mask);
    log(Array.from({ length: 20 }, () => IN_RIGHT), 1);

    const predicted = predictWorm(snapOf(body), mask, 12, 0, true);
    // Twelve acknowledged, eight left.
    expect(predicted!.replayed).toBe(8);
  });

  /**
   * The subtle one. Seeding the edge detector with zero re-presses every button
   * already held on the first replayed tick, so a player holding jump when an
   * acknowledgement lands jumps a second time — once per snapshot, silently,
   * and only while a button is down.
   */
  it('does not re-press a button the server already had held', () => {
    const mask = world();
    const body = standing(mask);
    log(Array.from({ length: 6 }, () => IN_JUMP), 1);

    const wrong = predictWorm(snapOf(body), mask, 0, 0, true);
    const right = predictWorm(snapOf(body), mask, 0, IN_JUMP, true);

    expect(wrong!.vy).toBeLessThan(0);
    // Held since before the acknowledgement: no fresh edge, so no jump.
    expect(right!.onGround).toBe(true);
    expect(right!.vy).toBe(0);
  });

  it('predicts nothing but gravity when it is not your turn', () => {
    const mask = world();
    const body = standing(mask);
    log(Array.from({ length: 30 }, () => IN_LEFT), 1);

    const predicted = predictWorm(snapOf(body), mask, 0, 0, false);
    expect(predicted!.x).toBe(body.x);
  });

  it('never mutates the snapshot it was handed', () => {
    const mask = world();
    const body = standing(mask);
    const snapshot = snapOf(body);
    const before = JSON.stringify(snapshot);
    log(Array.from({ length: 20 }, () => IN_RIGHT), 1);
    predictWorm(snapshot, mask, 0, 0, true);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
