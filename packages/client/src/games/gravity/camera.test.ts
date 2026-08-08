/**
 * The camera is shared by everyone in the round, so the property under test is
 * not "does it look nice" but "do two clients agree". Everything here builds
 * its fixtures by running the real sim rather than hand-writing a snapshot, so
 * the positions and the geometry under them are ones the game can actually
 * produce.
 */

import { describe, expect, it } from 'vitest';
import { TICK_MS, type GameSeat } from '@mg/shared';
import {
  COUNTDOWN_TICKS,
  IN_FLIP,
  VIEW_WIDTH,
  applyInput,
  buildTrack,
  createState,
  defaultConfig,
  makeSnapshot,
  stepTick,
  type GravitySnapshot,
  type Track,
} from '@mg/shared/gravity';
import { CAMERA_ANCHOR, cameraFor } from './camera';
import { gravityInput } from './input';
import { GravityPredictor } from './predictor';

function seats(count: number): GameSeat[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    colorIndex: i,
  }));
}

/** A snapshot from a match that has been running long enough for the pack to spread. */
function playingSnapshot(count = 4, ticks = 240, seed = 4242): GravitySnapshot {
  const state = createState(seats(count), defaultConfig(), seed);
  for (let i = 0; i < COUNTDOWN_TICKS; i += 1) stepTick(state);

  let seq = 0;
  for (let i = 0; i < ticks; i += 1) {
    // Seat 1 flips on a rhythm so the seats do not stay in lockstep; the point
    // is a snapshot where somebody is genuinely ahead.
    if (i % 37 === 0) {
      seq += 1;
      applyInput(state, 'p1', seq, IN_FLIP);
    } else if (i % 37 === 1) {
      seq += 1;
      applyInput(state, 'p1', seq, 0);
    }
    stepTick(state);
  }
  return makeSnapshot(state, []);
}

function trackOf(snap: GravitySnapshot): Track {
  return buildTrack(snap.tz);
}

/** Fill the local input buffer with unacknowledged ticks, as a laggy client has. */
function backlog(count: number, now: number, bits = 0): void {
  gravityInput.reset();
  gravityInput.seq = count;
  for (let i = 0; i < count; i += 1) {
    gravityInput.history.push({ seq: i + 1, bits, at: now - (count - i) * TICK_MS });
  }
}

describe('gravity camera', () => {
  it('ignores the local prediction lead, which is the whole point', () => {
    const snap = playingSnapshot();
    const track = trackOf(snap);
    const now = 10_000;

    gravityInput.reset();
    const before = cameraFor(snap, track, 2, true);

    // A client 20 ticks (~333 ms) behind on acknowledgement: the predictor
    // replays all of it, so the local body ends up well ahead of the server's.
    backlog(20, now);
    const leader = [...snap.players].sort((a, b) => b.x - a.x)[0]!;
    const predicted = new GravityPredictor().update(now, track, leader, leader.sp, true);

    expect(predicted).not.toBeNull();
    expect(predicted!.x).toBeGreaterThan(leader.x + 100);

    // Same snapshot, same instant — the camera must not have noticed any of that.
    expect(cameraFor(snap, track, 2, true)).toBe(before);

    gravityInput.reset();
  });

  it('holds the leader at the anchor', () => {
    const snap = playingSnapshot();
    const track = trackOf(snap);
    const lead = Math.max(...snap.players.filter((p) => p.al === 1).map((p) => p.x));

    // `behind: 0` with nobody moving is the identity extrapolation, so this
    // isolates the anchor arithmetic from the carry-forward.
    expect(cameraFor(snap, track, 0, false)).toBeCloseTo(lead - VIEW_WIDTH * CAMERA_ANCHOR, 6);
  });

  it('never scrolls past either end of the track', () => {
    const snap = playingSnapshot();
    const track = trackOf(snap);

    const atStart = { ...snap, players: snap.players.map((p) => ({ ...p, x: 40 })) };
    expect(cameraFor(atStart, track, 0, false)).toBe(0);

    const atEnd = { ...snap, players: snap.players.map((p) => ({ ...p, x: track.width + 5000 })) };
    expect(cameraFor(atEnd, track, 0, false)).toBe(track.width - VIEW_WIDTH);
  });

  it('does not let a dead runner hold the camera', () => {
    const snap = playingSnapshot();
    const track = trackOf(snap);

    const ghostAhead: GravitySnapshot = {
      ...snap,
      players: snap.players.map((p, i) =>
        i === 0 ? { ...p, x: p.x + 4000, al: 0 as const } : p,
      ),
    };

    expect(cameraFor(ghostAhead, track, 0, false)).toBe(cameraFor(snap, track, 0, false));
  });

  it('advances continuously between snapshots rather than stepping at the broadcast rate', () => {
    const snap = playingSnapshot();
    const track = trackOf(snap);

    // The reason the camera extrapolates at all: reading raw snapshot x would
    // translate the whole world in 30 Hz steps while the runners on top of it
    // moved smoothly.
    let previous = -Infinity;
    for (let behind = 0; behind <= 6; behind += 0.5) {
      const camera = cameraFor(snap, track, behind, true);
      expect(camera).toBeGreaterThanOrEqual(previous);
      previous = camera;
    }

    expect(cameraFor(snap, track, 6, true)).toBeGreaterThan(cameraFor(snap, track, 0, true));
  });

  it('is the same for every client, whatever their frame timing', () => {
    const snap = playingSnapshot(8);
    const track = trackOf(snap);

    // Two clients handed the same snapshot at the same point on the synced
    // server timeline, with different local input backlogs behind them.
    backlog(3, 5_000);
    const a = cameraFor(snap, track, 1.75, true);
    backlog(48, 5_000, IN_FLIP);
    const b = cameraFor(snap, track, 1.75, true);

    expect(b).toBe(a);
    gravityInput.reset();
  });
});
