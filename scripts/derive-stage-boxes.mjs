/**
 * Derive Tank Trouble stage hitboxes from the backdrop artwork.
 *
 * A one-off authoring tool, not part of the build. Run it, paste the output
 * into `packages/shared/src/games/tanks/stages.ts`, and check the `--overlay`
 * dump before believing any of it.
 *
 *   node scripts/derive-stage-boxes.mjs                 # print the boxes
 *   node scripts/derive-stage-boxes.mjs --overlay out/  # also dump visual diffs
 *   node scripts/derive-stage-boxes.mjs --write         # patch stages.ts in place
 *
 * Why this exists: the boxes were originally eyeballed by hand, and measured
 * against the art they scored IoU 0.42 — half the drawn walls had no hitbox and
 * a third of the hitbox area sat over open sand. No global offset fixed it,
 * because the error was per-box. Deriving them from the pixels is the only way
 * to keep them honest, and re-running this is how the next stage gets authored.
 *
 * The classifier keys on the two faces every wall is drawn with: a pale lit top
 * face and a darker tan front face. Decoration (palms, barrels, crates, the
 * buildings) is deliberately *not* collidable — that matches what the hand
 * boxes always intended — and the small connected-component filter is what
 * drops their drop-shadows, which land in the same colour range as the front
 * face.
 */

import fs from 'node:fs';
import path from 'node:path';
import { decodePng } from './lib/png.mjs';
import { encodePng } from './lib/pngwrite.mjs';

/** Arena units. Must match `STAGE_W`/`STAGE_H` in `tanks/constants.ts`. */
const STAGE_W = 1280;
const STAGE_H = 720;

/** Mask resolution, in arena units per cell. 4 keeps edges within half a tank hull. */
const CELL = 4;
const COLS = STAGE_W / CELL;
const ROWS = STAGE_H / CELL;

/** A cell counts as wall when this fraction of its pixels are wall. */
const CELL_COVERAGE = 0.5;
/** Blobs smaller than this (in cells) are decoration shadows, not walls. */
const MIN_BLOB_CELLS = 60;
/** Stop emitting rectangles below this area, in cells. */
const MIN_RECT_CELLS = 20;
/** ...and never emit one thinner than this, in cells. */
const MIN_RECT_SIDE = 3;

const ART_DIR = 'packages/client/public/stages/tanks';

/**
 * The wall colours of each stage, sampled off the artwork.
 *
 * Hand-listed rather than clustered automatically, because the one stage where
 * automatic detection is hard is the one that matters: on `israel` the lit wall
 * top (250,210,147) sits 25 away from open sand (250,205,127) in Manhattan
 * distance, and red and green barely move between them. Every scheme that
 * found the other five by "the blockiest colour family" merged those two.
 *
 * `faces` are `[r, g, b, tolerance]` — the flat colours a wall is painted in,
 * with a lit top face and a darker front face on the stages drawn with a
 * pseudo-3D extrusion (alien_planet, israel, living_room, snow), and the bevel
 * tones on the two drawn flat (jungle, science_lab). Tolerance is Manhattan
 * distance and is per face rather than per stage, because on `israel` the top
 * face has to stay under 25 to avoid swallowing sand while the front face has
 * no near neighbour at all and wants a loose one to survive being shadowed.
 *
 * `inset` is how much of the image border to ignore, in mask cells. Only
 * `science_lab` needs a real one: its decorative bulkhead frame is painted the
 * same blue-grey as its walls, and left in it contributes forty thin boxes
 * around the rim that the arena boundary clamp already covers.
 *
 * Adding a stage means adding an entry here and re-running with `--overlay`.
 */
const STAGES = {
  alien_planet: { faces: [[81, 79, 120, 42], [46, 48, 77, 42]], inset: 3 },
  israel: { faces: [[250, 210, 147, 18], [178, 138, 89, 34]], inset: 3 },
  jungle: { faces: [[101, 98, 61, 34], [85, 83, 52, 34]], inset: 3 },
  living_room: { faces: [[82, 82, 80, 40], [54, 54, 53, 40]], inset: 4 },
  science_lab: { faces: [[79, 84, 106, 26], [63, 69, 93, 26], [40, 43, 60, 26]], inset: 13 },
  snow: { faces: [[56, 72, 88, 40], [24, 40, 56, 40]], inset: 3 },
};

function isWall(stage, r, g, b) {
  for (const [fr, fg, fb, tol] of stage.faces) {
    if (Math.abs(r - fr) + Math.abs(g - fg) + Math.abs(b - fb) <= tol) return true;
  }
  return false;
}

