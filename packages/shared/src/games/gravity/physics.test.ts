import { describe, expect, it } from 'vitest';
import { RUN_HALF_H, RUN_HALF_W, TILE, TRACK_HEIGHT } from './constants';
import { pushOut, settleOnFloor, stepRunner, supported, type RunnerBody } from './physics';
import { boxHitsSolid, type Track } from './track';

/**
 * Build a track from ASCII rows, same convention as `chunks.ts`: `#` solid,
 * `.` air. Rows must all be the same width.
 */
function trackFrom(rows: string[]): Track {
  const height = rows.length;
  const width = rows[0]!.length;
  const solid = new Uint8Array(height * width);
  rows.forEach((line, row) => {
    for (let col = 0; col < width; col += 1) {
      if (line[col] === '#') solid[row * width + col] = 1;
    }
  });
  return {
    cols: width,
    rows: height,
    solid,
    pieces: ['test'],
    width: width * TILE,
    height: height * TILE,
  };
}

/** A normal 7-row corridor: solid ceiling row 0, solid floor row 6, open between. */
function corridorTrack(): Track {
  return trackFrom(['########', '........', '........', '........', '........', '........', '########']);
}

function body(overrides: Partial<RunnerBody> = {}): RunnerBody {
  return { x: TILE * 1.5, y: 0, vy: 0, g: 1, grounded: false, ...overrides };
}

const CONTROLLABLE = { flip: false, controllable: true };

describe('settleOnFloor', () => {
  it('stands the body on the actual floor under its column', () => {
    const track = corridorTrack();
    const b = body({ x: TILE * 2.5 });
    settleOnFloor(b, track);
    expect(b.grounded).toBe(true);
    expect(b.g).toBe(1);
    expect(b.vy).toBe(0);
    // Floor is row 6: top edge at 6 * TILE.
    expect(b.y).toBeCloseTo(6 * TILE - RUN_HALF_H, 1);
    expect(supported(track, b)).toBe(true);
  });

  it('finds a floor that is not the last row', () => {
    // A platform on row 4 instead of the bottom row.
    const track = trackFrom([
      '########',
      '........',
      '........',
      '........',
      '..####..',
      '........',
      '########',
    ]);
    const b = body({ x: TILE * 3.5 });
    settleOnFloor(b, track);
    expect(b.y).toBeCloseTo(4 * TILE - RUN_HALF_H, 1);
  });
});

describe('stepRunner — landing', () => {
  it('lands on the floor when falling', () => {
    const track = corridorTrack();
    const b = body({ x: TILE * 2.5, y: TILE * 2, vy: 0, g: 1, grounded: false });
    let result;
    for (let i = 0; i < 200; i += 1) {
      result = stepRunner(b, CONTROLLABLE, track, 1 / 60, 0);
      if (b.grounded) break;
    }
    expect(b.grounded).toBe(true);
    expect(result!.landed).toBe(true);
    expect(b.vy).toBe(0);
  });

  it('lands on the ceiling when flipped', () => {
    const track = corridorTrack();
    const b = body({ x: TILE * 2.5, y: TILE * 3, vy: 0, g: -1, grounded: false });
    let result;
    for (let i = 0; i < 200; i += 1) {
      result = stepRunner(b, CONTROLLABLE, track, 1 / 60, 0);
      if (b.grounded) break;
    }
    expect(b.grounded).toBe(true);
    expect(result!.landed).toBe(true);
    // Ceiling is row 0: bottom edge at TILE.
    expect(b.y).toBeCloseTo(TILE + RUN_HALF_H, 1);
  });

  it('flips gravity and leaves the surface on a rising edge of the button', () => {
    const track = corridorTrack();
    const b = body({ x: TILE * 2.5, y: TILE * 3, g: 1, grounded: true, vy: 0 });
    const result = stepRunner(b, { flip: true, controllable: true }, track, 1 / 60, 0);
    expect(result.flipped).toBe(true);
    expect(b.g).toBe(-1);
    expect(b.grounded).toBe(false);
  });
});

