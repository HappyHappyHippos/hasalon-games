/**
 * Split the Worms stage paintings into the three things the game needs.
 *
 * A one-off authoring tool, not part of the build. Same shape as
 * `derive-stage-boxes.mjs`, and for the same reason: the art is the source of
 * truth for where the ground is, and the only way to know a classifier works is
 * to look at what it produced.
 *
 *   node scripts/derive-worms-terrain.mjs                 # classify and report
 *   node scripts/derive-worms-terrain.mjs --overlay out/  # dump visual diffs
 *   node scripts/derive-worms-terrain.mjs --write         # emit the artefacts
 *
 * The paintings in `assets/stages/worms/` are 1672x941, 24-bit, and **fully
 * opaque** — terrain and background are baked into one image. Worms needs them
 * apart, because a crater has to reveal something:
 *
 *   1. `worms_stage_<id>_terrain.png`  the painting with the background knocked
 *      out. RGBA. This is the layer the client punches holes in.
 *   2. `worms_stage_<id>_bg.png`       what is behind it. RGB, reconstructed by
 *      interpolating each terrain span between the real background pixels above
 *      and below it.
 *   3. `shared/games/worms/masks/<id>.ts`  the collision bitmask, base64 RLE.
 *      Server and client decode the identical string, so they can never
 *      disagree about where the ground is.
 *
 * The mask is the authority and the terrain layer's alpha is derived from it,
 * not the other way round. Deriving them separately is how you get painted rock
 * you fall through and invisible ledges you stand on.
 */

import fs from 'node:fs';
import path from 'node:path';
import { decodePng } from './lib/png.mjs';
import { encodePng } from './lib/pngwrite.mjs';

/** Must match `WORLD_W`/`WORLD_H`/`MASK_CELL` in `shared/games/worms/constants.ts`. */
const WORLD_W = 1672;
const WORLD_H = 940;
const CELL = 2;
const COLS = WORLD_W / CELL;
const ROWS = WORLD_H / CELL;

/** A cell is solid when this fraction of its pixels classify as terrain. */
const CELL_COVERAGE = 0.5;

const SRC_DIR = 'assets/stages/worms';
const ART_OUT = 'packages/client/public/stages/worms';
const MASK_OUT = 'packages/shared/src/games/worms/masks';

/** Worm half-extents plus room to breathe. Matches `constants.ts`; spawns must clear this. */
const WORM_HALF_W = 8;
const WORM_HALF_H = 12;
const SPAWN_MARGIN = 6;

/**
 * How each painting separates into terrain and background.
 *
 * Two mechanisms, because the three paintings are genuinely different problems:
 *
 * **`mode: 'colour'`** — a per-pixel predicate. Works when terrain and
 * background live in different parts of colour space.
 *
 * **`mode: 'flood'`** — region-grow from the image border, stepping to a
 * neighbour only when it is within `tolerance` per channel. Everything the fill
 * reaches is background. This keys on the *silhouette edge* rather than on
 * colour, so it works on art where the two overlap completely, and it walks
 * smooth gradients happily because only the local step is bounded.
 *
 * Per stage:
 *
 * - **green** — colour, and the easy one. Sky, ocean and the hazy distance are
 *   strongly blue-dominant; clouds and foam are near-white. Everything else —
 *   brown rock, grass, and the trees, crates and fences standing on it — is
 *   terrain, which is what you want: blowing the palm tree off a cliff is a
 *   feature.
 *
 * - **arctic** — flood, because colour is *hopeless* here and it is worth
 *   knowing why before trying again. Sampled off the painting: a background
 *   mountain is rgb(160,205,250) and a lit ice face is rgb(163,212,249). The ice
 *   spans b−r 111..132 and luma 71..180; the sky spans b−r 61..160 and luma
 *   119..215; the water sits inside both. Every threshold that finds the ice
 *   also finds the sky. The silhouette edge, on the other hand, is crisp
 *   everywhere, which is exactly what a flood keys on.
 *
 * - **living_room** — colour, splitting on luma: brick at 79..94 against
 *   wallpaper at 174..208, with the baked ambient-occlusion shadow behind the
 *   structure staying up at 174, safely on the background side. A flood is
 *   *worse* here — it would come in off the bottom border and eat the floor and
 *   the rug, which are the ground. The furniture on the platforms classifies as
 *   terrain and stays that way: the mask and the painted layer are the same
 *   shape by construction, so standing on the sofa reads as intended.
 *
 * `seeds` are extra flood start points, for background the border cannot reach —
 * arctic's rope bridge seals the sky under it into a pocket, and without a seed
 * that whole pocket comes out solid. `exclude` rects force background after
 * rasterisation: clouds, the flanking mountains, and the living room's wall
 * decorations, none of which any predicate distinguishes from the real thing.
 * Both are hand-authored and both are why `--overlay` exists.
 *
 * `close`/`open` are cell radii. `subsurface` overrides the reconstructed
 * background below a y line, so a hole in the living-room floor shows dirt
 * instead of daylight from the window.
 */
