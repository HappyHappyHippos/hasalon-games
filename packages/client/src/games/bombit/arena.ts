/**
 * The board, rebuilt on the client from what the snapshot actually carries.
 *
 * Walls come from the map template, which never changes and which the client
 * already has compiled in — `map` in the snapshot is three characters that
 * stand in for a few hundred bytes of grid. Crates come from the packed layer
 * (`cr`), because they are the one part of the board that changes, and sending
 * the *live* layer rather than a seed plus a growing list of holes is what lets
 * a player who joins mid-round draw the same ground as everyone else from the
 * first frame they receive.
 *
 * Memoised on both, because a new board arrives once a round and a new crate
 * layer only when something burns — rebuilding either every frame would be the
 * most expensive thing the renderer does.
 */

import {
  BOMBIT_MAPS,
  tileKindAt,
  unpackBits,
  type BombitMapId,
  type BombitSnapshot,
} from '@mg/shared/bombit';

export interface ClientArena {
  mapId: BombitMapId;
  cols: number;
  rows: number;
  walls: Uint8Array;
  crates: Uint8Array;
}

const wallCache = new Map<BombitMapId, Uint8Array>();

function wallsFor(mapId: BombitMapId): Uint8Array {
  const cached = wallCache.get(mapId);
  if (cached) return cached;

  const map = BOMBIT_MAPS[mapId] ?? BOMBIT_MAPS.classic;
  const walls = new Uint8Array(map.cols * map.rows);
  for (let cy = 0; cy < map.rows; cy += 1) {
    for (let cx = 0; cx < map.cols; cx += 1) {
      if (tileKindAt(map, cx, cy) === 'wall') walls[cy * map.cols + cx] = 1;
    }
  }
  wallCache.set(mapId, walls);
  return walls;
}

let lastKey = '';
let lastArena: ClientArena | null = null;

export function arenaFromSnapshot(snap: BombitSnapshot): ClientArena {
  const key = `${snap.map}:${snap.cr}`;
  if (lastArena && lastKey === key) return lastArena;

  const map = BOMBIT_MAPS[snap.map] ?? BOMBIT_MAPS.classic;
  lastArena = {
    mapId: map.id,
    cols: map.cols,
    rows: map.rows,
    walls: wallsFor(map.id),
    crates: unpackBits(snap.cr, map.cols * map.rows),
  };
  lastKey = key;
  return lastArena;
}

/** Wall or crate — the same predicate the server collides against. */
export function blockedIn(arena: ClientArena, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= arena.cols || cy >= arena.rows) return true;
  const index = cy * arena.cols + cx;
  return arena.walls[index] === 1 || arena.crates[index] === 1;
}

export function resetArenaCache(): void {
  lastKey = '';
  lastArena = null;
}
