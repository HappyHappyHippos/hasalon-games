import { describe, expect, it } from 'vitest';
import { GAMES, isGameId } from './registry';
import type { GameId, GameModule, GameSeat } from './gameModule';

/**
 * The `GameModule` seam, asserted once for every game.
 *
 * CLAUDE.md calls this "the one abstraction the whole codebase hangs off", and
 * until now no test imported a single `module.ts` — every game's simulation was
 * tested directly, and the interface `Room` actually talks through was only
 * exercised end to end over a real socket. A registry entry could be wrong in
 * any of the ways below and the first symptom would be a broken lobby.
 *
 * Table-driven on purpose: a new game is covered the moment it is registered,
 * with nothing to remember to add here.
 */

const ids = Object.keys(GAMES) as GameId[];

function seatsFor(module: GameModule): GameSeat[] {
  return Array.from({ length: module.meta.minPlayers }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    colorIndex: i,
  }));
}

describe('registry', () => {
  it('registers all six games', () => {
    expect(ids.sort()).toEqual([
      'achtung',
      'gravity',
      'gunmayhem',
      'memes',
      'skribbl',
      'tanks',
    ]);
  });

  it('recognises exactly the registered ids', () => {
    for (const id of ids) expect(isGameId(id)).toBe(true);
    for (const junk of ['', 'nope', 'ACHTUNG', null, undefined, 7, {}]) {
      expect(isGameId(junk)).toBe(false);
    }
  });
});

describe.each(ids)('%s', (id) => {
  const module = GAMES[id];

  it('is filed under its own id', () => {
    // A copy-paste in the registry literal would otherwise put one game's
    // module under another's key, and the lobby would launch the wrong game.
    expect(module.meta.id).toBe(id);
  });

  it('has metadata the lobby can render', () => {
    expect(module.meta.name.length).toBeGreaterThan(0);
    expect(module.meta.tagline.length).toBeGreaterThan(0);
    expect(module.meta.controls.length).toBeGreaterThan(0);
    expect(module.meta.rules.length).toBeGreaterThan(0);
    for (const rule of module.meta.rules) expect(rule.length).toBeGreaterThan(0);
  });

  it('has a player range a room can satisfy', () => {
    expect(module.meta.minPlayers).toBeGreaterThanOrEqual(1);
    expect(module.meta.maxPlayers).toBeGreaterThanOrEqual(module.meta.minPlayers);
    // ROOM_MAX_PLAYERS is 8; a game seating more could never fill.
    expect(module.meta.maxPlayers).toBeLessThanOrEqual(8);
  });

  it('tags its default config with its own id', () => {
    const config = module.defaultConfig(module.meta.minPlayers);
    expect(config.game).toBe(id);
  });

  it('survives its own default through normalizeConfig', () => {
    // The round trip everyone relies on: the lobby shows defaults, the host
    // changes nothing, and the same settings come back out.
    const config = module.defaultConfig(module.meta.minPlayers);
    const normalized = module.normalizeConfig(config, config, module.meta.minPlayers);
    expect(normalized).toEqual(config);
  });

  it('refuses junk settings without throwing, keeping the current config valid', () => {
    const config = module.defaultConfig(module.meta.minPlayers);
    for (const junk of [null, undefined, 42, 'nonsense', [], { game: 'not-a-game' }, { rounds: -5 }]) {
      const normalized = module.normalizeConfig(junk, config, module.meta.minPlayers);
      expect(normalized.game).toBe(id);
    }
  });

  it('creates an instance whose snapshot is tagged with its own id', () => {
    // The client narrows on `snap.game`, so a mismatch here would be read as a
    // different game's snapshot shape.
    const module_ = module;
    const instance = module_.create(
      seatsFor(module_),
      module_.defaultConfig(module_.meta.minPlayers),
      12345,
    );
    expect(instance.snapshot().game).toBe(id);
  });

  it('starts running and reports scores for every seat', () => {
    const seats = seatsFor(module);
    const instance = module.create(seats, module.defaultConfig(seats.length), 999);
    expect(instance.status()).toBe('running');

    const scores = instance.scores();
    for (const seat of seats) expect(scores).toHaveProperty(seat.id);
  });

  it('ignores junk input from the wire rather than throwing', () => {
    const seats = seatsFor(module);
    const instance = module.create(seats, module.defaultConfig(seats.length), 7);
    for (const junk of [null, undefined, 0, 'x', [], {}, { b: 'no' }, { i: Number.NaN }]) {
      expect(() => instance.applyInput(seats[0]!.id, junk)).not.toThrow();
    }
    // And from someone who is not even seated.
    expect(() => instance.applyInput('nobody', { b: 1, q: 1 })).not.toThrow();
  });

  it('tolerates resetInput for a seated and an unknown player', () => {
    const seats = seatsFor(module);
    const instance = module.create(seats, module.defaultConfig(seats.length), 7);
    expect(() => instance.resetInput(seats[0]!.id)).not.toThrow();
    expect(() => instance.resetInput('nobody')).not.toThrow();
  });

  it('answers privateFor with null for a stranger, and does not drain', () => {
    const seats = seatsFor(module);
    const instance = module.create(seats, module.defaultConfig(seats.length), 7);
    if (!instance.privateFor) return;

    expect(instance.privateFor('nobody')).toBeNull();

    // `Room` calls this once per player per broadcast and diffs the result, so
    // repeated calls must agree. A draining implementation would answer once
    // and then go quiet for the rest of the round.
    const first = JSON.stringify(instance.privateFor(seats[0]!.id) ?? null);
    const second = JSON.stringify(instance.privateFor(seats[0]!.id) ?? null);
    expect(second).toBe(first);
  });

  it('steps a few hundred ticks without throwing', () => {
    const seats = seatsFor(module);
    const instance = module.create(seats, module.defaultConfig(seats.length), 4242);
    expect(() => {
      for (let i = 0; i < 300; i++) {
        instance.stepTick();
        if (i % 2 === 0) instance.snapshot();
      }
    }).not.toThrow();
  });

  it('names a winner seat only from the seats that exist', () => {
    const seats = seatsFor(module);
    const instance = module.create(seats, module.defaultConfig(seats.length), 4242);
    for (let i = 0; i < 300; i++) instance.stepTick();

    const winner = instance.winnerSeat();
    if (winner !== null) {
      expect(winner).toBeGreaterThanOrEqual(0);
      expect(winner).toBeLessThan(seats.length);
    }
  });
});
