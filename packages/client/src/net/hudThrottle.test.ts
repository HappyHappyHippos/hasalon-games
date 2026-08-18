import { describe, expect, it } from 'vitest';
import { HUD_INTERVAL_MS, shouldMirrorHud, type HudMirrorState } from './hudThrottle';

const state = (lastAt: number, lastPhase: string): HudMirrorState => ({ lastAt, lastPhase });

describe('shouldMirrorHud', () => {
  it('drops repeat snapshots of the same phase inside the window', () => {
    expect(shouldMirrorHud(state(1000, 'playing'), { phase: 'playing' }, 1050)).toBe(false);
  });

  it('lets one through once the window has passed', () => {
    expect(
      shouldMirrorHud(state(1000, 'playing'), { phase: 'playing' }, 1000 + HUD_INTERVAL_MS),
    ).toBe(true);
  });

  it('never drops the first snapshot of a new phase', () => {
    // The one that mattered: `matchOver` is the last phase the tick loop
    // broadcasts, and Meme Machine's whole gallery rides on that snapshot. One
    // millisecond after the previous mirror is the worst case, not an unlikely
    // one — snapshots are 33ms apart and the window is 120.
    expect(shouldMirrorHud(state(1000, 'standings'), { phase: 'matchOver' }, 1001)).toBe(true);
  });

  it('never drops an events burst', () => {
    expect(
      shouldMirrorHud(state(1000, 'playing'), { phase: 'playing', events: ['ko'] }, 1001),
    ).toBe(true);
  });

  it('treats an empty events array as no burst', () => {
    expect(shouldMirrorHud(state(1000, 'playing'), { phase: 'playing', events: [] }, 1001)).toBe(
      false,
    );
  });

  it('mirrors the opening snapshot of a match, whatever its phase', () => {
    // `lastPhase` is reset to '' on `matchStarted`, so the countdown's first
    // snapshot is a phase change and cannot be dropped.
    expect(shouldMirrorHud(state(0, ''), { phase: 'countdown' }, 0)).toBe(true);
  });
});
