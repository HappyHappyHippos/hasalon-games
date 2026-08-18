import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../../engine';
import type { GameSeat } from '../../gameModule';
import {
  BASE_SPEED,
  FLAME_TICKS,
  FUSE_TICKS,
  MAX_BOMBS,
  MAX_RANGE,
  SLOW_FACTOR,
  SPEED_STEPS,
  START_RANGE,
  TILE,
} from './constants';
import { BOMBIT_MAPS, buildArena, fillFor } from './maps';
import { bombitModule } from './module';
import { centreOf, tileOf } from './movement';
import { makeRng } from './rng';
import {
  applyInput,
  blockedTile,
  createState,
  defaultConfig,
  makeSnapshot,
  stepTick,
} from './sim';
import {
  IN_BOMB,
  IN_DOWN,
  IN_LEFT,
  IN_RIGHT,
  IN_UP,
  type Arena,
  type BombitConfig,
  type BombitEvent,
  type BombitMapId,
  type BombitState,
} from './types';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function seats(count: number): GameSeat[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    colorIndex: i,
  }));
}

function config(patch: Partial<BombitConfig> = {}): BombitConfig {
  return { ...defaultConfig(), ...patch };
}

/**
 * An empty walled box, so a test can say exactly where the walls are.
 *
 * The generated maps are the right thing to test *map* rules against and the
 * wrong thing to test blast rules against — a pillar three tiles away decides
 * the answer, and the test then reads as a statement about the map.
 */
function blankArena(cols = 11, rows = 9): Arena {
  const walls = new Uint8Array(cols * rows);
  for (let cx = 0; cx < cols; cx += 1) {
    walls[cx] = 1;
    walls[(rows - 1) * cols + cx] = 1;
  }
  for (let cy = 0; cy < rows; cy += 1) {
    walls[cy * cols] = 1;
    walls[cy * cols + cols - 1] = 1;
  }
  return {
    mapId: 'classic',
    cols,
    rows,
    walls,
    crates: new Uint8Array(cols * rows),
    spawns: [{ cx: 1, cy: 1 }],
  };
}

/**
 * A match on a board the test controls, with everyone parked where it says.
 *
 * A lone player is quietly given a bystander in the far corner, because a round
 * with one player left standing is over on its first tick — the phase flips to
 * `roundOver`, nothing moves again, and every assertion after that reads as a
 * movement bug. The bystander is parked outside anything these tests blow up.
 */
function scenario(
  places: { cx: number; cy: number }[],
  patch: Partial<BombitConfig> = {},
  arena: Arena = blankArena(),
): BombitState {
  const parked = places.length > 1 ? places : [...places, { cx: 1, cy: arena.rows - 2 }];
  const state = createState(seats(parked.length), config(patch), 1234);
  state.arena = arena;
  state.buried = new Map();
  state.pickups = [];
  state.phase = 'playing';
  state.phaseTicks = 0;
  parked.forEach((place, seat) => {
    const player = state.players[seat]!;
    player.x = centreOf(place.cx);
    player.y = centreOf(place.cy);
  });
  return state;
}

let seq = 0;

function hold(state: BombitState, seat: number, bits: number): void {
  seq += 1;
  applyInput(state, `p${seat}`, seq, bits);
}

/** Run `ticks`, collecting everything the sim reported along the way. */
function run(state: BombitState, ticks: number): BombitEvent[] {
  const out: BombitEvent[] = [];
  for (let i = 0; i < ticks; i += 1) out.push(...stepTick(state));
  return out;
}

function cell(state: BombitState, cx: number, cy: number): number {
  return cy * state.arena.cols + cx;
}

function burning(state: BombitState, cx: number, cy: number): boolean {
  return state.flames.some((f) => f.cell === cell(state, cx, cy));
}

// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces byte-identical snapshots from the same seed and input log', () => {
    // The property the whole netcode rests on: the client re-runs `stepBody`
    // for its own player and reconciles against this. Anything the sim reads
    // that is not in the state it was handed — a clock, an unseeded random —
    // shows up here and nowhere else until a match desyncs.
    const play = (): string => {
      const instance = bombitModule.create(seats(4), config({ mapId: 'classic' }), 20260814);
      const frames: unknown[] = [];
      for (let tick = 0; tick < 900; tick += 1) {
        for (let s = 0; s < 4; s += 1) {
          // A different, repeating pattern per seat, so bombs get placed, walls
          // get hit and paths cross.
          const phase = (tick + s * 37) % 60;
          let bits = 0;
          if (phase < 15) bits = IN_RIGHT;
          else if (phase < 30) bits = IN_DOWN;
          else if (phase < 45) bits = IN_LEFT;
          else bits = IN_UP;
          if (phase % 29 === 0) bits |= IN_BOMB;
          instance.applyInput(`p${s}`, { seq: tick + 1, bits });
        }
        instance.stepTick();
        if (tick % 2 === 0) frames.push(instance.snapshot());
      }
      return JSON.stringify(frames);
    };

    expect(play()).toBe(play());
  });
});

describe('placing bombs', () => {
  it('drops one on the tile the player is standing on', () => {
    const state = scenario([{ cx: 3, cy: 3 }]);
    hold(state, 0, IN_BOMB);
    run(state, 1);

    expect(state.bombs).toHaveLength(1);
    expect(tileOf(state.bombs[0]!.x)).toBe(3);
    expect(tileOf(state.bombs[0]!.y)).toBe(3);
    expect(state.players[0]!.liveBombs).toBe(1);
  });

  it('needs a fresh press, so running with the key held does not carpet the floor', () => {
    const state = scenario([{ cx: 2, cy: 4 }]);
    state.players[0]!.maxBombs = 5;
    hold(state, 0, IN_BOMB | IN_RIGHT);
    run(state, 60);

    expect(state.bombs).toHaveLength(1);
  });

  it('refuses more than the player is carrying, and frees the slot when one goes off', () => {
    const state = scenario([{ cx: 2, cy: 2 }]);
    hold(state, 0, IN_BOMB);
    run(state, 1);
    hold(state, 0, 0);
    run(state, 1);
    // Move a tile over and try again: still capped at one.
    state.players[0]!.x = centreOf(4);
    hold(state, 0, IN_BOMB);
    run(state, 1);
    expect(state.bombs).toHaveLength(1);

    run(state, FUSE_TICKS);
    expect(state.bombs).toHaveLength(0);
    expect(state.players[0]!.liveBombs).toBe(0);
  });

  it('never stacks two bombs on one tile', () => {
    const state = scenario([
      { cx: 5, cy: 5 },
      { cx: 5, cy: 5 },
    ]);
    hold(state, 0, IN_BOMB);
    hold(state, 1, IN_BOMB);
    run(state, 1);
    expect(state.bombs).toHaveLength(1);
  });
});

