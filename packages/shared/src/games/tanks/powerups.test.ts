import { describe, expect, it } from 'vitest';
import { POWERUPS, POWERUP_KINDS, emptyBuffs, grant, movementMods, tickBuffs } from './powerups';

describe('powerups', () => {
  it('every kind round-trips through grant/tickBuffs/emptyBuffs without crashing', () => {
    for (const kind of POWERUP_KINDS) {
      const buffs = emptyBuffs();
      grant(buffs, kind);
      expect(buffs[kind]).toBeGreaterThan(0);

      const spec = POWERUPS[kind];
      expect(spec.label).toBeTruthy();
      expect(spec.color).toMatch(/^#[0-9a-f]{6}$/i);

      // Movement mods must never throw or produce a non-finite multiplier,
      // whether or not the kind touches movement.
      const mods = movementMods(buffs);
      expect(Number.isFinite(mods.speedMul)).toBe(true);
      expect(Number.isFinite(mods.turnMul)).toBe(true);

      if (spec.duration !== undefined) {
        // Ticking down to zero clears the buff rather than going negative.
        for (let i = 0; i < spec.duration + 1; i += 1) tickBuffs(buffs);
        expect(buffs[kind]).toBeUndefined();
      }
    }
  });
});