describe('stepRunner — tight corridor', () => {
  it('lands on a single-row-thick platform without tunnelling through it', () => {
    // Row 3 is only one tile thick, with open pockets on both sides — the
    // kind of thin floor a fast fall must still catch rather than skip past.
    const track = trackFrom([
      '########',
      '........',
      '........',
      '########',
      '........',
      '........',
      '########',
    ]);
    const b = body({ x: TILE * 2.5, y: TILE * 1 + RUN_HALF_H, vy: 0, g: 1, grounded: false });
    let result;
    for (let i = 0; i < 60; i += 1) {
      result = stepRunner(b, CONTROLLABLE, track, 1 / 60, 0);
      if (b.grounded) break;
    }
    expect(b.grounded).toBe(true);
    expect(result!.crushed).toBeFalsy();
    // Landed on row 3's top edge, not fallen all the way through to rows 4-5.
    expect(b.y).toBeCloseTo(3 * TILE - RUN_HALF_H, 1);
  });
});

describe('stepRunner — crushing and falling', () => {
  it('crushes a runner that hits solid while moving forward', () => {
    // Column 3 of row 2 is solid; the runner starts clear of it in column 1
    // and a single large horizontal step drives it straight in.
    const track = trackFrom(['########', '........', '...#....', '........', '........', '........', '########']);
    const b = body({ x: TILE * 1.5, y: TILE * 2 + RUN_HALF_H, g: 1, grounded: true, vy: 0 });
    // A one-tick step that lands the box squarely inside column 3's solid tile.
    const result = stepRunner(b, CONTROLLABLE, track, 1 / 60, 7200);
    expect(result.crushed).toBe(true);
  });

  it('falls out of the world through a ceiling gap', () => {
    // A gap in row 0 at column 2 — the only place a runner can leave the
    // track entirely, since every chunk's outer columns are sealed.
    const track = trackFrom([
      '##.#####',
      '........',
      '........',
      '........',
      '........',
      '........',
      '########',
    ]);
    const b = body({ x: TILE * 2.5, y: 5, g: -1, grounded: false, vy: -1000 });
    const result = stepRunner(b, CONTROLLABLE, track, 1 / 60, 0);
    expect(result.fell).toBe(true);
  });
});

describe('pushOut', () => {
  it('leaves a body that is already clear untouched', () => {
    const track = corridorTrack();
    const b = body({ x: TILE * 2.5, y: TILE * 3, g: 1 });
    const before = { ...b };
    pushOut(b, track);
    expect(b).toEqual(before);
  });

  it('pushes a body embedded in the floor back out, toward gravity', () => {
    const track = corridorTrack();
    // Sitting a little inside the floor (row 6 starts at 6*TILE).
    const b = body({ x: TILE * 2.5, y: 6 * TILE - RUN_HALF_H + 5, g: 1 });
    pushOut(b, track);
    expect(supported(track, b) || b.y + RUN_HALF_H <= 6 * TILE).toBe(true);
  });

  it('resolves an embedded body to a genuinely clear position, not a compounded snap', () => {
    // Row 3 is solid with open rows on both sides — dropping a body fully
    // inside it and pushing out must land somewhere that is actually clear,
    // not wherever two blind snaps in a row happen to land.
    const track = trackFrom([
      '########',
      '........',
      '........',
      '########',
      '........',
      '........',
      '########',
    ]);
    const b = body({ x: TILE * 2.5, y: 3 * TILE + RUN_HALF_H, g: -1 });
    pushOut(b, track);
    expect(boxHitsSolid(track, b.x - RUN_HALF_W, b.y - RUN_HALF_H, b.x + RUN_HALF_W, b.y + RUN_HALF_H)).toBe(
      false,
    );
    expect(b.y).toBeGreaterThan(0);
    expect(b.y).toBeLessThan(TRACK_HEIGHT);
  });
});

describe('supported', () => {
  it('is true standing on a floor and false past the edge of one', () => {
    const track = trackFrom([
      '########',
      '........',
      '........',
      '........',
      '........',
      '........',
      '####....',
    ]);
    const onFloor = body({ x: TILE * 1.5, y: 6 * TILE - RUN_HALF_H, g: 1 });
    expect(supported(track, onFloor)).toBe(true);

    const pastEdge = body({ x: TILE * 5.5, y: 6 * TILE - RUN_HALF_H, g: 1 });
    expect(supported(track, pastEdge)).toBe(false);
  });
});