describe('explosions', () => {
  it('burns a cross of exactly `range` tiles each way', () => {
    const state = scenario([{ cx: 5, cy: 4 }]);
    state.players[0]!.range = 2;
    hold(state, 0, IN_BOMB);
    run(state, FUSE_TICKS + 1);

    for (const [cx, cy] of [
      [5, 4],
      [6, 4],
      [7, 4],
      [3, 4],
      [4, 4],
      [5, 2],
      [5, 3],
      [5, 5],
      [5, 6],
    ]) {
      expect(burning(state, cx!, cy!)).toBe(true);
    }
    // One tile past the range, and off the axes entirely.
    expect(burning(state, 8, 4)).toBe(false);
    expect(burning(state, 5, 7)).toBe(false);
    expect(burning(state, 6, 5)).toBe(false);
  });

  it('is stopped dead by a wall', () => {
    const arena = blankArena();
    arena.walls[4 * arena.cols + 6] = 1;
    const state = scenario([{ cx: 5, cy: 4 }], {}, arena);
    state.players[0]!.range = 4;
    hold(state, 0, IN_BOMB);
    run(state, FUSE_TICKS + 1);

    expect(burning(state, 6, 4)).toBe(false);
    expect(burning(state, 7, 4)).toBe(false);
    // ...and the other arms are unaffected.
    expect(burning(state, 3, 4)).toBe(true);
  });

  it('destroys a crate, and stops there', () => {
    const arena = blankArena();
    arena.crates[4 * arena.cols + 6] = 1;
    const state = scenario([{ cx: 5, cy: 4 }], {}, arena);
    state.players[0]!.range = 4;
    hold(state, 0, IN_BOMB);
    const events = run(state, FUSE_TICKS + 1);

    expect(state.arena.crates[4 * arena.cols + 6]).toBe(0);
    expect(events).toContainEqual({ t: 'crate', cell: 4 * arena.cols + 6 });
    expect(burning(state, 6, 4)).toBe(true);
    expect(burning(state, 7, 4)).toBe(false);
  });

  it('sets off a bomb it reaches, and that blast stops there too', () => {
    const state = scenario([
      { cx: 3, cy: 4 },
      { cx: 5, cy: 4 },
    ]);
    state.players[0]!.range = 3;
    state.players[1]!.range = 1;
    hold(state, 0, IN_BOMB);
    hold(state, 1, IN_BOMB);
    run(state, 1);
    hold(state, 0, 0);
    hold(state, 1, 0);

    // Both were lit on the same tick, so nudge the second one's fuse out of
    // reach: the chain is the thing under test, not a coincidence of timing.
    state.bombs[1]!.fuse = FUSE_TICKS * 3;

    const events = run(state, FUSE_TICKS + 1);
    expect(state.bombs).toHaveLength(0);
    expect(events).toContainEqual({ t: 'boom', cell: cell(state, 5, 4), chained: true });
    // The first bomb's arm is absorbed by the bomb it triggered...
    expect(burning(state, 6, 4)).toBe(true);
    // ...and the chained bomb's own single-tile blast is what reached there.
    expect(burning(state, 7, 4)).toBe(false);
  });

  it('runs a chain of four along a line in one tick', () => {
    const state = scenario([
      { cx: 2, cy: 4 },
      { cx: 4, cy: 4 },
      { cx: 6, cy: 4 },
      { cx: 8, cy: 4 },
    ]);
    for (const player of state.players) player.range = 2;
    for (let s = 0; s < 4; s += 1) hold(state, s, IN_BOMB);
    run(state, 1);
    for (let s = 0; s < 4; s += 1) hold(state, s, 0);
    for (let i = 1; i < 4; i += 1) state.bombs[i]!.fuse = FUSE_TICKS * 4;

    run(state, FUSE_TICKS + 1);
    expect(state.bombs).toHaveLength(0);
    for (const cx of [2, 4, 6, 8]) expect(burning(state, cx, 4)).toBe(true);
  });
});

