import { ARENA_HEIGHT, ARENA_WIDTH, type Level, type LevelId } from '@mg/shared/gunmayhem';
import { getImage } from '../../game/images';

/**
 * Stage set dressing.
 *
 * Three levels that were previously distinguishable only by their palette now
 * each get scenery: The Salon is somebody's living room, Rooftops is a city at
 * night, Towers is a spire above the clouds.
 *
 * All of it is drawn *behind* the platforms and deliberately low contrast —
 * scenery that competes with four players and a dozen bullets is scenery that
 * makes the game harder to read.
 *
 * ## Optional background images
 *
 * `backdropUrl` points at an optional painted backdrop per level. It is layered
 * over the procedural sky and under this scenery, and `getImage` returns null
 * until (and unless) it loads — so a missing file costs nothing but the
 * procedural look. See `game/images.ts`.
 */

const INK = '#14110f';

/** Where a level's optional painted backdrop lives, if one has been added. */
export function backdropUrl(id: LevelId): string {
  const legacyPath = `/stages/${id}/backdrop.png`;
  const stageAssetPath = `/stages/gun_mayhem_stage_${id}.png`;
  return getImage(stageAssetPath) ? stageAssetPath : legacyPath;
}

/**
 * Blit the painted backdrop for this level, if it has loaded.
 *
 * Scaled to cover the arena. Returns false when there is no image.
 */
export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  id: LevelId,
  now: number,
): boolean {
  const url = backdropUrl(id);
  const image = getImage(url);
  if (!image) return false;

  ctx.save();
  if (url.includes('gun_mayhem_stage_')) {
    // Full stage image asset: covers exact 1280x720 arena space without drift
    ctx.globalAlpha = 1.0;
    ctx.drawImage(image, 0, 0, ARENA_WIDTH, ARENA_HEIGHT);
  } else {
    // Legacy procedural backdrop drift
    const drift = Math.sin(now / 9000) * 10;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(image, -20 + drift, -14, ARENA_WIDTH + 40, ARENA_HEIGHT + 28);
  }
  ctx.restore();
  return true;
}

