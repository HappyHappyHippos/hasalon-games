import { describe, expect, it } from 'vitest';
import { TICK_MS } from '@mg/shared';
import {
  COUNTDOWN_TICKS,
  IN_LEFT,
  IN_RIGHT,
  PLAYER_HALF_H,
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

const level = getLevel('candyland');

function seats(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    colorIndex: i,
  }));
}

function playingState(): GunMayhemState {
  const state = createState(seats(2), { ...defaultConfig(), levelId: 'candyland' }, 4242);
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
    iv: 0,
    rt: 0,
    j: 2,
    jp: 0,
    w: 'pistol',
    am: 0,
  cd: 0,
    bo: 3,
    p: 0,
    ack: 0,
    ib: 0,
    cy: 0,
    jb: 0,
    dp: 0,
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

  it('lets a knocked-back player fight the blow, because the server does', () => {
    // Knocked to the right with the left button still held. Hitstun used to
    // make the server ignore that input, so this drew them as pure ballistics;
    // now the server honours it, and drawing them helpless would be a
    // correction waiting to happen on the next snapshot.
    const struck = idle({ ib: IN_LEFT, vx: 300, vy: -100, g: 0 });
    const body = advancePlayer(struck, level, 5, true);

    expect(body).not.toBeNull();
    // Still carried right by the blow over this many ticks...
    expect(body!.x).toBeGreaterThan(struck.x);
    // ...but already decelerating against it, rather than coasting.
    expect(body!.vx).toBeLessThan(struck.vx);
  });

  it('does not re-land a player who is dropping through a ledge', () => {
    // `dropThrough` is what tells `resolveVertical` to let this body pass. Left
    // at zero — as it was, on the theory that it was a sub-frame input aid —
    // every extrapolated tick re-catches them on the ledge they just left, and
    // they are drawn standing on it until the next snapshot drags them down.
    const platform = level.platforms.find((p) => p.oneWay);
    expect(platform, 'the candyland level should have a one-way platform').toBeTruthy();

    // Feet just above the ledge, falling onto it — the exact case a one-way
    // platform is supposed to catch, unless the player is dropping through.
    const dropping = {
      x: platform!.x + platform!.w / 2,
      y: platform!.y - PLAYER_HALF_H - 2,
      vy: 200,
      g: 0 as const,
      dp: 8,
    };

    const passing = advancePlayer(idle(dropping), level, 4, true);
    const caught = advancePlayer(idle({ ...dropping, dp: 0 }), level, 4, true);

    // The contrast is the bug: identical body, only the flag differs. Without
    // it the dropping player is planted on the ledge; with it they keep falling.
    expect(passing!.onGround).toBe(false);
    expect(caught!.onGround).toBe(true);
    expect(passing!.y).toBeGreaterThan(caught!.y);
  });

  it('advances smoothly between ticks rather than in whole-tick steps', () => {
    // Sampling across one tick must produce a monotonic sweep, not a step. This
    // is the judder that was invisible at 60fps because one tick and one frame
    // happen to cover the same ground there.
    const running = idle({ ib: IN_RIGHT, vx: 300 });
    const xs = [0, 0.25, 0.5, 0.75].map((f) => advancePlayer(running, level, 2 + f, true)!.x);

    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]!);
    }
    // And the steps are even, rather than three zeroes and a jump.
    const steps = xs.slice(1).map((x, i) => x - xs[i]!);
    const spread = Math.max(...steps) - Math.min(...steps);
    expect(spread).toBeLessThan(0.5);
  });

  it('is continuous across a tick boundary', () => {
    // Approaching a whole tick from below must land essentially where that
    // whole tick does. Not bit-identical — the remainder is carried at constant
    // velocity while a real tick also accelerates, so a fraction of a tick's
    // acceleration separates them by design. What matters is that there is no
    // *step*: the boundary is where quantised motion used to jump 5.75 units.
    const running = idle({ ib: IN_RIGHT, vx: 200 });
    const exact = advancePlayer(running, level, 3, true)!;
    const justUnder = advancePlayer(running, level, 3 - 1e-6, true)!;

    expect(Math.abs(justUnder.x - exact.x)).toBeLessThan(1);
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