describe('kicking', () => {
  it('sends a bomb sliding when a player walks into it', () => {
    const state = scenario([{ cx: 2, cy: 4 }]);
    hold(state, 0, IN_BOMB);
    run(state, 1);
    hold(state, 0, 0);
    run(state, 1);

    // Step clear to the left, turn round, and walk back into it.
    hold(state, 0, IN_LEFT);
    run(state, 30);
    expect(tileOf(state.players[0]!.x)).toBe(1);

    hold(state, 0, IN_RIGHT);
    const events = run(state, 30);

    expect(events.some((e) => e.t === 'kick')).toBe(true);
    expect(tileOf(state.bombs[0]!.x)).toBeGreaterThan(2);
  });

  it('stops the bomb against a wall, on a tile centre', () => {
    const arena = blankArena();
    const state = scenario([{ cx: 2, cy: 4 }], {}, arena);
    hold(state, 0, IN_BOMB);
    run(state, 1);
    hold(state, 0, 0);
    run(state, 1);
    hold(state, 0, IN_LEFT);
    run(state, 30);
    hold(state, 0, IN_RIGHT);
    run(state, FUSE_TICKS - 40);

    const bomb = state.bombs[0]!;
    // The board is 11 wide with a wall at 10, so the last tile it can reach is 9.
    expect(tileOf(bomb.x)).toBe(9);
    expect(bomb.x).toBeCloseTo(centreOf(9), 6);
    expect(bomb.dir).toBe(0);
  });

  it('stops the bomb against another bomb', () => {
    const state = scenario([
      { cx: 2, cy: 4 },
      { cx: 6, cy: 4 },
    ]);
    hold(state, 0, IN_BOMB);
    hold(state, 1, IN_BOMB);
    run(state, 1);
    hold(state, 0, IN_LEFT);
    hold(state, 1, 0);
    run(state, 30);
    hold(state, 0, IN_RIGHT);
    run(state, 40);

    const kicked = state.bombs.find((b) => b.owner === 0)!;
    expect(tileOf(kicked.x)).toBe(5);
    expect(kicked.dir).toBe(0);
  });

  it('does nothing at all to a bomb that is wedged against a wall', () => {
    // Found in a live match: leaning on an immovable bomb re-kicked it every
    // tick — the bomb was set moving, `stepBomb` found the next tile blocked
    // and stopped it in the same tick, and the next tick it was a resting bomb
    // being pressed into again. Two bombs that never moved produced twenty-odd
    // kick events, which is twenty-odd thumps of sound effect down the wire.
    const arena = blankArena();
    const state = scenario([{ cx: 8, cy: 4 }], {}, arena);
    hold(state, 0, IN_BOMB);
    run(state, 1);
    hold(state, 0, 0);
    run(state, 1);
    // Step off to the left, then lean back into it. Column 9 is the last open
    // one, so the bomb at 9 has nowhere to go.
    state.players[0]!.x = centreOf(7);
    state.bombs[0]!.x = centreOf(9);

    hold(state, 0, IN_RIGHT);
    const events = run(state, 90);

    expect(events.filter((e) => e.t === 'kick')).toHaveLength(0);
    expect(state.bombs[0]!.x).toBe(centreOf(9));
    expect(state.bombs[0]!.dir).toBe(0);
  });

  it('reports one kick per shove, not one per tick of leaning', () => {
    const state = scenario([{ cx: 2, cy: 4 }]);
    hold(state, 0, IN_BOMB);
    run(state, 1);
    hold(state, 0, IN_LEFT);
    run(state, 30);
    hold(state, 0, IN_RIGHT);
    const events = run(state, 60);

    expect(events.filter((e) => e.t === 'kick')).toHaveLength(1);
  });

  it('leaves a bomb the player is standing on alone', () => {
    const state = scenario([{ cx: 2, cy: 4 }]);
    hold(state, 0, IN_BOMB);
    run(state, 1);
    hold(state, 0, IN_RIGHT);
    const events = run(state, 10);

    expect(events.some((e) => e.t === 'kick')).toBe(false);
    expect(state.bombs[0]!.dir).toBe(0);
  });
});

describe('walking past bombs', () => {
  it('lets a player off the bomb they just dropped, and not back on', () => {
    const state = scenario([{ cx: 2, cy: 4 }]);
    hold(state, 0, IN_BOMB | IN_RIGHT);
    run(state, 1);
    hold(state, 0, IN_RIGHT);
    run(state, 40);

    // Out of the tile, having walked straight off it.
    expect(tileOf(state.players[0]!.x)).toBeGreaterThan(2);

    // And back: the bomb is solid now, so they stop against it rather than
    // stepping through. (It is not kicked either — that needs it to be the tile
    // they are walking *into*, which from here it is.)
    const before = state.bombs[0]!.x;
    hold(state, 0, IN_LEFT);
    run(state, 2);
    expect(state.bombs[0]!.x).toBe(before);
    expect(state.players[0]!.x).toBeGreaterThan(centreOf(2));
  });
});

describe('dying', () => {
  it('kills a player standing in the fire', () => {
    const state = scenario([
      { cx: 3, cy: 4 },
      { cx: 4, cy: 4 },
    ]);
    state.players[0]!.range = 2;
    hold(state, 0, IN_BOMB);
    const events = run(state, FUSE_TICKS + 1);

    expect(state.players[1]!.alive).toBe(false);
    expect(events).toContainEqual({ t: 'death', seat: 1, by: null });
  });

  it('takes the bomber with it', () => {
    const state = scenario([
      { cx: 3, cy: 4 },
      { cx: 9, cy: 1 },
    ]);
    hold(state, 0, IN_BOMB);
    run(state, FUSE_TICKS + 1);
    expect(state.players[0]!.alive).toBe(false);
  });

  it('spends one shield per blast, not one per tick of it', () => {
    const state = scenario([
      { cx: 3, cy: 4 },
      { cx: 9, cy: 1 },
    ]);
    state.players[0]!.shields = 2;
    hold(state, 0, IN_BOMB);
    const events = run(state, FUSE_TICKS + FLAME_TICKS + 2);

    expect(state.players[0]!.alive).toBe(true);
    expect(state.players[0]!.shields).toBe(1);
    expect(events.filter((e) => e.t === 'shieldPop')).toHaveLength(1);
  });
});

