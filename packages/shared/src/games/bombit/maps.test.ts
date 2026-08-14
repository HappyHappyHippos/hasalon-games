import { describe, expect, it } from 'vitest';
import {
  BOMBIT_MAPS,
  BOMBIT_MAP_IDS,
  buildArena,
  escapePocket,
  getBombitMap,
  orderSpawns,
  templateSpawns,
  tileKindAt,
  validateMap,
} from './maps';
import { makeRng } from './rng';
import { MAX_PLAYERS } from './constants';
import type { BombitMapId } from './types';

const ids = Object.keys(BOMBIT_MAPS) as BombitMapId[];

describe.each(ids)('%s', (id) => {
  const map = BOMBIT_MAPS[id];

  it('is a well-formed, connected board with an escape from every spawn', () => {
    // The whole reason `validateMap` exists: a map is a hand-edited block of
    // text, and every way of getting it wrong — a short row, an unknown glyph,
    // a pocket walled off from the rest, a spawn with nowhere to run from its
    // own first bomb — is invisible until somebody is standing in it.
    expect(validateMap(map)).toEqual([]);
  });

  it('is filed under its own id and listed in the carousel', () => {
    expect(map.id).toBe(id);
    expect(BOMBIT_MAP_IDS).toContain(id);
  });

  it('gives every seat its own spawn tile', () => {
    const spawns = orderSpawns(templateSpawns(map));
    expect(spawns.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
    const seen = new Set(spawns.slice(0, MAX_PLAYERS).map((s) => `${s.cx},${s.cy}`));
    expect(seen.size).toBe(MAX_PLAYERS);
  });

  it('clears an off-axis escape around every spawn it seats', () => {
    // The one safety promise the game makes at round start: a bomb on your own
    // spawn must be survivable, which means somewhere reachable that is in
    // neither its row nor its column — safe at *any* blast range, not just the
    // one you start with.
    const arena = buildArena(map, MAX_PLAYERS, 1, makeRng(99));
    for (const spawn of arena.spawns.slice(0, MAX_PLAYERS)) {
      const pocket = escapePocket(map, arena.walls, spawn);
      for (const cell of pocket) expect(arena.crates[cell]).toBe(0);
      const offAxis = pocket.filter((cell) => {
        const cx = cell % map.cols;
        const cy = (cell - cx) / map.cols;
        return cx !== spawn.cx && cy !== spawn.cy;
      });
      expect(offAxis.length).toBeGreaterThan(0);
    }
  });

  it('never puts a crate on a wall', () => {
    const arena = buildArena(map, 4, 1, makeRng(7));
    for (let cell = 0; cell < arena.walls.length; cell += 1) {
      if (arena.walls[cell] === 1) expect(arena.crates[cell]).toBe(0);
    }
  });
});

describe('spawn ordering', () => {
  it.each(ids)('puts two players as far apart as %s allows', (id) => {
    // Reading order would sit the first three shoulder to shoulder along the
    // top wall, which is the difference between a duel and an ambush.
    const spawns = templateSpawns(BOMBIT_MAPS[id]);
    let widest = 0;
    for (const a of spawns) {
      for (const b of spawns) {
        widest = Math.max(widest, Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy));
      }
    }
    const [first, second] = orderSpawns(spawns);
    expect(Math.abs(first!.cx - second!.cx) + Math.abs(first!.cy - second!.cy)).toBe(widest);
  });

  it('is a pure function of the template', () => {
    const once = orderSpawns(templateSpawns(BOMBIT_MAPS.arena));
    const twice = orderSpawns(templateSpawns(BOMBIT_MAPS.arena));
    expect(once).toEqual(twice);
  });
});

describe('crate density', () => {
  it('fills exactly the share asked for, rather than a coin flip per tile', () => {
    const map = BOMBIT_MAPS.classic;
    let candidates = 0;
    for (let cy = 0; cy < map.rows; cy += 1) {
      for (let cx = 0; cx < map.cols; cx += 1) {
        if (tileKindAt(map, cx, cy) === 'crate') candidates += 1;
      }
    }

    // Counted before the escape pockets are cleared, so this is the roll
    // itself: a binomial around the target would let "sparse" occasionally deal
    // a packed board.
    const arena = buildArena(map, 1, 0.5, makeRng(1234));
    const filled = arena.crates.reduce((sum, v) => sum + v, 0);
    const pocket = escapePocket(map, arena.walls, arena.spawns[0]!).length;
    expect(filled).toBeGreaterThan(Math.round(candidates * 0.5) - pocket - 1);
    expect(filled).toBeLessThanOrEqual(Math.round(candidates * 0.5));
  });

  it('deals the same board twice from the same seed', () => {
    const map = BOMBIT_MAPS.warehouse;
    const a = buildArena(map, 4, 0.72, makeRng(555));
    const b = buildArena(map, 4, 0.72, makeRng(555));
    expect([...a.crates]).toEqual([...b.crates]);
  });
});

describe('getBombitMap', () => {
  it('returns the named map, and something real for random', () => {
    expect(getBombitMap('warehouse', 0).id).toBe('warehouse');
    for (let seed = 0; seed < 20; seed += 1) {
      expect(BOMBIT_MAP_IDS).toContain(getBombitMap('random', seed).id);
    }
  });
});
