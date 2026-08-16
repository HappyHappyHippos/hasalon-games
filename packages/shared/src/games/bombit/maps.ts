/**
 * The maps, and how a round's arena is built from one.
 *
 * A map is four characters on a grid and nothing else, which is the whole
 * point — it is meant to be edited by hand:
 *
 * ```
 *   #  wall    solid forever; blocks movement and blast
 *   .  floor   walkable
 *   x  crate   a crate *may* stand here — see below
 *   S  spawn   floor that a player may start on
 * ```
 *
 * `x` is a candidate rather than a crate. The layout is re-rolled every round
 * from the candidate cells at the density the host picked, so the same map
 * plays differently twice running while its walls, routes and sight lines stay
 * exactly as authored. Adding a map is one entry in `BOMBIT_MAPS` and one id in
 * `BombitMapId`; `validateMap` (and the test that runs it over every map) is
 * what catches an unreachable pocket or a spawn with nowhere to run.
 */

import { DENSITY_FILL, POWERUP_CHANCE, POWERUP_WEIGHTS } from './constants';
import { nextFloat, shuffle, type RngState } from './rng';
import type {
  Arena,
  BombitMap,
  BombitMapId,
  BombitPowerup,
  BombitStageId,
  TileKind,
} from './types';

/**
 * ── ASSET SWAP POINT ────────────────────────────────────────────────────────
 * One backdrop image per stage, stretched to cover the whole arena. Every one
 * of them is decoration over a complete procedural drawing (see the note at the
 * top of `client/game/images.ts`), so a missing file leaves the board fully
 * legible rather than blank.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const BOMBIT_STAGE_URL: Record<BombitStageId, string> = {
  green: '/stages/bombit/bombit_stage_green.png',
  desert: '/stages/bombit/bombit_stage_desert.png',
  living_room: '/stages/bombit/bombit_stage_living_room.png',
  arctic: '/stages/bombit/bombit_stage_arctic.png',
};

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * Every board is 23×13.
 *
 * That is 1.77:1 — 16:9 to within half a percent, and the closest an odd×odd
 * grid gets to it. Odd is not negotiable: the pillar lattice needs walls on the
 * even coordinates and a solid border on both, and an even dimension puts two
 * open rows or two pillars side by side at one edge.
 *
 * The ratio is the *display* ratio, not just bookkeeping — `Renderer.stageFor`
 * builds its `CanvasStage` at `cols * TILE` by `rows * TILE`, so the grid's
 * shape is the letterbox's shape. At 15×13 the board was nearly square and a
 * phone held sideways spent most of its screen on bars, while the stage art
 * behind it (drawn 16:9) was cropped hard to cover. Both fit now.
 */

/**
 * The pillar lattice everyone already knows how to read. Wide open rows between
 * the pillars, so a chase can go a long way before it has to commit.
 */
const CLASSIC: BombitMap = {
  id: 'classic',
  name: 'Classic',
  stage: 'green',
  cols: 23,
  rows: 13,
  layout: [
    '#######################',
    '#SxxxxxxxxxSxxxxxxxxxS#',
    '#x#x#x#x#x#x#x#x#x#x#x#',
    '#xxxxxxxxxxxxxxxxxxxxx#',
    '#x#x#x#x#x#x#x#x#x#x#x#',
    '#xxxxxxxxxxxxxxxxxxxxx#',
    '#S#x#x#x#x#x#x#x#x#x#S#',
    '#xxxxxxxxxxxxxxxxxxxxx#',
    '#x#x#x#x#x#x#x#x#x#x#x#',
    '#xxxxxxxxxxxxxxxxxxxxx#',
    '#x#x#x#x#x#x#x#x#x#x#x#',
    '#SxxxxxxxxxSxxxxxxxxxS#',
    '#######################',
  ],
};

/**
 * The lattice cut through by one open lane each way. The lanes are the whole
 * map: they are the fastest route anywhere and the worst place to be caught.
 */
const CROSSROADS: BombitMap = {
  id: 'crossroads',
  name: 'Crossroads',
  stage: 'desert',
  cols: 23,
  rows: 13,
  layout: [
    '#######################',
    '#SxxxxxxxxxSxxxxxxxxxS#',
    '#x#x#x#x#x#.#x#x#x#x#x#',
    '#xxxxxxxxxxxxxxxxxxxxx#',
    '#x#x#x#x#x#.#x#x#x#x#x#',
    '#xxxxxxxxxxxxxxxxxxxxx#',
    '#S...................S#',
    '#xxxxxxxxxxxxxxxxxxxxx#',
    '#x#x#x#x#x#.#x#x#x#x#x#',
    '#xxxxxxxxxxxxxxxxxxxxx#',
    '#x#x#x#x#x#.#x#x#x#x#x#',
    '#SxxxxxxxxxSxxxxxxxxxS#',
    '#######################',
  ],
};