describe('powerups', () => {
  it('reveals what a crate was hiding, and hands it over when walked on', () => {
    const arena = blankArena();
    arena.crates[4 * arena.cols + 7] = 1;
    const state = scenario([{ cx: 5, cy: 4 }], {}, arena);
    state.buried = new Map([[4 * arena.cols + 7, 'range']]);
    state.players[0]!.range = 2;
    // Standing on their own bomb, so a shield is what lets this test be about
    // the powerup rather than about the very short life of a careless bomber.
    state.players[0]!.shields = 1;
    hold(state, 0, IN_BOMB);
    run(state, FUSE_TICKS + 1);

    expect(state.pickups).toHaveLength(1);
    expect(state.pickups[0]!.kind).toBe('range');

    // Wait for the fire to go out, then walk over to collect it.
    run(state, FLAME_TICKS + 1);
    hold(state, 0, IN_RIGHT);
    const events = run(state, 60);

    expect(state.pickups).toHaveLength(0);
    expect(events).toContainEqual({ t: 'pickup', seat: 0, kind: 'range' });
    expect(state.players[0]!.range).toBe(3);
  });

  it('stacks the four a player keeps, up to their caps', () => {
    const state = scenario([{ cx: 5, cy: 4 }]);
    const player = state.players[0]!;
    for (let i = 0; i < 20; i += 1) {
      state.pickups = [{ cell: cell(state, 5, 4), kind: 'bomb' }];
      run(state, 1);
      state.pickups = [{ cell: cell(state, 5, 4), kind: 'range' }];
      run(state, 1);
      state.pickups = [{ cell: cell(state, 5, 4), kind: 'speed' }];
      run(state, 1);
    }
    expect(player.maxBombs).toBe(MAX_BOMBS);
    expect(player.range).toBe(MAX_RANGE);
    expect(player.speedLevel).toBe(SPEED_STEPS);
  });

  it('lands slow and reverse on everyone except whoever picked it up', () => {
    const state = scenario([
      { cx: 5, cy: 4 },
      { cx: 2, cy: 2 },
      { cx: 8, cy: 6 },
    ]);
    state.pickups = [{ cell: cell(state, 5, 4), kind: 'slow' }];
    run(state, 1);
    state.pickups = [{ cell: cell(state, 5, 4), kind: 'reverse' }];
    run(state, 1);

    expect(state.players[0]!.slowTicks).toBe(0);
    expect(state.players[0]!.reverseTicks).toBe(0);
    for (const seat of [1, 2]) {
      expect(state.players[seat]!.slowTicks).toBeGreaterThan(0);
      expect(state.players[seat]!.reverseTicks).toBeGreaterThan(0);
    }
  });

  it('burns a powerup left lying in the fire', () => {
    const state = scenario([{ cx: 5, cy: 4 }]);
    state.players[0]!.range = 2;
    state.pickups = [{ cell: cell(state, 7, 4), kind: 'bomb' }];
    hold(state, 0, IN_BOMB);
    run(state, FUSE_TICKS + 1);
    expect(state.pickups).toHaveLength(0);
  });

  it('is switched off entirely when the host turns it off', () => {
    const state = createState(seats(2), config({ powerupsEnabled: false }), 42);
    expect(state.buried.size).toBe(0);
  });
});

