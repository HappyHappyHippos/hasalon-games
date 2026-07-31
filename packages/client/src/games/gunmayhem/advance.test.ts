import { describe, expect, it } from 'vitest';
import { TICK_MS } from '@mg/shared';
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
  type GmSnapshotPlayer,
  type GunMayhemState,
} from '@mg/shared/gunmayhem';
import { MAX_ADVANCE_TICKS, advanceBullet, advancePlayer, ticksBehind } from './advance';

const level = getLevel('salon');

function seats(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    colorIndex: i,
  }));
}

function playingState(): GunMayhemState {
  const state = createState(seats(2), { ...defaultConfig(), levelId: 'salon' }, 4242);
  for (let i = 0; i < COUNTDOWN_TICKS; i++) stepTick(state);
  expect(state.phase).toBe('playing');
  return state;
}

function snapshotPlayer(state: GunMayhemState, seat: number): GmSnapshotPlayer {
  const snap = makeSnapshot(state, []);
  const player = snap.players.find((p) => p.s === seat);
  if (!player) throw new Error(`no seat ${seat}`);
  return player;
}

/** A wire player with nothing going on, for the gating tests. */
function idle(overrides: Partial<GmSnapshotPlayer> = {}): GmSnapshotPlayer {
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
    ...overrides,
  };
}

describe('advancePlayer', () => {
  it('lands where the server actually put them', () => {
    // The property the whole model rests on. Take a snapshot, carry it forward
    // N ticks with the buttons it says were held, and compare against the
    // server having simply run those N ticks itself. If these diverge, every
    // other player is being drawn somewhere they never were.
    const state = playingState();
    let seq = 0;
    applyInput(state, 'p1', ++seq, IN_RIGHT);
    stepTick(state);

    const before = snapshotPlayer(state, 1);
    expect(before.ib).toBe(IN_RIGHT);

    const TICKS = 3;
    for (let i = 0; i < TICKS; i++) stepTick(state);
    const after = snapshotPlayer(state, 1);

    const predicted = advancePlayer(before, level, TICKS, true);
    expect(predicted).not.toBeNull();

    // The snapshot rounds x to 2dp and velocity to 1dp on the way out, so
    // agreement to a hundredth of an arena unit is exact agreement.
    expect(predicted!.x).toBeCloseTo(after.x, 1);
    expect(predicted!.y).toBeCloseTo(after.y, 1);
    expect(predicted!.vx).toBeCloseTo(after.vx, 0);
  });

  it('actually moves them — the agreement above is not two zeroes matching', () => {
    const state = playingState();
    applyInput(state, 'p1', 1, IN_RIGHT);
    stepTick(state);
    const before = snapshotPlayer(state, 1);

    const predicted = advancePlayer(before, level, 6, true);
    expect(predicted!.x).toBeGreaterThan(before.x + 5);
  });

  it('holds still when there is nothing to carry forward', () => {
    const player = idle({ x: 123, y: 456 });
    const body = advancePlayer(player, level, 0, true);
    expect(body).toMatchObject({ x: 123, y: 456 });
  });

  it('refuses to place a player who is not on the stage', () => {
    // Respawning and eliminated are not positions to extrapolate — the
    // character is not in the world. Drawing a guess at where they are
    // "heading" is how a respawning player ends up streaking across the arena.
    expect(advancePlayer(idle({ rt: 30 }), level, 3, true)).toBeNull();
    expect(advancePlayer(idle({ k: 0 }), level, 3, true)).toBeNull();
  });

  it('carries a player in hitstun on physics alone', () => {
    // Knocked sideways with the left button still held from before the hit.
    // The server ignores their input during hitstun, so we must too, or they
    // will be drawn fighting a knockback that in truth they cannot resist.
    const struck = idle({ st: 20, ib: IN_LEFT, vx: 300, vy: -100, g: 0 });
    const body = advancePlayer(struck, level, 5, true);

    expect(body).not.toBeNull();
    // Still travelling in the direction of the blow, not the held button.
    expect(body!.x).toBeGreaterThan(struck.x);
    expect(body!.vx).toBeGreaterThan(0);
  });

  it('ignores buttons outside the playing phase', () => {
    // Mirrors the server's own phase gate. Predicting movement through a
    // countdown would disagree with it by the whole length of the run-up.
    const running = idle({ ib: IN_RIGHT });
    const body = advancePlayer(running, level, 5, false);
    expect(body!.x).toBeCloseTo(running.x, 5);
  });
});

describe('ticksBehind', () => {
  it('counts whole ticks of staleness', () => {
    expect(ticksBehind(1000, 1000)).toBe(0);
    expect(ticksBehind(1000 + TICK_MS * 3, 1000)).toBe(3);
  });

  it('never runs away on a stalled connection', () => {
    // A backgrounded tab can leave the newest snapshot seconds old. Simulating
    // that in one frame would fling everyone across the stage on a stale mask.
    expect(ticksBehind(1000 + 5000, 1000)).toBe(MAX_ADVANCE_TICKS);
    expect(ticksBehind(900, 1000)).toBe(0);
  });
});

describe('advanceBullet', () => {
  it('carries a bullet in a straight line', () => {
    const moved = advanceBullet({ x: 100, y: 200, vx: 900, vy: 0 }, 0.05);
    expect(moved.x).toBeCloseTo(145, 5);
    expect(moved.y).toBeCloseTo(200, 5);
  });
});