function buildMask(image, stage) {
  const { width, height, rgb } = image;
  const counts = new Uint16Array(COLS * ROWS);

  for (let y = 0; y < height; y += 1) {
    const row = Math.min(ROWS - 1, Math.floor(((y / height) * STAGE_H) / CELL));
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      if (!isWall(stage, rgb[i], rgb[i + 1], rgb[i + 2])) continue;
      const col = Math.min(COLS - 1, Math.floor(((x / width) * STAGE_W) / CELL));
      counts[row * COLS + col] += 1;
    }
  }

  const perCell = (width / COLS) * (height / ROWS);
  const mask = new Uint8Array(COLS * ROWS);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = counts[i] >= perCell * CELL_COVERAGE ? 1 : 0;
  }

  const edge = stage.inset;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const onRim = col < edge || row < edge || col >= COLS - edge || row >= ROWS - edge;
      if (onRim) mask[row * COLS + col] = 0;
    }
  }

  return mask;
}

/**
 * Close the seams, open away the linework, then drop specks.
 *
 * Both morphological passes are load-bearing and they are not interchangeable:
 *
 * - The **close** (dilate then erode) bridges the dark seam the art draws
 *   between adjacent stone blocks. Without it a single wall arrives as a row of
 *   separate rectangles.
 * - The **open** (erode then dilate) deletes structures thinner than the
 *   kernel — which is what every object's dark ink outline is, including the
 *   one tracing the whole image border. Leaving them in is not cosmetic: a
 *   one-cell line spanning the arena is the single largest-*area* rectangle in
 *   the mask, so it comes out of the greedy decomposition first and swamps it.
 */
function clean(mask) {
  const closed = erode(dilate(mask));
  const opened = dilate(erode(closed));
  return dropSmallBlobs(opened);
}

function dilate(mask) {
  const out = new Uint8Array(mask.length);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (!mask[row * COLS + col]) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const y = row + dy;
          const x = col + dx;
          if (y >= 0 && y < ROWS && x >= 0 && x < COLS) out[y * COLS + x] = 1;
        }
      }
    }
  }
  return out;
}

function erode(mask) {
  const out = new Uint8Array(mask.length);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy += 1) {
        for (let dx = -1; dx <= 1 && all; dx += 1) {
          const y = row + dy;
          const x = col + dx;
          if (y < 0 || y >= ROWS || x < 0 || x >= COLS || !mask[y * COLS + x]) all = 0;
        }
      }
      out[row * COLS + col] = all;
    }
  }
  return out;
}

function dropSmallBlobs(mask) {
  const out = new Uint8Array(mask);
  const seen = new Uint8Array(mask.length);
  const stack = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const blob = [];
    stack.push(start);
    seen[start] = 1;

    while (stack.length > 0) {
      const at = stack.pop();
      blob.push(at);
      const row = (at / COLS) | 0;
      const col = at % COLS;
      const neighbours = [
        col > 0 ? at - 1 : -1,
        col < COLS - 1 ? at + 1 : -1,
        row > 0 ? at - COLS : -1,
        row < ROWS - 1 ? at + COLS : -1,
      ];
      for (const next of neighbours) {
        if (next >= 0 && mask[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }

    if (blob.length < MIN_BLOB_CELLS) for (const at of blob) out[at] = 0;
  }

  return out;
}

/**
 * Greedy maximal-rectangle decomposition.
 *
 * Repeatedly take the single largest all-set rectangle and clear it. Greedy
 * rather than optimal on purpose: the optimal partition is NP-hard, and the
 * greedy one lands within a rectangle or two of it on shapes this blocky while
 * staying trivially auditable against the overlay dump.
 */
function toRects(mask) {
  const work = new Uint8Array(mask);
  const rects = [];

  for (;;) {
    const best = largestRect(work);
    if (!best || best.w * best.h < MIN_RECT_CELLS) break;

    rects.push(best);
    for (let row = best.y; row < best.y + best.h; row += 1) {
      work.fill(0, row * COLS + best.x, row * COLS + best.x + best.w);
    }
  }

  return rects;
}

/**
 * Largest all-set rectangle, by the standard histogram-and-stack sweep.
 *
 * The `MIN_RECT_SIDE` test is applied to *candidates* rather than to the
 * winner. Rejecting the winner afterwards would be a different algorithm: a
 * sliver spanning the arena beats every real wall on area, so filtering at the
 * end throws away the answer instead of the sliver.
 */
function largestRect(mask) {
  const heights = new Int32Array(COLS);
  let best = null;

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      heights[col] = mask[row * COLS + col] ? heights[col] + 1 : 0;
    }

    const stack = [];
    for (let col = 0; col <= COLS; col += 1) {
      const height = col === COLS ? 0 : heights[col];
      let start = col;
      while (stack.length > 0 && stack[stack.length - 1].height >= height) {
        const top = stack.pop();
        const width = col - top.start;
        const area = top.height * width;
        const usable = top.height >= MIN_RECT_SIDE && width >= MIN_RECT_SIDE;
        if (usable && (!best || area > best.w * best.h)) {
          best = { x: top.start, y: row - top.height + 1, w: width, h: top.height };
        }
        start = top.start;
      }
      if (height > 0) stack.push({ start, height });
    }
  }

  return best;
}