const STAGES = {
  small_green: {
    mode: 'mask',
    maskFile: 'worms_stage_small_green_mask.png',
    exclude: [],
    close: 2,
    open: 1,
    fillHoles: 400,
    minBlob: 200,
    fallback: [86, 160, 214],
  },
  arctic: {
    mode: 'mask',
    maskFile: 'worms_stage_arctic_mask.png',
    exclude: [],
    close: 2,
    open: 1,
    fillHoles: 400,
    minBlob: 200,
    fallback: [92, 156, 214],
  },
  volcano: {
    mode: 'mask',
    maskFile: 'worms_stage_volcano_mask.png',
    exclude: [],
    close: 2,
    open: 1,
    fillHoles: 400,
    minBlob: 200,
    fallback: [180, 80, 50],
  },
};

const STAGE_IDS = Object.keys(STAGES);

// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const overlayAt = args.indexOf('--overlay');
  const overlayDir = overlayAt >= 0 ? args[overlayAt + 1] : null;
  const only = args.find((a) => STAGE_IDS.includes(a));

  if (overlayDir) fs.mkdirSync(overlayDir, { recursive: true });
  if (write) {
    fs.mkdirSync(ART_OUT, { recursive: true });
    fs.mkdirSync(MASK_OUT, { recursive: true });
  }

  for (const id of only ? [only] : STAGE_IDS) {
    const stage = STAGES[id];
    const src = decodePng(fs.readFileSync(path.join(SRC_DIR, `worms_stage_${id}.png`)));
    if (src.width !== WORLD_W || src.height < WORLD_H) {
      throw new Error(`${id}: expected >=${WORLD_W}x${WORLD_H}, got ${src.width}x${src.height}`);
    }

    const raw = classify(src, stage, id);
    let mask = rasterise(raw);
    clearRects(mask, stage.exclude);
    mask = close(mask, stage.close);
    mask = open(mask, stage.open);
    mask = fillEnclosed(mask, stage.fillHoles);
    mask = dropSmallBlobs(mask, stage.minBlob);

    const solidPx = pixelSilhouette(mask, raw);
    const terrain = buildTerrainLayer(src, solidPx);
    const background = buildBackground(src, solidPx, stage);
    const spawns = pickSpawns(mask);

    report(id, mask, spawns);

    if (overlayDir) {
      dump(overlayDir, `${id}_overlay.png`, overlay(src, solidPx), 3);
      dump(overlayDir, `${id}_bg.png`, background, 3);
      dump(overlayDir, `${id}_composite.png`, composite(background, terrain, spawns), 3);
    }

    if (write) {
      dump(ART_OUT, `worms_stage_${id}_terrain.png`, terrain, 4);
      dump(ART_OUT, `worms_stage_${id}_bg.png`, background, 3);
      fs.writeFileSync(path.join(MASK_OUT, `${id}.ts`), maskModule(id, mask));
      console.log(`  spawns: ${JSON.stringify(spawns)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Per-pixel terrain/background, at source resolution, cropped to the world. */
function classify(src, stage, id) {
  if (stage.mode === 'mask') return classifyByMask(src, stage, id);
  return stage.mode === 'flood' ? classifyByFlood(src, stage) : classifyByColour(src, stage);
}

function classifyByMask(src, stage, id) {
  const maskFile = stage.maskFile || `worms_stage_${id}_mask.png`;
  const maskPath = path.join(SRC_DIR, maskFile);
  if (!fs.existsSync(maskPath)) {
    throw new Error(`Mask image not found at ${maskPath}`);
  }
  const maskImg = decodePng(fs.readFileSync(maskPath));
  const out = new Uint8Array(WORLD_W * WORLD_H);
  const threshold = stage.maskThreshold ?? 30; // sum of r+g+b <= 30 considered black
  const invert = stage.invertMask ?? false;
  for (let y = 0; y < WORLD_H; y += 1) {
    for (let x = 0; x < WORLD_W; x += 1) {
      const i = (y * maskImg.width + x) * 3;
      const r = maskImg.rgb[i];
      const g = maskImg.rgb[i + 1];
      const b = maskImg.rgb[i + 2];
      const isBlack = r + g + b <= threshold;
      const isSolid = invert ? !isBlack : isBlack;
      out[y * WORLD_W + x] = isSolid ? 1 : 0;
    }
  }
  return out;
}

function classifyByColour(src, stage) {
  const out = new Uint8Array(WORLD_W * WORLD_H);
  for (let y = 0; y < WORLD_H; y += 1) {
    for (let x = 0; x < WORLD_W; x += 1) {
      const i = (y * src.width + x) * 3;
      const r = src.rgb[i];
      const g = src.rgb[i + 1];
      const b = src.rgb[i + 2];
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      out[y * WORLD_W + x] = stage.terrain(r, g, b, L) ? 1 : 0;
    }
  }
  return out;
}

/**
 * Terrain is whatever a flood from the border cannot reach.
 *
 * The step test is per-channel and *local* — the running colour is never
 * compared to the seed. That is the whole trick: a sky gradient running from
 * rgb(53,134,213) at the top to rgb(189,222,250) at the horizon is a continuous
 * walk of one-or-two-per-pixel steps, so the fill crosses all of it, while the
 * one-to-two-pixel antialiased edge where sky meets ice is a ~40-per-channel
 * cliff it cannot climb.
 *
 * Four-connected, and an explicit queue rather than recursion: at 1.5M pixels a
 * recursive fill overflows the stack on the first stage.
 */
function classifyByFlood(src, stage) {
  const tol = stage.tolerance;
  const bg = new Uint8Array(WORLD_W * WORLD_H);
  const queue = new Int32Array(WORLD_W * WORLD_H);
  let head = 0;
  let tail = 0;

  const push = (at) => {
    if (bg[at]) return;
    bg[at] = 1;
    queue[tail] = at;
    tail += 1;
  };

  for (let x = 0; x < WORLD_W; x += 1) {
    push(x);
    push((WORLD_H - 1) * WORLD_W + x);
  }
  for (let y = 0; y < WORLD_H; y += 1) {
    push(y * WORLD_W);
    push(y * WORLD_W + WORLD_W - 1);
  }
  for (const seed of stage.seeds) push(seed.y * WORLD_W + seed.x);

  // Source rows are `src.width` wide and the world may be narrower, so index
  // through the source stride rather than assuming they match.
  const near = (a, b) => {
    const ia = ((a / WORLD_W) | 0) * src.width * 3 + (a % WORLD_W) * 3;
    const ib = ((b / WORLD_W) | 0) * src.width * 3 + (b % WORLD_W) * 3;
    return (
      Math.abs(src.rgb[ia] - src.rgb[ib]) <= tol &&
      Math.abs(src.rgb[ia + 1] - src.rgb[ib + 1]) <= tol &&
      Math.abs(src.rgb[ia + 2] - src.rgb[ib + 2]) <= tol
    );
  };

  while (head < tail) {
    const at = queue[head];
    head += 1;
    const x = at % WORLD_W;
    const y = (at / WORLD_W) | 0;
    if (x > 0 && !bg[at - 1] && near(at, at - 1)) push(at - 1);
    if (x < WORLD_W - 1 && !bg[at + 1] && near(at, at + 1)) push(at + 1);
    if (y > 0 && !bg[at - WORLD_W] && near(at, at - WORLD_W)) push(at - WORLD_W);
    if (y < WORLD_H - 1 && !bg[at + WORLD_W] && near(at, at + WORLD_W)) push(at + WORLD_W);
  }

  const out = new Uint8Array(WORLD_W * WORLD_H);
  for (let i = 0; i < out.length; i += 1) out[i] = bg[i] ? 0 : 1;
  return out;
}

function rasterise(raw) {
  const need = Math.ceil(CELL * CELL * CELL_COVERAGE);
  const mask = new Uint8Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      let hits = 0;
      for (let dy = 0; dy < CELL; dy += 1) {
        for (let dx = 0; dx < CELL; dx += 1) {
          hits += raw[(row * CELL + dy) * WORLD_W + col * CELL + dx];
        }
      }
      mask[row * COLS + col] = hits >= need ? 1 : 0;
    }
  }
  return mask;
}

function clearRects(mask, rects) {
  for (const rect of rects) {
    const x0 = Math.max(0, Math.floor(rect.x / CELL));
    const y0 = Math.max(0, Math.floor(rect.y / CELL));
    const x1 = Math.min(COLS, Math.ceil((rect.x + rect.w) / CELL));
    const y1 = Math.min(ROWS, Math.ceil((rect.y + rect.h) / CELL));
    for (let row = y0; row < y1; row += 1) mask.fill(0, row * COLS + x0, row * COLS + x1);
  }
}

// ---------------------------------------------------------------------------
// Morphology. Square structuring elements, separated into two 1-D passes —
// exact for a square, and O(r) rather than O(r²) per cell.
// ---------------------------------------------------------------------------

function morph(mask, radius, want) {
  if (radius <= 0) return mask;
  const mid = new Uint8Array(mask.length);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      let hit = want === 1 ? 0 : 1;
      for (let d = -radius; d <= radius; d += 1) {
        const x = col + d;
        // Outside the world counts as background, so eroding does not eat the
        // map edges: the ocean is background and so is everything past it.
        const v = x < 0 || x >= COLS ? 0 : mask[row * COLS + x];
        if (want === 1 ? v === 1 : v === 0) {
          hit = want;
          break;
        }
      }
      mid[row * COLS + col] = hit;
    }
  }

  const out = new Uint8Array(mask.length);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      let hit = want === 1 ? 0 : 1;
      for (let d = -radius; d <= radius; d += 1) {
        const y = row + d;
        const v = y < 0 || y >= ROWS ? 0 : mid[y * COLS + col];
        if (want === 1 ? v === 1 : v === 0) {
          hit = want;
          break;
        }
      }
      out[row * COLS + col] = hit;
    }
  }
  return out;
}

const dilate = (mask, r) => morph(mask, r, 1);
const erode = (mask, r) => morph(mask, r, 0);

/** Bridge the dark seams the art paints between adjacent rock faces. */
const close = (mask, r) => erode(dilate(mask, r), r);
/** Delete hairlines — flagpoles, the lamp cord, icicle tips. */
const open = (mask, r) => dilate(erode(mask, r), r);

/**
 * Plug specks of sky trapped inside rock, leaving the real caves alone.
 *
 * One threshold does both jobs because the two are orders of magnitude apart: a
 * classification speck is tens of cells and the arches you can walk through are
 * thousands. Background reachable from the border is never filled, whatever its
 * size, so the ocean can't be mistaken for a hole.
 */
function fillEnclosed(mask, minArea) {
  const out = new Uint8Array(mask);
  const seen = new Uint8Array(mask.length);
  const stack = [];

  const seed = (at) => {
    if (mask[at] || seen[at]) return;
    seen[at] = 1;
    stack.push(at);
  };
  for (let col = 0; col < COLS; col += 1) {
    seed(col);
    seed((ROWS - 1) * COLS + col);
  }
  for (let row = 0; row < ROWS; row += 1) {
    seed(row * COLS);
    seed(row * COLS + COLS - 1);
  }
  while (stack.length > 0) {
    const at = stack.pop();
    for (const next of neighbours(at)) {
      if (next >= 0 && !mask[next] && !seen[next]) {
        seen[next] = 1;
        stack.push(next);
      }
    }
  }

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] || seen[start]) continue;
    const blob = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop();
      blob.push(at);
      for (const next of neighbours(at)) {
        if (next >= 0 && !mask[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (blob.length < minArea) for (const at of blob) out[at] = 1;
  }

  return out;
}

/** Birds, snowflakes, cloud fragments and whatever else survived the open. */
function dropSmallBlobs(mask, minArea) {
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
      for (const next of neighbours(at)) {
        if (next >= 0 && mask[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (blob.length < minArea) for (const at of blob) out[at] = 0;
  }

  return out;
}

function neighbours(at) {
  const row = (at / COLS) | 0;
  const col = at % COLS;
  return [
    col > 0 ? at - 1 : -1,
    col < COLS - 1 ? at + 1 : -1,
    row > 0 ? at - COLS : -1,
    row < ROWS - 1 ? at + COLS : -1,
  ];
}

// ---------------------------------------------------------------------------
// Artwork
// ---------------------------------------------------------------------------

/**
 * The painted silhouette, at pixel resolution, derived from the cell mask.
 *
 * Confident interior — a cell whose whole neighbourhood is solid — is painted
 * whatever the classifier said, so the seams that `close` bridged are filled
 * rather than left as transparent cracks inside a rock. On the boundary the
 * painting wins, which keeps the edge crisp instead of stepped at the 2-unit
 * cell grid. Nothing outside the mask is ever painted, so what you can see is
 * exactly what you can stand on.
 */
function pixelSilhouette(mask, raw) {
  const interior = erode(mask, 1);
  const out = new Uint8Array(WORLD_W * WORLD_H);
  for (let y = 0; y < WORLD_H; y += 1) {
    const row = (y / CELL) | 0;
    for (let x = 0; x < WORLD_W; x += 1) {
      const cell = row * COLS + ((x / CELL) | 0);
      if (!mask[cell]) continue;
      out[y * WORLD_W + x] = interior[cell] || raw[y * WORLD_W + x] ? 1 : 0;
    }
  }
  return out;
}

function buildTerrainLayer(src, solidPx) {
  const out = new Uint8Array(WORLD_W * WORLD_H * 4);
  for (let y = 0; y < WORLD_H; y += 1) {
    for (let x = 0; x < WORLD_W; x += 1) {
      const at = y * WORLD_W + x;
      if (!solidPx[at]) continue;
      const i = (y * src.width + x) * 3;
      const o = at * 4;
      out[o] = src.rgb[i];
      out[o + 1] = src.rgb[i + 1];
      out[o + 2] = src.rgb[i + 2];
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * What is behind the terrain, reconstructed.
 *
 * A per-row background profile: for each scanline, take the median colour of
 * the pixels that are *not* terrain, and paint the terrain in that row with it.
 *
 * Two earlier attempts are worth recording, because both look obviously right
 * and are not:
 *
 * - **Interpolating each column between the background above and below its
 *   terrain span.** The endpoints are wrong. The pixel immediately above a
 *   grass cap is the antialiased blend of grass and sky, and the one below a
 *   cliff is the blend with white sea foam, so every tower came out as a
 *   green-to-white vertical streak. Sampling clear of the fringe fixes that
 *   much, but a linear ramp down a 600-pixel tower still puts the sky-to-ocean
 *   transition wherever the rock happens to end rather than at the horizon.
 * - **Blurring the result.** Treats the symptom. A wrong colour smoothly
 *   blended into another wrong colour is still wrong, and it costs three full
 *   passes over 1.5M pixels.
 *
 * The median is per row and the row is mostly background, so it lands on the
 * sky at sky heights and the ocean at ocean heights, with the horizon exactly
 * where the painting put it. Median rather than mean because clouds and foam
 * are bright enough to drag a mean off the true sky colour.
 *
 * What it loses is horizontal variation — a crater does not reveal the cloud
 * that was behind the rock. That is invisible in practice and reads as depth of
 * field when it is not.
 */
function buildBackground(src, solidPx, stage) {
  const out = new Uint8Array(WORLD_W * WORLD_H * 3);
  for (let y = 0; y < WORLD_H; y += 1) {
    for (let x = 0; x < WORLD_W; x += 1) {
      const o = (y * WORLD_W + x) * 3;
      const i = (y * src.width + x) * 3;
      out[o] = src.rgb[i];
      out[o + 1] = src.rgb[i + 1];
      out[o + 2] = src.rgb[i + 2];
    }
  }

  // Painted over a *dilated* silhouette. The pixels immediately outside the
  // mask are the antialiased edge — part rock, part sky — and leaving them
  // paints a one-pixel ghost outline of the original coastline into the plate,
  // which is then the first thing you see through a crater.
  const fill = dilatePixels(solidPx, 4);
  const profile = rowProfile(src, solidPx, stage);
  for (let y = 0; y < WORLD_H; y += 1) {
    for (let x = 0; x < WORLD_W; x += 1) {
      if (!fill[y * WORLD_W + x]) continue;
      const o = (y * WORLD_W + x) * 3;
      out[o] = profile[y * 3];
      out[o + 1] = profile[y * 3 + 1];
      out[o + 2] = profile[y * 3 + 2];
    }
  }

  if (stage.subsurface) applySubsurface(out, solidPx, stage.subsurface);
  return out;
}

/** Separable square dilation at pixel resolution. */
function dilatePixels(mask, radius) {
  const mid = new Uint8Array(mask.length);
  for (let y = 0; y < WORLD_H; y += 1) {
    for (let x = 0; x < WORLD_W; x += 1) {
      let hit = 0;
      for (let d = -radius; d <= radius && !hit; d += 1) {
        const sx = x + d;
        if (sx >= 0 && sx < WORLD_W && mask[y * WORLD_W + sx]) hit = 1;
      }
      mid[y * WORLD_W + x] = hit;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < WORLD_H; y += 1) {
    for (let x = 0; x < WORLD_W; x += 1) {
      let hit = 0;
      for (let d = -radius; d <= radius && !hit; d += 1) {
        const sy = y + d;
        if (sy >= 0 && sy < WORLD_H && mid[sy * WORLD_W + x]) hit = 1;
      }
      out[y * WORLD_W + x] = hit;
    }
  }
  return out;
}

/** One background colour per scanline, smoothed down the image. */
function rowProfile(src, solidPx, stage) {
  /** Below this many background pixels a row's median is noise; inherit instead. */
  const MIN_SAMPLES = 24;
  /** Rows either side to average over, killing row-to-row jitter. */
  const SMOOTH = 10;

  const raw = new Float64Array(WORLD_H * 3);
  const good = new Uint8Array(WORLD_H);
  const bucket = [[], [], []];

  for (let y = 0; y < WORLD_H; y += 1) {
    bucket[0].length = 0;
    bucket[1].length = 0;
    bucket[2].length = 0;
    for (let x = 0; x < WORLD_W; x += 2) {
      if (solidPx[y * WORLD_W + x]) continue;
      const i = (y * src.width + x) * 3;
      bucket[0].push(src.rgb[i]);
      bucket[1].push(src.rgb[i + 1]);
      bucket[2].push(src.rgb[i + 2]);
    }
    if (bucket[0].length < MIN_SAMPLES) continue;
    good[y] = 1;
    for (let c = 0; c < 3; c += 1) {
      bucket[c].sort((a, b) => a - b);
      raw[y * 3 + c] = bucket[c][bucket[c].length >> 1];
    }
  }

  // A row with no usable background — the living room's floor spans the whole
  // width — inherits the nearest row that had some, so the profile stays
  // continuous instead of dropping to the fallback mid-image.
  let last = -1;
  for (let y = 0; y < WORLD_H; y += 1) {
    if (good[y]) last = y;
    else if (last >= 0) for (let c = 0; c < 3; c += 1) raw[y * 3 + c] = raw[last * 3 + c];
    else for (let c = 0; c < 3; c += 1) raw[y * 3 + c] = stage.fallback[c];
  }

  const out = new Uint8Array(WORLD_H * 3);
  for (let y = 0; y < WORLD_H; y += 1) {
    for (let c = 0; c < 3; c += 1) {
      let sum = 0;
      let n = 0;
      for (let d = -SMOOTH; d <= SMOOTH; d += 1) {
        const yy = y + d;
        if (yy < 0 || yy >= WORLD_H) continue;
        sum += raw[yy * 3 + c];
        n += 1;
      }
      out[y * 3 + c] = Math.round(sum / n);
    }
  }
  return out;
}

/** Below the floor line there is dirt, not whatever the room happened to show. */
function applySubsurface(rgb, solidPx, { y: floorY, color }) {
  const FADE = 60;
  for (let y = Math.max(0, floorY - FADE); y < WORLD_H; y += 1) {
    const t = Math.min(1, (y - (floorY - FADE)) / FADE);
    for (let x = 0; x < WORLD_W; x += 1) {
      if (!solidPx[y * WORLD_W + x]) continue;
      const o = (y * WORLD_W + x) * 3;
      for (let c = 0; c < 3; c += 1) rgb[o + c] = Math.round(rgb[o + c] + (color[c] - rgb[o + c]) * t);
    }
  }
}

// ---------------------------------------------------------------------------
// Spawns
// ---------------------------------------------------------------------------

/**
 * Eight standing spots, as far apart as the map allows.
 *
 * Derived from the same mask the worms collide against, so a spawn cannot end
 * up inside a wall the way the tank spawns once did. A spot qualifies when the
 * worm's box fits clear of terrain, there is ground within a short drop below,
 * and it is far enough inside the map not to be blown off it on turn one.
 */
function pickSpawns(mask, count = 8) {
  const solid = (x, y) => {
    const col = (x / CELL) | 0;
    const row = (y / CELL) | 0;
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return false;
    return mask[row * COLS + col] === 1;
  };

  /** The worm's own box, plus headroom, has to be empty where it lands. */
  const boxClear = (x, y) => {
    for (let dy = -WORM_HALF_H - SPAWN_MARGIN; dy <= WORM_HALF_H; dy += CELL) {
      for (let dx = -WORM_HALF_W; dx <= WORM_HALF_W; dx += CELL) {
        if (solid(x + dx, y + dy)) return false;
      }
    }
    return true;
  };

  /**
   * A ledge wide enough to be worth standing on: ground under every footing
   * across a worm's width plus a stride either side, each within a short drop.
   *
   * Testing the centre alone put spawns on the tip of a pine tree and the top
   * of a flagpole — both terrain, both one cell wide. Testing only the worm's
   * own width then put one on an isolated rock in the sea, where a worm is
   * stranded for the whole match. A spawn has to be somewhere you can walk out
   * of.
   *
   * Headroom is checked at the centre only. Requiring it across the whole
   * stride as well rejected every real ledge in the game, because the ledges
   * are dressed with grass tufts, rocks and crates — which a walking worm steps
   * straight over.
   */
  const LEDGE = 16;
  const footing = (x, y) => {
    for (let dx = -LEDGE; dx <= LEDGE; dx += 8) {
      let found = false;
      for (let d = WORM_HALF_H; d <= WORM_HALF_H + 16; d += CELL) {
        if (solid(x + dx, y + d)) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
    return true;
  };

  const EDGE = 50;
  const open = [];
  for (let y = EDGE; y < WORLD_H - EDGE; y += 6) {
    for (let x = EDGE; x < WORLD_W - EDGE; x += 6) {
      if (boxClear(x, y) && footing(x, y)) open.push({ x, y });
    }
  }
  if (open.length === 0) return [];

  /** Two worms this close are effectively sharing a spawn. */
  const MIN_APART = 140;

  // Farthest-point sampling: worms should not start within arm's reach of each
  // other, whatever shape the map is. Seeded from the lowest-and-leftmost spot
  // rather than an arbitrary one, so the result is stable across runs.
  const chosen = [open.reduce((a, b) => (b.y > a.y || (b.y === a.y && b.x < a.x) ? b : a))];
  while (chosen.length < count) {
    let best = null;
    let bestScore = MIN_APART * MIN_APART;
    for (const cell of open) {
      let nearest = Infinity;
      for (const other of chosen) {
        const d = (cell.x - other.x) ** 2 + (cell.y - other.y) ** 2;
        if (d < nearest) nearest = d;
      }
      if (nearest > bestScore) {
        bestScore = nearest;
        best = cell;
      }
    }
    // Nothing left that is far enough from everything already chosen. Stopping
    // short is the honest answer — the alternative is duplicate spawns, which
    // is two worms in the same hole and reads as a bug.
    if (!best) break;
    chosen.push(best);
  }
  return chosen.map((c) => ({ x: c.x, y: c.y }));
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * Run-length, alternating, starting with a background run, varint lengths,
 * base64.
 *
 * A terrain silhouette is long-run in row-major order — most rows are a few
 * hundred cells of sky, a few hundred of rock, a few hundred of sky — so this
 * lands around 1% of the raw bitmap. `shared/games/worms/terrain.ts:decodeMask`
 * is the other half and the two have to stay in step; `terrain.test.ts` pins the
 * format against a hand-written example so they cannot drift silently.
 */
function encodeMask(mask) {
  const bytes = [];
  let value = 0;
  let run = 0;

  const flush = () => {
    let n = run;
    for (;;) {
      const byte = n & 0x7f;
      n >>>= 7;
      bytes.push(n > 0 ? byte | 0x80 : byte);
      if (n === 0) break;
    }
  };

  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] === value) {
      run += 1;
      continue;
    }
    flush();
    value = mask[i];
    run = 1;
  }
  flush();

  return Buffer.from(bytes).toString('base64');
}

function maskModule(id, mask) {
  const b64 = encodeMask(mask);
  const solid = mask.reduce((a, b) => a + b, 0);
  return `/**
 * GENERATED by \`node scripts/derive-worms-terrain.mjs --write\` — do not edit.
 *
 * ${COLS}x${ROWS} cells of ${CELL} world units, ${((solid / mask.length) * 100).toFixed(1)}% solid.
 * Run-length encoded, alternating from background, varint lengths, base64.
 */
export const MASK_${id.toUpperCase()} =
  '${b64}';
`;
}

// ---------------------------------------------------------------------------
// Reporting and overlays
// ---------------------------------------------------------------------------

function report(id, mask, spawns) {
  let solid = 0;
  for (let i = 0; i < mask.length; i += 1) solid += mask[i];
  const blobs = components(mask);
  const largest = blobs.length > 0 ? Math.max(...blobs) : 0;
  const pct = (n) => `${((n / mask.length) * 100).toFixed(1)}%`;

  console.log(
    `${id.padEnd(12)} solid ${pct(solid).padStart(6)}  blobs ${String(blobs.length).padStart(3)}` +
      `  largest ${pct(largest).padStart(6)}  spawns ${spawns.length}` +
      `  mask ${(encodeMask(mask).length / 1024).toFixed(1)}kB`,
  );

  if (solid / mask.length < 0.1 || solid / mask.length > 0.6) {
    console.log(`  !! ${id}: terrain coverage looks wrong — check the overlay`);
  }
  if (spawns.length < 8) console.log(`  !! ${id}: only ${spawns.length} spawn anchors`);
}

function components(mask) {
  const seen = new Uint8Array(mask.length);
  const sizes = [];
  const stack = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let size = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop();
      size += 1;
      for (const next of neighbours(at)) {
        if (next >= 0 && mask[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    sizes.push(size);
  }
  return sizes;
}

/** The painting with everything classified as terrain tinted magenta. */
function overlay(src, solidPx) {
  const out = new Uint8Array(WORLD_W * WORLD_H * 3);
  for (let y = 0; y < WORLD_H; y += 1) {
    for (let x = 0; x < WORLD_W; x += 1) {
      const at = y * WORLD_W + x;
      const i = (y * src.width + x) * 3;
      const o = at * 3;
      if (solidPx[at]) {
        out[o] = Math.min(255, src.rgb[i] * 0.4 + 255 * 0.6);
        out[o + 1] = src.rgb[i + 1] * 0.4;
        out[o + 2] = Math.min(255, src.rgb[i + 2] * 0.4 + 255 * 0.6);
      } else {
        out[o] = src.rgb[i] * 0.55;
        out[o + 1] = src.rgb[i + 1] * 0.55;
        out[o + 2] = src.rgb[i + 2] * 0.55;
      }
    }
  }
  return out;
}

/** Background plate with the terrain layer drawn back over it, plus spawn pips. */
function composite(background, terrain, spawns) {
  const out = Uint8Array.from(background);
  for (let i = 0; i < WORLD_W * WORLD_H; i += 1) {
    if (terrain[i * 4 + 3] === 0) continue;
    out[i * 3] = terrain[i * 4];
    out[i * 3 + 1] = terrain[i * 4 + 1];
    out[i * 3 + 2] = terrain[i * 4 + 2];
  }
  for (const spawn of spawns) {
    for (let dy = -WORM_HALF_H; dy <= WORM_HALF_H; dy += 1) {
      for (let dx = -WORM_HALF_W; dx <= WORM_HALF_W; dx += 1) {
        const x = spawn.x + dx;
        const y = spawn.y + dy;
        if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) continue;
        const o = (y * WORLD_W + x) * 3;
        out[o] = 255;
        out[o + 1] = 40;
        out[o + 2] = 40;
      }
    }
  }
  return out;
}

function dump(dir, name, pixels, channels) {
  fs.writeFileSync(path.join(dir, name), encodePng(WORLD_W, WORLD_H, pixels, channels));
}

main();