describe('the round', () => {
  it('goes to the last player standing', () => {
    const state = scenario([
      { cx: 3, cy: 4 },
      { cx: 4, cy: 4 },
    ]);
    state.players[0]!.range = 1;
    // Seat 0 is out of reach of its own blast at range 1 only if it moves, so
    // put the bomb next to seat 1 instead and step seat 0 clear.
    state.players[0]!.x = centreOf(5);
    state.players[0]!.shields = 1;
    hold(state, 0, IN_BOMB);
    const events = run(state, FUSE_TICKS + 2);

    expect(events).toContainEqual({ t: 'roundOver', winnerSeat: 0 });
    expect(state.players[0]!.roundWins).toBe(1);
    expect(state.phase).toBe('roundOver');
  });

  it('is a draw when the last two go together', () => {
    const state = scenario([
      { cx: 4, cy: 4 },
      { cx: 5, cy: 4 },
    ]);
    state.players[0]!.range = 1;
    hold(state, 0, IN_BOMB);
    const events = run(state, FUSE_TICKS + 2);

    expect(events).toContainEqual({ t: 'roundOver', winnerSeat: null });
    expect(state.players.every((p) => p.roundWins === 0)).toBe(true);
  });

  it('is a draw when the clock runs out with everyone alive', () => {
    const state = scenario([
      { cx: 2, cy: 2 },
      { cx: 8, cy: 6 },
    ]);
    state.roundTicks = 3;
    const events = run(state, 4);
    expect(events).toContainEqual({ t: 'roundOver', winnerSeat: null });
  });

  it('deals a fresh board and returns everyone to a starting kit', () => {
    const state = createState(seats(2), config({ targetWins: 5 }), 7);
    state.phase = 'playing';
    state.players[0]!.range = 6;
    state.players[0]!.maxBombs = 5;
    state.players[1]!.alive = false;
    run(state, 1);
    expect(state.phase).toBe('roundOver');

    run(state, 200);
    expect(state.phase).toBe('countdown');
    expect(state.round).toBe(2);
    expect(state.players[0]!.range).toBe(START_RANGE);
    expect(state.players[0]!.maxBombs).toBe(1);
    expect(state.players[1]!.alive).toBe(true);
  });

  it('ends the match once someone reaches the target', () => {
    const state = createState(seats(2), config({ targetWins: 1 }), 7);
    state.phase = 'playing';
    state.players[1]!.alive = false;
    const events = run(state, 300);
    expect(events).toContainEqual({ t: 'matchOver' });
    expect(state.phase).toBe('matchOver');
  });
});

describe('the snapshot', () => {
  it('carries the live crate layer, so a mid-round joiner sees the same ground', () => {
    const arena = blankArena();
    arena.crates[4 * arena.cols + 6] = 1;
    arena.crates[4 * arena.cols + 7] = 1;
    const state = scenario([{ cx: 5, cy: 4 }], {}, arena);

    const before = makeSnapshot(state, []);
    hold(state, 0, IN_BOMB);
    run(state, FUSE_TICKS + 1);
    const after = makeSnapshot(state, []);

    expect(before.cr).not.toBe(after.cr);
    expect(after.map).toBe(state.arena.mapId);
  });
});

describe('the first bomb is survivable from every spawn', () => {
  // The one promise a map makes at round start, checked as a *time* rather than
  // as a shape: it is no use knowing there is a way out if the fuse burns
  // through before anyone could walk it. Measured at the slowest the game can
  // make a player — level zero, slowed — because that is the worst case a
  // second round can deal.
  const ids = Object.keys(BOMBIT_MAPS) as BombitMapId[];

  it.each(ids)('%s', (id) => {
    const map = BOMBIT_MAPS[id];
    const arena = buildArena(map, 8, fillFor('packed'), makeRng(2026));
    const worstSpeed = BASE_SPEED * SLOW_FACTOR;

    for (const spawn of arena.spawns.slice(0, 8)) {
      const steps = stepsToSafety(arena, spawn);
      expect(steps).toBeGreaterThan(0);
      const secondsNeeded = (steps * TILE) / worstSpeed;
      expect(secondsNeeded).toBeLessThan(FUSE_TICKS / TICK_RATE);
    }
  });
});

/** Breadth-first over open ground to the nearest tile off both of the spawn's axes. */
function stepsToSafety(arena: Arena, spawn: { cx: number; cy: number }): number {
  const seen = new Set<number>([spawn.cy * arena.cols + spawn.cx]);
  let frontier = [spawn];
  let steps = 0;
  while (frontier.length > 0 && steps < 12) {
    steps += 1;
    const next: { cx: number; cy: number }[] = [];
    for (const at of frontier) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const cx = at.cx + dx!;
        const cy = at.cy + dy!;
        if (blockedTile(arena, cx, cy)) continue;
        const key = cy * arena.cols + cx;
        if (seen.has(key)) continue;
        seen.add(key);
        if (cx !== spawn.cx && cy !== spawn.cy) return steps;
        next.push({ cx, cy });
      }
    }
    frontier = next;
  }
  return 0;
}