function toArena(rect) {
  return { x: rect.x * CELL, y: rect.y * CELL, w: rect.w * CELL, h: rect.h * CELL };
}

/** Matches `TANK_R` in `tanks/constants.ts`. Spawns must clear a wall by at least this. */
const TANK_R = 17;
/** ...and by this much more, so a tank is not born scraping one. */
const SPAWN_MARGIN = 10;

/**
 * Choose spawn points from the derived geometry.
 *
 * These used to be hand-placed, which was fine while nobody trusted the boxes
 * anyway — but re-deriving the walls moved thirteen of the forty-eight spawns
 * inside one, and a tank that starts inside a wall is stuck for the whole
 * round. Deriving both from the same mask is the only way they cannot drift
 * apart again.
 *
 * Farthest-point sampling rather than a fixed pattern: Tank Trouble wants
 * players to start out of each other's sights, and "as far as possible from
 * everyone chosen so far" says that directly, whatever the layout looks like.
 */
function pickSpawns(mask, rects, count = 8) {
  const clearance = clearanceField(mask);
  const reach = TANK_R + SPAWN_MARGIN;

  // The chamfer field is a cheap pre-filter — it measures centre to centre, so
  // it is optimistic by half a cell. The rectangles are then tested exactly,
  // with the same predicate the caller asserts with, so the two cannot
  // disagree about whether a spawn is legal.
  const open = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (clearance[row * COLS + col] < reach / CELL) continue;
      const x = col * CELL + CELL / 2;
      const y = row * CELL + CELL / 2;
      if (x < reach || y < reach || x > STAGE_W - reach || y > STAGE_H - reach) continue;
      const hits = rects.some(
        (r) => x + reach > r.x && x - reach < r.x + r.w && y + reach > r.y && y - reach < r.y + r.h,
      );
      if (!hits) open.push({ col, row });
    }
  }
  if (open.length === 0) return [];

  // Seed with the roomiest spot, then repeatedly take whichever open cell is
  // farthest from everything already picked.
  const chosen = [open.reduce((a, b) => (clearance[b.row * COLS + b.col] > clearance[a.row * COLS + a.col] ? b : a))];
  while (chosen.length < count) {
    let best = null;
    let bestScore = -1;
    for (const cell of open) {
      let nearest = Infinity;
      for (const other of chosen) {
        const d = (cell.col - other.col) ** 2 + (cell.row - other.row) ** 2;
        if (d < nearest) nearest = d;
      }
      if (nearest > bestScore) {
        bestScore = nearest;
        best = cell;
      }
    }
    if (!best) break;
    chosen.push(best);
  }

  return chosen.map((cell) => ({
    x: Math.round(cell.col * CELL + CELL / 2),
    y: Math.round(cell.row * CELL + CELL / 2),
  }));
}

/**
 * Distance from every cell to the nearest wall or arena edge, in cells.
 *
 * Two-pass chamfer rather than an exact Euclidean transform — the error is
 * under a cell, which is 4 arena units against a `SPAWN_MARGIN` of 10.
 */
function clearanceField(mask) {
  const dist = new Float32Array(COLS * ROWS);
  const at = (col, row) =>
    col < 0 || row < 0 || col >= COLS || row >= ROWS ? 0 : dist[row * COLS + col];

  for (let i = 0; i < mask.length; i += 1) dist[i] = mask[i] ? 0 : Infinity;

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const i = row * COLS + col;
      if (dist[i] === 0) continue;
      dist[i] = Math.min(dist[i], at(col - 1, row) + 1, at(col, row - 1) + 1, at(col - 1, row - 1) + 1.414);
    }
  }
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    for (let col = COLS - 1; col >= 0; col -= 1) {
      const i = row * COLS + col;
      if (dist[i] === 0) continue;
      dist[i] = Math.min(dist[i], at(col + 1, row) + 1, at(col, row + 1) + 1, at(col + 1, row + 1) + 1.414);
    }
  }

  // The arena edge is a wall too (`physics.ts` clamps to it), and it is not in
  // the mask, so fold it in rather than letting a corner look infinitely roomy.
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const edge = Math.min(col + 1, row + 1, COLS - col, ROWS - row);
      const i = row * COLS + col;
      if (edge < dist[i]) dist[i] = edge;
    }
  }

  return dist;
}