/**
 * Wide, with a walled chamber in the middle that has four ways in and no way to
 * see across. Eight people fit here without the round turning into a queue.
 */
const ARENA: BombitMap = {
  id: 'arena',
  name: 'Arena',
  stage: 'living_room',
  cols: 23,
  rows: 13,
  layout: [
    '#######################',
    '#Sxxxxxxxx.S.xxxxxxxxS#',
    '#xxx#xxxxxxxxxxxxx#xxx#',
    '#xxxxxxxxxxxxxxxxxxxxx#',
    '#xxxxxxxx##.##xxxxxxxx#',
    '#xxxxxxxx#...#xxxxxxxx#',
    '#S....x.........x....S#',
    '#xxxxxxxx#...#xxxxxxxx#',
    '#xxxxxxxx##.##xxxxxxxx#',
    '#xxxxxxxxxxxxxxxxxxxxx#',
    '#xxx#xxxxxxxxxxxxx#xxx#',
    '#Sxxxxxxxx.S.xxxxxxxxS#',
    '#######################',
  ],
};

/** Short walls and blind corners. The map where kicking a bomb pays best. */
const WAREHOUSE: BombitMap = {
  id: 'warehouse',
  name: 'Warehouse',
  stage: 'arctic',
  cols: 23,
  rows: 13,
  layout: [
    '#######################',
    '#Sxx#xxxxxxSxxxxxx#xxS#',
    '#x.x#x.xx.x.x.xx.x#x.x#',
    '#x.xxx.xx.x.x.xx.xxx.x#',
    '#xxx#xxxxxxxxxxxxx#xxx#',
    '#xxxxxxxxxxxxxxxxxxxxx#',
    '#Sx.....x.x.x.x.....xS#',
    '#xxxxxxxxxxxxxxxxxxxxx#',
    '#xxx#xxxxxxxxxxxxx#xxx#',
    '#x.xxx.xx.x.x.xx.xxx.x#',
    '#x.x#x.xx.x.x.xx.x#x.x#',
    '#Sxx#xxxxxxSxxxxxx#xxS#',
    '#######################',
  ],
};

export const BOMBIT_MAPS: Record<BombitMapId, BombitMap> = {
  classic: CLASSIC,
  crossroads: CROSSROADS,
  arena: ARENA,
  warehouse: WAREHOUSE,
};

/** Display order in the map carousel. */
export const BOMBIT_MAP_IDS: BombitMapId[] = ['classic', 'crossroads', 'arena', 'warehouse'];

export function getBombitMap(id: BombitMapId | 'random', seed: number): BombitMap {
  if (id !== 'random' && BOMBIT_MAPS[id]) return BOMBIT_MAPS[id];
  const index = (seed >>> 0) % BOMBIT_MAP_IDS.length;
  return BOMBIT_MAPS[BOMBIT_MAP_IDS[index]!];
}

// ---------------------------------------------------------------------------
// Reading a template
// ---------------------------------------------------------------------------

export function tileKindAt(map: BombitMap, cx: number, cy: number): TileKind {
  const row = map.layout[cy];
  if (!row) return 'wall';
  switch (row[cx]) {
    case '#':
      return 'wall';
    case 'x':
      return 'crate';
    case 'S':
      return 'spawn';
    default:
      return 'floor';
  }
}

/** Every `S`, in reading order. `orderSpawns` decides who actually gets which. */
export function templateSpawns(map: BombitMap): { cx: number; cy: number }[] {
  const out: { cx: number; cy: number }[] = [];
  for (let cy = 0; cy < map.rows; cy += 1) {
    for (let cx = 0; cx < map.cols; cx += 1) {
      if (tileKindAt(map, cx, cy) === 'spawn') out.push({ cx, cy });
    }
  }
  return out;
}

/**
 * Spawns re-ordered so that taking the first `n` of them spreads `n` players as
 * far apart as the map allows.
 *
 * Farthest-point ordering rather than a hand-written per-map list: reading order
 * would put the first three players shoulder to shoulder along the top wall, and
 * a hand-written order is one more thing to get wrong when a map is edited. The
 * tie-break is reading order, so this is a pure function of the template.
 */
export function orderSpawns(spawns: { cx: number; cy: number }[]): { cx: number; cy: number }[] {
  if (spawns.length <= 1) return [...spawns];

  const remaining = [...spawns];
  const out = [remaining.shift()!];

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = -1;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i]!;
      let nearest = Infinity;
      for (const chosen of out) {
        const d = Math.abs(chosen.cx - candidate.cx) + Math.abs(chosen.cy - candidate.cy);
        if (d < nearest) nearest = d;
      }
      if (nearest > bestScore) {
        bestScore = nearest;
        bestIndex = i;
      }
    }
    out.push(remaining.splice(bestIndex, 1)[0]!);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Building a round's arena
