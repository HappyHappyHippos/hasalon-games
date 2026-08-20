/**
 * The two halves of the remote-smoothing rule, held apart.
 *
 * Getting either one backwards is a shipped bug that looks like the other
 * problem: smoothing everything makes jumps and gravity flips read as floaty,
 * and smoothing nothing makes every remote body step once per snapshot. Both
 * were live in Tank Trouble before this class existed.
 */
import { describe, expect, it } from 'vitest';
import { RemoteBodies } from './RemoteBodies';

const STILL = { vx: 0, vy: 0 };

describe('RemoteBodies', () => {
  it('slides across a small correction rather than stepping to it', () => {
    const remotes = new RemoteBodies(260);

    // Two frames from the same snapshot: nothing to absorb, drawn as given.
    remotes.beginFrame(100);
    remotes.draw(0, 0, 0, STILL, 0);
    remotes.beginFrame(100);
    const settled = remotes.draw(0, 10, 0, STILL, 16);
    expect(settled.x).toBeCloseTo(10, 5);

    // A newer snapshot puts them 40 units on. Velocity barely changed, so this
    // is drift the extrapolation got wrong — absorb it. On the frame it lands
    // the body does not move at all: the whole gap becomes an offset, which is
    // what "no step" means. Anything else would be a visible twitch.
    remotes.beginFrame(133);
    expect(remotes.draw(0, 50, 0, STILL, 32).x).toBeCloseTo(10, 5);

    // The offset then decays, so the body closes on the truth over the next few
    // frames instead of jumping to it.
    const path: number[] = [];
    for (let frame = 1; frame <= 20; frame++) {
      remotes.beginFrame(133);
      path.push(remotes.draw(0, 50, 0, STILL, 32 + frame * 16).x);
    }

    // Monotonic — a smoother that overshoots would read as a wobble.
    for (let i = 1; i < path.length; i++) expect(path[i]!).toBeGreaterThanOrEqual(path[i - 1]!);
    // 20 frames is ~320 ms, four time constants, so what is left of a 40-unit
    // gap is under a unit — below a pixel on screen.
    expect(50 - path[path.length - 1]!).toBeLessThan(1);
  });

  it('snaps when the velocity change is an event no guess could have contained', () => {
    const remotes = new RemoteBodies(260);

    remotes.beginFrame(100);
    remotes.draw(0, 0, 0, { vx: 0, vy: 300 }, 0);

    // A jump: vy reverses by 600, well past the threshold. The new position is
    // taken at face value on the frame it arrives.
    remotes.beginFrame(133);
    const drawn = remotes.draw(0, 50, 0, { vx: 0, vy: -300 }, 16);
    expect(drawn.x).toBeCloseTo(50, 5);
  });

  it('treats the threshold as the boundary between the two behaviours', () => {
    const under = new RemoteBodies(260);
    under.beginFrame(100);
    under.draw(0, 0, 0, { vx: 0, vy: 0 }, 0);
    under.beginFrame(133);
    // 259 < 260: still drift, so the step is absorbed.
    expect(under.draw(0, 50, 0, { vx: 259, vy: 0 }, 16).x).toBeLessThan(50);

    const over = new RemoteBodies(260);
    over.beginFrame(100);
    over.draw(0, 0, 0, { vx: 0, vy: 0 }, 0);
    over.beginFrame(133);
    // 261 > 260: an event, drawn where it actually is.
    expect(over.draw(0, 50, 0, { vx: 261, vy: 0 }, 16).x).toBeCloseTo(50, 5);
  });

  it('does not smooth between frames that share a snapshot', () => {
    // Between snapshots the extrapolation is continuous. Absorbing every frame
    // would fight the motion itself and draw everyone permanently behind.
    const remotes = new RemoteBodies(260);
    remotes.beginFrame(100);
    remotes.draw(0, 0, 0, STILL, 0);

    remotes.beginFrame(100);
    expect(remotes.draw(0, 5, 0, STILL, 16).x).toBeCloseTo(5, 5);
    remotes.beginFrame(100);
    expect(remotes.draw(0, 10, 0, STILL, 32).x).toBeCloseTo(10, 5);
  });

  it('keeps seats independent', () => {
    const remotes = new RemoteBodies(260);
    remotes.beginFrame(100);
    remotes.draw(0, 0, 0, STILL, 0);
    remotes.draw(1, 500, 0, STILL, 0);

    remotes.beginFrame(133);
    // Seat 0 drifts a little; seat 1 is hit hard enough to count as an event.
    const zero = remotes.draw(0, 40, 0, STILL, 16);
    const one = remotes.draw(1, 560, 0, { vx: 400, vy: 0 }, 16);

    expect(zero.x).toBeLessThan(40);
    expect(one.x).toBeCloseTo(560, 5);
  });

  it('forgets a seat that left, so respawning does not slide out of the grave', () => {
    const remotes = new RemoteBodies(260);
    remotes.beginFrame(100);
    remotes.draw(0, 0, 0, STILL, 0);

    remotes.forget(0);

    // Back at the far side of the arena. With no memory of seat 0 there is no
    // gap to absorb, so the first frame back is exactly the spawn point.
    remotes.beginFrame(133);
    expect(remotes.draw(0, 900, 0, STILL, 16).x).toBeCloseTo(900, 5);
  });

  it('clear() drops every seat and the snapshot cursor', () => {
    const remotes = new RemoteBodies(260);
    remotes.beginFrame(100);
    remotes.draw(0, 0, 0, STILL, 0);

    remotes.clear();

    // Same `serverAt` as before the clear: without resetting the cursor this
    // would be read as "no new snapshot" and the seat would be re-seeded
    // against stale state.
    remotes.beginFrame(100);
    expect(remotes.draw(0, 700, 0, STILL, 16).x).toBeCloseTo(700, 5);
  });
});