/** Intersection-over-union of the derived boxes against the source mask. */
function score(mask, rects) {
  const painted = new Uint8Array(mask.length);
  for (const rect of rects) {
    for (let row = rect.y; row < rect.y + rect.h; row += 1) {
      painted.fill(1, row * COLS + rect.x, row * COLS + rect.x + rect.w);
    }
  }
  let both = 0;
  let either = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] || painted[i]) either += 1;
    if (mask[i] && painted[i]) both += 1;
  }
  return either === 0 ? 1 : both / either;
}

function overlay(image, rects, file) {
  const { width, height, rgb } = image;
  const out = new Uint8Array(rgb);

  for (const rect of rects) {
    const x0 = Math.round((rect.x * CELL * width) / STAGE_W);
    const x1 = Math.round(((rect.x + rect.w) * CELL * width) / STAGE_W);
    const y0 = Math.round((rect.y * CELL * height) / STAGE_H);
    const y1 = Math.round(((rect.y + rect.h) * CELL * height) / STAGE_H);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const edge = x < x0 + 2 || x >= x1 - 2 || y < y0 + 2 || y >= y1 - 2;
        const i = (y * width + x) * 3;
        if (edge) {
          out[i] = 255;
          out[i + 1] = 0;
          out[i + 2] = 255;
        } else {
          out[i + 1] = Math.min(255, out[i + 1] + 60);
        }
      }
    }
  }

  fs.writeFileSync(file, encodePng(width, height, out));
}

// ---------------------------------------------------------------------------

const overlayDir = process.argv.includes('--overlay')
  ? process.argv[process.argv.indexOf('--overlay') + 1]
  : null;
const write = process.argv.includes('--write');
if (overlayDir) fs.mkdirSync(overlayDir, { recursive: true });

const STAGES_TS = 'packages/shared/src/games/tanks/stages.ts';
let source = write ? fs.readFileSync(STAGES_TS, 'utf8') : '';

for (const [id, stage] of Object.entries(STAGES)) {
  const image = decodePng(fs.readFileSync(path.join(ART_DIR, `tank_stage_${id}.png`)));
  const mask = clean(buildMask(image, stage));
  const cells = toRects(mask);
  const rects = cells.map(toArena);
  const spawns = pickSpawns(mask, rects);

  process.stderr.write(`${id}: ${rects.length} boxes, IoU ${score(mask, cells).toFixed(3)}\n`);
  if (overlayDir) overlay(image, cells, path.join(overlayDir, `${id}.png`));

  // The check that made deriving spawns necessary in the first place, kept as
  // an assertion: re-deriving the walls once moved thirteen hand-placed spawns
  // inside one.
  for (const [index, spawn] of spawns.entries()) {
    const clash = rects.find(
      (r) =>
        spawn.x + TANK_R > r.x &&
        spawn.x - TANK_R < r.x + r.w &&
        spawn.y + TANK_R > r.y &&
        spawn.y - TANK_R < r.y + r.h,
    );
    if (clash) process.stderr.write(`  !! ${id} spawn ${index} (${spawn.x},${spawn.y}) is inside a wall\n`);
  }
  if (spawns.length < 8) process.stderr.write(`  !! ${id} only found ${spawns.length} spawns\n`);

  const boxBody = rects.map((r) => `      { x: ${r.x}, y: ${r.y}, w: ${r.w}, h: ${r.h} },`).join('\n');
  const spawnBody = spawns.map((s) => `      { x: ${s.x}, y: ${s.y} },`).join('\n');

  if (!write) {
    console.log(`  // ${id}`);
    console.log('    obstacles: [\n' + boxBody + '\n    ],');
    console.log('    spawns: [\n' + spawnBody + '\n    ],');
    continue;
  }

  // Both literals are anchored on the stage id so the stages cannot be patched
  // into each other's slots.
  source = patch(source, id, 'obstacles', boxBody);
  source = patch(source, id, 'spawns', spawnBody);
}

function patch(text, id, field, body) {
  const anchor = new RegExp(`(  ${id}: \\{[\\s\\S]*?${field}: \\[)[\\s\\S]*?(\\n    \\],)`, 'm');
  if (!anchor.test(text)) throw new Error(`could not find the ${field} block for ${id}`);
  return text.replace(anchor, `$1\n${body}$2`);
}

if (write) {
  fs.writeFileSync(STAGES_TS, source);
  process.stderr.write(`\nwrote ${STAGES_TS}\n`);
}