// ---------------------------------------------------------------------------

/**
 * Roll this round's crates onto a map.
 *
 * `playerCount` is not decoration: the escape pockets are only cleared around
 * the spawns actually in use, so a two-player round on a big map keeps the rest
 * of the board packed instead of opening eight pockets nobody is standing in.
 */
export function buildArena(
  map: BombitMap,
  playerCount: number,
  density: number,
  rng: RngState,
): Arena {
  const size = map.cols * map.rows;
  const walls = new Uint8Array(size);
  const crates = new Uint8Array(size);
  const candidates: number[] = [];

  for (let cy = 0; cy < map.rows; cy += 1) {
    for (let cx = 0; cx < map.cols; cx += 1) {
      const index = cy * map.cols + cx;
      const kind = tileKindAt(map, cx, cy);
      if (kind === 'wall') walls[index] = 1;
      else if (kind === 'crate') candidates.push(index);
    }
  }

  // Shuffle and take a prefix rather than rolling per cell: the count is then
  // exactly the density asked for, instead of a binomial around it, so "sparse"
  // cannot occasionally deal a packed board.
  const wanted = Math.round(candidates.length * density);
  for (const index of shuffle(rng, candidates).slice(0, wanted)) crates[index] = 1;

  const spawns = orderSpawns(templateSpawns(map));
  const seated = spawns.slice(0, Math.max(1, playerCount));
  for (const spawn of seated) {
    for (const cell of escapePocket(map, walls, spawn)) crates[cell] = 0;
  }

  return { mapId: map.id, cols: map.cols, rows: map.rows, walls, crates, spawns };
}

const DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

/** Legs of the L, shortest first — so the escape found is the nearest one. */
const ESCAPE_LEGS: [number, number][] = [
  [1, 1],
  [2, 1],
  [1, 2],
  [2, 2],
];

/**
 * The tiles kept clear around a spawn, so a player's *first* bomb is survivable.
 *
 * The guarantee is specifically an **off-axis** tile: somewhere that is neither
 * in the bomb's row nor its column, and therefore safe from a bomb on the spawn
 * at any blast range at all. Clearing a straight run instead would only be safe
 * for as long as nobody raised the range, which is the first thing everybody
 * does.
 *
 * The turn is searched over every L the spawn can reach rather than just the two
 * directions free at the spawn itself. Classic's side spawns sit in a one-wide
 * corridor with walls on both flanks — nothing turns *at* the spawn, and the way
 * out is to run one tile up the corridor and turn there.
 *
 * Every free neighbour is cleared as well, so the pocket does not read as a dead
 * end. Three tiles is the worst case, which is well inside a fuse even at the
 * slowest speed the game can inflict.
 */
export function escapePocket(
  map: BombitMap,
  walls: Uint8Array,
  spawn: { cx: number; cy: number },
): number[] {
  const at = (cx: number, cy: number): number => cy * map.cols + cx;
  const isWall = (cx: number, cy: number): boolean =>
    cx < 0 || cy < 0 || cx >= map.cols || cy >= map.rows || walls[at(cx, cy)] === 1;

  const cells = [at(spawn.cx, spawn.cy)];
  const open = DIRS.filter((d) => !isWall(spawn.cx + d.dx, spawn.cy + d.dy));
  for (const d of open) cells.push(at(spawn.cx + d.dx, spawn.cy + d.dy));

  for (const [a, b] of ESCAPE_LEGS) {
    for (const primary of open) {
      for (const secondary of DIRS) {
        if (primary.dx * secondary.dx + primary.dy * secondary.dy !== 0) continue;
        const path = walkL(spawn, [a, primary], [b, secondary], isWall, at);
        if (path) return [...cells, ...path];
      }
    }
  }
  return cells;
}

/** The cells of one L, or null if it runs into a wall. */
function walkL(
  spawn: { cx: number; cy: number },
  first: [number, { dx: number; dy: number }],
  second: [number, { dx: number; dy: number }],
  isWall: (cx: number, cy: number) => boolean,
  at: (cx: number, cy: number) => number,
): number[] | null {
  const path: number[] = [];
  let cx = spawn.cx;
  let cy = spawn.cy;
  for (const [steps, d] of [first, second]) {
    for (let i = 0; i < steps; i += 1) {
      cx += d.dx;
      cy += d.dy;
      if (isWall(cx, cy)) return null;
      path.push(at(cx, cy));
    }
  }
  return path;
}

// ---------------------------------------------------------------------------
// What the crates are hiding
// ---------------------------------------------------------------------------

