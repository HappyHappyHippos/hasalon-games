import { describe, expect, it, beforeEach } from 'vitest';
import { AchtungRenderer } from './Renderer';
import { feed } from '../../net/feed';
import type { AchtungSnapshot } from '@mg/shared/achtung';

function mockCanvas(): HTMLCanvasElement {
  const ctx = {
    scale: () => {},
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    fillRect: () => {},
    drawImage: () => {},
    strokeRect: () => {},
    setLineDash: () => {},
    fillText: () => {},
  } as unknown as CanvasRenderingContext2D;

  return {
    width: 800,
    height: 600,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

if (typeof document === 'undefined') {
  globalThis.document = {
    createElement: () => mockCanvas(),
  } as unknown as Document;
}

function makeSnap(tick: number, trailEpoch: number, phase: 'countdown' | 'playing' = 'playing'): AchtungSnapshot {
  return {
    game: 'achtung',
    tick,
    round: 1,
    phase,
    phaseTicks: 0,
    trailEpoch,
    players: [
      { s: 0, x: 100, y: 100, a: 0, v: 100, r: 4, l: 1, p: 0, d: 1, fx: [], tr: [100, 100, 105, 100], tb: [] },
    ],
    pickups: [],
    events: [],
  };
}

describe('AchtungRenderer state resets', () => {
  beforeEach(() => {
    feed.reset();
  });

  it('resets epoch and tick state when receiving a snapshot from a new match (lower trailEpoch)', () => {
    const canvas = mockCanvas();
    const renderer = new AchtungRenderer(canvas, {
      mySeat: 0,
      colorBySeat: { 0: 0 },
      nameBySeat: { 0: 'Player 1' },
      hatBySeat: { 0: 0 },
      settings: { game: 'achtung', powerupsEnabled: true, speedScale: 1, targetScore: 10, winByTwo: false },
      paused: false,
    });

    // Simulate Game 1 up to epoch 4, tick 1000
    feed.push(makeSnap(1000, 4), performance.now());
    // @ts-expect-error accessing private bake for testing
    renderer.bake(performance.now());
    // @ts-expect-error accessing private field
    expect(renderer.trailEpoch).toBe(4);
    // @ts-expect-error accessing private field
    expect(renderer.seenEventTick).toBe(1000);

    // Simulate Game 2 starting with epoch 1, tick 0
    feed.reset();
    feed.push(makeSnap(0, 1), performance.now());
    // @ts-expect-error accessing private bake for testing
    renderer.bake(performance.now());

    // @ts-expect-error accessing private field
    expect(renderer.trailEpoch).toBe(1);
    // @ts-expect-error accessing private field
    expect(renderer.seenEventTick).toBe(0);
  });

  it('reset() clears all persistent trail and event state', () => {
    const canvas = mockCanvas();
    const renderer = new AchtungRenderer(canvas, {
      mySeat: 0,
      colorBySeat: { 0: 0 },
      nameBySeat: { 0: 'Player 1' },
      hatBySeat: { 0: 0 },
      settings: { game: 'achtung', powerupsEnabled: true, speedScale: 1, targetScore: 10, winByTwo: false },
      paused: false,
    });

    feed.push(makeSnap(500, 3), performance.now());
    // @ts-expect-error accessing private bake for testing
    renderer.bake(performance.now());

    renderer.reset();

    // @ts-expect-error accessing private field
    expect(renderer.trailEpoch).toBe(-1);
    // @ts-expect-error accessing private field
    expect(renderer.seenEventTick).toBe(-1);
    // @ts-expect-error accessing private field
    expect(renderer.bakedTick.size).toBe(0);
    // @ts-expect-error accessing private field
    expect(renderer.penPos.size).toBe(0);
  });
});