/** Scenery for a level, drawn behind the platforms. */
export function drawScenery(ctx: CanvasRenderingContext2D, level: Level, now: number): void {
  ctx.save();
  switch (level.id) {
    case 'salon':
      drawSalon(ctx, level, now);
      break;
    case 'rooftops':
      drawRooftops(ctx, level, now);
      break;
    case 'towers':
      drawTowers(ctx, level, now);
      break;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The Salon — a living room. The sofa is the floor.
// ---------------------------------------------------------------------------

function drawSalon(ctx: CanvasRenderingContext2D, level: Level, now: number): void {
  const palette = level.palette;

  // Wallpaper stripes.
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = palette.near;
  for (let x = 0; x < ARENA_WIDTH; x += 96) {
    ctx.fillRect(x, 0, 44, ARENA_HEIGHT);
  }
  ctx.globalAlpha = 1;

  // A big window with moonlight, left of centre.
  panel(ctx, 96, 96, 220, 200, '#1b2a44');
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(206, 96);
  ctx.lineTo(206, 296);
  ctx.moveTo(96, 196);
  ctx.lineTo(316, 196);
  ctx.stroke();
  ctx.fillStyle = '#f2efdc';
  ctx.beginPath();
  ctx.arc(256, 148, 26, 0, Math.PI * 2);
  ctx.fill();

  // Framed pictures, right of centre.
  panel(ctx, 900, 120, 120, 90, shade(palette.platform, -0.2));
  panel(ctx, 1050, 150, 90, 70, shade(palette.platform, -0.35));

  // A standing lamp whose glow flickers very slightly.
  const flicker = 0.82 + Math.sin(now / 500) * 0.05;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(1180, 560);
  ctx.lineTo(1180, 380);
  ctx.stroke();
  ctx.fillStyle = `rgba(255, 210, 63, ${0.14 * flicker})`;
  ctx.beginPath();
  ctx.moveTo(1180, 380);
  ctx.lineTo(1120, 560);
  ctx.lineTo(1240, 560);
  ctx.closePath();
  ctx.fill();
  shape(ctx, '#ffd23f', () => {
    ctx.beginPath();
    ctx.moveTo(1152, 380);
    ctx.lineTo(1208, 380);
    ctx.lineTo(1196, 344);
    ctx.lineTo(1164, 344);
    ctx.closePath();
  });

  // Sofa back, behind the main floor — the floor platform is its seat.
  const floor = level.platforms[0]!;
  shape(ctx, shade(palette.platform, -0.25), () => {
    roundRect(ctx, floor.x - 16, floor.y - 78, floor.w + 32, 90, 18);
  });
  // Cushion seams.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.5;
  for (let i = 1; i < 4; i++) {
    const x = floor.x + (floor.w / 4) * i;
    ctx.beginPath();
    ctx.moveTo(x, floor.y - 70);
    ctx.lineTo(x, floor.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Rooftops — a city at night.
// ---------------------------------------------------------------------------

function drawRooftops(ctx: CanvasRenderingContext2D, level: Level, now: number): void {
  const palette = level.palette;

  // Stars, on a fixed pseudo-random scatter so they do not crawl about.
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 60; i++) {
    const x = ((i * 977) % ARENA_WIDTH) + ((i % 5) * 13);
    const y = (i * 137) % 320;
    ctx.globalAlpha = 0.25 + ((i * 37) % 50) / 100;
    ctx.fillRect(x % ARENA_WIDTH, y, 2, 2);
  }
  ctx.globalAlpha = 1;

  // Two skylines, the far one lighter, so there is depth behind the fight.
  skyline(ctx, shade(palette.far, 0.05), 470, 150, 70, 0);
  skyline(ctx, palette.near, 540, 200, 96, 43);

  // Lit windows on the near skyline.
  ctx.fillStyle = '#ffd23f';
  for (let i = 0; i < 90; i++) {
    const bx = 43 + Math.floor(i / 6) * 96;
    const by = 560 + (i % 6) * 24;
    if (by > ARENA_HEIGHT) continue;
    // Deterministic "is this one lit", plus a slow blink on a few.
    const lit = (i * 41) % 7 < 3;
    if (!lit) continue;
    ctx.globalAlpha = (i * 29) % 11 === 0 ? 0.35 + Math.sin(now / 700 + i) * 0.25 : 0.5;
    ctx.fillRect(bx + 14, by, 12, 10);
    ctx.fillRect(bx + 46, by, 12, 10);
  }
  ctx.globalAlpha = 1;

  // Antennas on the two outer ledges.
  for (const platform of [level.platforms[1], level.platforms[2]]) {
    if (!platform) continue;
    const x = platform.x + platform.w / 2;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, platform.y);
    ctx.lineTo(x, platform.y - 64);
    ctx.moveTo(x - 14, platform.y - 44);
    ctx.lineTo(x + 14, platform.y - 44);
    ctx.moveTo(x - 9, platform.y - 56);
    ctx.lineTo(x + 9, platform.y - 56);
    ctx.stroke();
    // Blinking aircraft light.
    ctx.fillStyle = Math.floor(now / 600) % 2 === 0 ? '#ff6b6b' : '#5b2a2a';
    ctx.beginPath();
    ctx.arc(x, platform.y - 68, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function skyline(
  ctx: CanvasRenderingContext2D,
  color: string,
  top: number,
  spread: number,
  step: number,
  offset: number,
): void {
  ctx.fillStyle = color;
  for (let i = 0; offset + i * step < ARENA_WIDTH; i++) {
    const x = offset + i * step;
    // Deterministic heights — a random skyline would shimmer every frame.
    const height = spread * (0.45 + (((i * 73) % 100) / 100) * 0.55);
    ctx.fillRect(x, top - height, step - 10, ARENA_HEIGHT - top + height);
  }
}

// ---------------------------------------------------------------------------
// Towers — spires above the clouds. No floor at all.
// ---------------------------------------------------------------------------

function drawTowers(ctx: CanvasRenderingContext2D, level: Level, now: number): void {
  const palette = level.palette;

  // Distant spires rising past the arena.
  for (const [x, w, top] of [
    [120, 90, 300],
    [1060, 100, 260],
    [560, 130, 200],
  ] as const) {
    shape(ctx, shade(palette.far, 0.04), () => {
      ctx.beginPath();
      ctx.moveTo(x, ARENA_HEIGHT);
      ctx.lineTo(x, top);
      ctx.lineTo(x + w / 2, top - 60);
      ctx.lineTo(x + w, top);
      ctx.lineTo(x + w, ARENA_HEIGHT);
      ctx.closePath();
    });
  }

  // Clouds drifting under the platforms, to sell the height.
  const drift = (now / 90) % (ARENA_WIDTH + 400);
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#ffffff';
  for (const [baseX, y, r] of [
    [0, 640, 90],
    [520, 690, 120],
    [980, 620, 80],
  ] as const) {
    const x = ((baseX + drift) % (ARENA_WIDTH + 400)) - 200;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.7, r * 0.6, 0, 0, Math.PI * 2);
    ctx.ellipse(x + r, y - r * 0.25, r * 1.1, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Banners hanging off the underside of alternating wide ledges. Every ledge
  // getting one reads as a repeating texture glitch rather than as decoration.
  level.platforms.forEach((platform, index) => {
    if (index % 2 !== 0 || platform.w < 200) return;
    const x = platform.x + platform.w / 2 - 14;
    const sway = Math.sin(now / 800 + platform.x) * 3;
    shape(ctx, palette.accent, () => {
      ctx.beginPath();
      ctx.moveTo(x, platform.y + platform.h);
      ctx.lineTo(x + 28, platform.y + platform.h);
      ctx.lineTo(x + 28 + sway, platform.y + platform.h + 54);
      ctx.lineTo(x + 14 + sway, platform.y + platform.h + 42);
      ctx.lineTo(x + sway, platform.y + platform.h + 54);
      ctx.closePath();
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  shape(ctx, color, () => roundRect(ctx, x, y, w, h, 6));
}

function shape(ctx: CanvasRenderingContext2D, color: string, path: () => void): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  path();
  ctx.fill();
  ctx.stroke();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function shade(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const num = Number.parseInt(value, 16);
  const channel = (shift: number): number => {
    const base = (num >> shift) & 0xff;
    const next = amount < 0 ? base * (1 + amount) : base + (255 - base) * amount;
    return Math.round(Math.min(255, Math.max(0, next)));
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