const WEIGHTED: BombitPowerup[] = [];
for (const [kind, weight] of Object.entries(POWERUP_WEIGHTS)) {
  for (let i = 0; i < weight; i += 1) WEIGHTED.push(kind as BombitPowerup);
}

/**
 * Decide up front what every crate is hiding.
 *
 * Rolled at build time rather than when a crate burns, so the round's contents
 * are fixed by its seed: two clients replaying the same round see the same
 * drops, and the sequence cannot be perturbed by how many bombs happened to go
 * off before a given crate.
 */
export function burySecrets(arena: Arena, rng: RngState): Map<number, BombitPowerup> {
  const buried = new Map<number, BombitPowerup>();
  for (let index = 0; index < arena.crates.length; index += 1) {
    if (arena.crates[index] !== 1) continue;
    if (nextFloat(rng) >= POWERUP_CHANCE) continue;
    const roll = Math.floor(nextFloat(rng) * WEIGHTED.length);
    buried.set(index, WEIGHTED[Math.min(WEIGHTED.length - 1, roll)]!);
  }
  return buried;
}

export function fillFor(density: string): number {
  return DENSITY_FILL[density] ?? DENSITY_FILL.normal!;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface MapProblem {
  mapId: BombitMapId;
  message: string;
}

/**
 * Everything a hand-edited map can get wrong that would only show up mid-match.
 *
 * Run over every map by `maps.test.ts`, so editing a layout string and getting
 * it slightly wrong is a failing test rather than a player walled into a pocket
 * on a Friday night.
 */
export function validateMap(map: BombitMap): MapProblem[] {
  const problems: MapProblem[] = [];
  const fail = (message: string): void => {
    problems.push({ mapId: map.id, message });
  };

  if (map.layout.length !== map.rows) fail(`declares ${map.rows} rows but has ${map.layout.length}`);
  for (let cy = 0; cy < map.layout.length; cy += 1) {
    const row = map.layout[cy]!;
    if (row.length !== map.cols) fail(`row ${cy} is ${row.length} wide, expected ${map.cols}`);
    for (const char of row) {
      if (!'#.xS'.includes(char)) fail(`row ${cy} has an unknown tile '${char}'`);
    }
  }
  if (problems.length > 0) return problems;

  // A blast that runs off the board is a crash waiting to happen, and an open
  // edge is not something anyone means to author.
  for (let cx = 0; cx < map.cols; cx += 1) {
    if (tileKindAt(map, cx, 0) !== 'wall' || tileKindAt(map, cx, map.rows - 1) !== 'wall') {
      fail('the top and bottom edges must be solid wall');
      break;
    }
  }
  for (let cy = 0; cy < map.rows; cy += 1) {
    if (tileKindAt(map, 0, cy) !== 'wall' || tileKindAt(map, map.cols - 1, cy) !== 'wall') {
      fail('the left and right edges must be solid wall');
      break;
    }
  }

  const spawns = templateSpawns(map);
  if (spawns.length < 8) fail(`has ${spawns.length} spawns, needs 8`);

  // Reachability is checked over walls only: a crate is a door that takes one
  // bomb to open, so a region behind crates is reachable, and a region behind
  // walls is not.
  const size = map.cols * map.rows;
  const walls = new Uint8Array(size);
  for (let cy = 0; cy < map.rows; cy += 1) {
    for (let cx = 0; cx < map.cols; cx += 1) {
      if (tileKindAt(map, cx, cy) === 'wall') walls[cy * map.cols + cx] = 1;
    }
  }

  const seen = new Uint8Array(size);
  const start = spawns[0];
  if (!start) return problems;
  const queue = [start.cy * map.cols + start.cx];
  seen[queue[0]!] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head]!;
    const cx = cell % map.cols;
    const cy = (cell - cx) / map.cols;
    for (const d of DIRS) {
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= map.cols || ny >= map.rows) continue;
      const next = ny * map.cols + nx;
      if (walls[next] === 1 || seen[next] === 1) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }

  for (let cell = 0; cell < size; cell += 1) {
    if (walls[cell] === 1 || seen[cell] === 1) continue;
    fail(`tile ${cell % map.cols},${Math.floor(cell / map.cols)} is walled off from the spawns`);
    break;
  }

  // And the promise the pocket makes: somewhere off both axes of the spawn,
  // reachable without digging.
  for (const spawn of spawns) {
    const pocket = escapePocket(map, walls, spawn);
    const escaped = pocket.some((cell) => {
      const cx = cell % map.cols;
      const cy = (cell - cx) / map.cols;
      return cx !== spawn.cx && cy !== spawn.cy;
    });
    if (!escaped) fail(`spawn ${spawn.cx},${spawn.cy} has no off-axis escape`);
  }

  return problems;
}
