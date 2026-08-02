import { describe, expect, it } from 'vitest';
import { DT } from '@mg/shared';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BASE_SPEED,
  SPEED_UP_MUL,
  createState,
  defaultConfig,
  makeSnapshot,
  stepTick,
  type AchtungState,
  SPEED_PRESETS,
} from '@mg/shared/achtung';
import { trailOps, type Point, type TrailOp } from './trail';

/**
 * The longest one tick of travel can ever be: base speed, the fastest speed
 * preset, and a speed powerup on top.
 *
 * Derived rather than written down. This used to be a hardcoded 4, which had
 * roughly a unit of headroom over the real figure and no explanation — exactly
 * the kind of constant a later speed bump sails straight past without anyone
 * noticing the test stopped meaning anything.
 */
const FASTEST_PRESET = Math.max(...SPEED_PRESETS);
const MAX_TICK_TRAVEL = BASE_SPEED * FASTEST_PRESET * SPEED_UP_MUL * DT;

describe('trailOps', () => {
  it('starts a stroke with a dot when the pen was up', () => {
    const { ops, pen } = trailOps([10, 20], [0], null);
    expect(ops).toEqual([{ type: 'dot', x: 10, y: 20 }]);
    expect(pen).toEqual({ x: 10, y: 20 });
  });

  it('joins consecutive points into lines', () => {
    const { ops } = trailOps([10, 20, 12, 22], [0], null);
    expect(ops).toEqual([
      { type: 'dot', x: 10, y: 20 },
      { type: 'line', from: { x: 10, y: 20 }, to: { x: 12, y: 22 } },
    ]);
  });

  it('continues the previous snapshot stroke when there is no break', () => {
    const { ops } = trailOps([12, 22], [], { x: 10, y: 20 });
    expect(ops).toEqual([{ type: 'line', from: { x: 10, y: 20 }, to: { x: 12, y: 22 } }]);
  });

  it('breaks the stroke where the server lifted the pen', () => {
    // Point 0 continues the old stroke; point 1 starts a new one after a gap.
    const { ops } = trailOps([12, 22, 40, 50], [1], { x: 10, y: 20 });
    expect(ops).toEqual([
      { type: 'line', from: { x: 10, y: 20 }, to: { x: 12, y: 22 } },
      { type: 'dot', x: 40, y: 50 },
    ]);
  });

  it('never invents a segment across a gap', () => {
    const { ops } = trailOps([100, 100], [0], { x: 10, y: 10 });
    expect(ops.some((op) => op.type === 'line')).toBe(false);
  });

  it('does nothing when a snapshot carries no points', () => {
    const pen: Point = { x: 5, y: 5 };
    expect(trailOps([], [], pen)).toEqual({ ops: [], pen });
  });
});

describe('what is drawn matches what the server stamped', () => {
  /**
   * Replays a real match and checks that the strokes the client would draw
   * never bridge a gap. A drawn line where the grid is empty means a curve
   * you can visually see but harmlessly drive through, and vice versa.
   */
  it('reproduces gaps exactly across many snapshots', () => {
    const state: AchtungState = createState(
      [
        { id: 'a', name: 'A', colorIndex: 0 },
        { id: 'b', name: 'B', colorIndex: 1 },
      ],
      { ...defaultConfig(2), powerupsEnabled: false },
      99,
    );

    const pens = new Map<number, Point | null>();
    const drawn: TrailOp[] = [];
    let gapsSeen = 0;

    for (let tick = 0; tick < 2500; tick++) {
      stepTick(state);
      // Keep the players alive so the run produces plenty of gaps.
      for (const p of state.players) {
        if (!p.alive) {
          p.alive = true;
          p.x = ARENA_WIDTH / 2;
          p.y = ARENA_HEIGHT / 2;
        }
      }

      if (tick % 2 !== 0) continue;
      const snap = makeSnapshot(state, []);
      for (const player of snap.players) {
        const before = pens.get(player.s) ?? null;
        const { ops, pen } = trailOps(player.tr, player.tb, before);
        pens.set(player.s, pen);
        drawn.push(...ops);
        gapsSeen += player.tb.length;
      }
    }

    expect(gapsSeen).toBeGreaterThan(10);
    expect(drawn.length).toBeGreaterThan(1000);

    // Every drawn segment must be one tick of travel long. A longer one would
    // mean the client bridged a gap the server never stamped.
    const maxStep = 0.35;
    for (const op of drawn) {
      if (op.type !== 'line') continue;
      const distance = Math.hypot(op.to.x - op.from.x, op.to.y - op.from.y);
      expect(distance).toBeLessThan(MAX_TICK_TRAVEL + maxStep);
    }
  });
});
