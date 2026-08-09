import { describe, expect, it } from 'vitest';
import { DeathFx, LocalShotFx } from './localFx';

describe('DeathFx', () => {
  it('plays the first sighting of a death and skips every repeat of it', () => {
    // This is the bug the issue describes: the same snapshot — and the same
    // `died` event inside it — stays "latest" for many requestAnimationFrame
    // passes between one 30Hz snapshot and the next. Naively spawning on
    // every one of those frames would spawn dozens of explosions per death.
    const fx = new DeathFx();
    expect(fx.consume(2, 100)).toBe(true);
    expect(fx.consume(2, 100)).toBe(false);
    expect(fx.consume(2, 100)).toBe(false);
  });

  it('treats a different seat on the same tick as a different death', () => {
    // Two players can die on the same tick (e.g. both fall off at once), and
    // each of those is a real, separate explosion.
    const fx = new DeathFx();
    expect(fx.consume(0, 50)).toBe(true);
    expect(fx.consume(1, 50)).toBe(true);
    expect(fx.consume(0, 50)).toBe(false);
    expect(fx.consume(1, 50)).toBe(false);
  });

  it('treats the same seat dying again on a later tick as a new death', () => {
    // A player can die multiple times across a match (once per stock lost per
    // round); each one needs its own explosion.
    const fx = new DeathFx();
    expect(fx.consume(3, 10)).toBe(true);
    expect(fx.consume(3, 400)).toBe(true);
    expect(fx.consume(3, 10)).toBe(false);
    expect(fx.consume(3, 400)).toBe(false);
  });

  it('does not grow without bound over a very long match', () => {
    // Guards against a memory leak rather than against a visible bug: an
    // arbitrarily long round must not accumulate one tracked key per death
    // forever.
    const fx = new DeathFx();
    for (let tick = 0; tick < 1000; tick++) {
      fx.consume(tick % 4, tick);
    }
    // The oldest deaths should have aged out, so replaying one of the very
    // first keys is treated as new again.
    expect(fx.consume(0, 0)).toBe(true);
  });

  it('forgets everything on reset, as happens on remount or a fresh match', () => {
    const fx = new DeathFx();
    fx.consume(1, 5);
    fx.reset();
    expect(fx.consume(1, 5)).toBe(true);
  });
});

describe('LocalShotFx (regression coverage for the pattern DeathFx follows)', () => {
  it('consumes exactly one pending shot per match', () => {
    const fx = new LocalShotFx();
    fx.played(1000);
    expect(fx.consume(1010)).toBe(true);
    expect(fx.consume(1010)).toBe(false);
  });

  it('does not match a shot older than the match window', () => {
    const fx = new LocalShotFx();
    fx.played(0);
    expect(fx.consume(10_000)).toBe(false);
  });
});
