import { describe, expect, it } from 'vitest';
import { REVEAL_SLOT_MS, REVEAL_SPIN_MS, revealDurationMs } from '@mg/shared';
import { landedAt, msUntilLand } from './rouletteTiming';

describe('landedAt', () => {
  it('holds everything spinning through the opening spin', () => {
    expect(landedAt(0, 4, false)).toBe(0);
    expect(landedAt(REVEAL_SPIN_MS - 1, 4, false)).toBe(0);
  });

  it('drops one reel per slot', () => {
    expect(landedAt(REVEAL_SPIN_MS, 4, false)).toBe(1);
    expect(landedAt(REVEAL_SPIN_MS + REVEAL_SLOT_MS, 4, false)).toBe(2);
    expect(landedAt(REVEAL_SPIN_MS + REVEAL_SLOT_MS * 2, 4, false)).toBe(3);
  });

  it('never lands more reels than there are legs', () => {
    expect(landedAt(revealDurationMs(3), 3, false)).toBe(3);
    expect(landedAt(revealDurationMs(3) * 10, 3, false)).toBe(3);
  });

  it('never goes backwards as time moves forward', () => {
    let previous = 0;
    for (let ms = 0; ms <= revealDurationMs(6); ms += 50) {
      const landed = landedAt(ms, 6, false);
      expect(landed).toBeGreaterThanOrEqual(previous);
      previous = landed;
    }
  });

  // The whole reason this is a function of elapsed time rather than a counter:
  // someone who reloads mid-reveal has to arrive where everyone else is.
  it('seeks to the right place partway through', () => {
    expect(landedAt(REVEAL_SPIN_MS + REVEAL_SLOT_MS * 2.5, 5, false)).toBe(3);
  });

  it('shows the finished lineup immediately under reduced motion', () => {
    expect(landedAt(0, 5, true)).toBe(5);
    expect(landedAt(-999, 5, true)).toBe(5);
  });

  it('survives a nonsense elapsed time', () => {
    expect(landedAt(Number.NaN, 4, false)).toBe(0);
    expect(landedAt(-1000, 4, false)).toBe(0);
  });
});

describe('msUntilLand', () => {
  it('spaces the landings a slot apart, after the opening spin', () => {
    expect(msUntilLand(0)).toBe(REVEAL_SPIN_MS);
    expect(msUntilLand(1) - msUntilLand(0)).toBe(REVEAL_SLOT_MS);
  });

  it('agrees with landedAt at every landing', () => {
    for (let slot = 0; slot < 6; slot++) {
      expect(landedAt(msUntilLand(slot), 6, false)).toBe(slot + 1);
    }
  });

  it('finishes every landing before the reveal is over', () => {
    expect(msUntilLand(5)).toBeLessThan(revealDurationMs(6));
  });
});
