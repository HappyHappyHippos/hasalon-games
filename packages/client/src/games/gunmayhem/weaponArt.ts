import { WEAPONS, type WeaponKind } from '@mg/shared/gunmayhem';

/**
 * Weapons, drawn.
 *
 * Every gun used to be the same flat ink bar at three different lengths, which
 * made the weapon you were holding almost impossible to read at a glance — the
 * one thing you most need to know in a fight. These are proper silhouettes
 * instead: you can tell a shotgun from a sniper from across the stage.
 *
 * Conventions, all of them shared with the character art in `Renderer.ts`:
 *
 *   - Origin is the shoulder. The barrel runs along +x, the muzzle is at
 *     `muzzleX(kind)`, and the caller has already flipped the context for
 *     facing, so everything here is drawn as though pointing right.
 *   - `recoil` is 0..1 and slides the whole weapon back along the barrel. The
 *     knife gets a negative slide, because a stab lunges forward.
 *   - Same 3px `INK` outline and rounded joins as everything else.
 *   - Leaves the context exactly as it found it.
 */

const INK = '#14110f';
const METAL = '#3a3a44';
const METAL_LIGHT = '#5a5a68';
const WOOD = '#8b5e3c';
const BLADE = '#d8dde6';

/** How far the muzzle sits from the shoulder, for muzzle flash placement. */
export function muzzleX(kind: WeaponKind): number {
  switch (kind) {
    case 'sniper':
      return 42;
    case 'rocket':
      return 34;
    case 'shotgun':
      return 34;
    case 'smg':
      return 24;
    case 'knife':
      return 20;
    default:
      return 26;
  }
}

/** How hard this weapon should kick the camera and the arms. 0..1-ish. */
export function recoilStrength(kind: WeaponKind): number {
  const recoil = WEAPONS[kind].recoil;
  if (recoil <= 0) return 0;
  return Math.min(1, recoil / 300);
}

export function drawWeapon(
  ctx: CanvasRenderingContext2D,
  kind: WeaponKind,
  recoil: number,
): void {
  ctx.save();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // A knife thrusts forwards; guns slide back into the shoulder.
  const slide = kind === 'knife' ? recoil * 9 : -recoil * 7;
  ctx.translate(slide, 0);

  switch (kind) {
    case 'pistol':
      drawPistol(ctx);
      break;
    case 'smg':
      drawSmg(ctx);
      break;
    case 'shotgun':
      drawShotgun(ctx);
      break;
    case 'sniper':
      drawSniper(ctx);
      break;
    case 'rocket':
      drawRocket(ctx);
      break;
    case 'knife':
      drawKnife(ctx);
      break;
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// The guns
// ---------------------------------------------------------------------------

function drawPistol(ctx: CanvasRenderingContext2D): void {
  // Grip, angled back under the hand.
  fill(ctx, METAL, () => {
    ctx.beginPath();
    ctx.moveTo(2, 1);
    ctx.lineTo(9, 1);
    ctx.lineTo(7, 12);
    ctx.lineTo(0, 11);
    ctx.closePath();
  });
  // Slide.
  fill(ctx, METAL_LIGHT, () => rect(ctx, 0, -5, 22, 7, 2));
  // Barrel tip, a shade darker so the muzzle reads.
  fill(ctx, METAL, () => rect(ctx, 20, -4, 6, 5, 1.5));
}

function drawSmg(ctx: CanvasRenderingContext2D): void {
  // Stubby body.
  fill(ctx, METAL, () => rect(ctx, -2, -6, 18, 9, 2));
  // Magazine, straight down — the SMG's most recognisable feature.
  fill(ctx, METAL_LIGHT, () => rect(ctx, 3, 2, 6, 12, 1.5));
  // Short barrel and a folded stock behind the shoulder.
  fill(ctx, METAL_LIGHT, () => rect(ctx, 15, -4, 10, 5, 1.5));
  fill(ctx, METAL, () => rect(ctx, -9, -4, 8, 5, 1.5));
}

function drawShotgun(ctx: CanvasRenderingContext2D): void {
  // Wooden stock.
  fill(ctx, WOOD, () => {
    ctx.beginPath();
    ctx.moveTo(-12, -3);
    ctx.lineTo(0, -5);
    ctx.lineTo(0, 3);
    ctx.lineTo(-11, 5);
    ctx.closePath();
  });
  // Double barrel, stacked — the silhouette that says "shotgun".
  fill(ctx, METAL, () => rect(ctx, 0, -7, 34, 5, 1.5));
  fill(ctx, METAL_LIGHT, () => rect(ctx, 0, -2, 34, 5, 1.5));
  // Pump.
  fill(ctx, WOOD, () => rect(ctx, 12, 2, 12, 5, 2));
}

function drawSniper(ctx: CanvasRenderingContext2D): void {
  // Long body and a longer barrel.
  fill(ctx, WOOD, () => rect(ctx, -14, -3, 20, 8, 2));
  fill(ctx, METAL, () => rect(ctx, 4, -3, 38, 5, 1.5));
  // Scope, up on rails.
  fill(ctx, METAL_LIGHT, () => rect(ctx, 6, -12, 18, 6, 2));
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(10, -6);
  ctx.lineTo(10, -3);
  ctx.moveTo(20, -6);
  ctx.lineTo(20, -3);
  ctx.stroke();
  // Lens glint, so the scope is legible at small sizes.
  fill(ctx, '#9fd8ff', () => rect(ctx, 21, -11, 3, 4, 1));
}

function drawRocket(ctx: CanvasRenderingContext2D): void {
  // Fat tube.
  fill(ctx, '#4a5a3a', () => rect(ctx, -12, -7, 46, 12, 4));
  // Rear cone, venting backwards.
  fill(ctx, METAL, () => {
    ctx.beginPath();
    ctx.moveTo(-12, -7);
    ctx.lineTo(-20, -11);
    ctx.lineTo(-20, 9);
    ctx.lineTo(-12, 5);
    ctx.closePath();
  });
  // Sight and grip.
  fill(ctx, METAL_LIGHT, () => rect(ctx, 4, -13, 10, 6, 2));
  fill(ctx, METAL, () => rect(ctx, 2, 5, 6, 9, 1.5));
}

function drawKnife(ctx: CanvasRenderingContext2D): void {
  // Handle.
  fill(ctx, WOOD, () => rect(ctx, -6, -3, 12, 6, 2));
  // Guard.
  fill(ctx, METAL, () => rect(ctx, 5, -6, 3, 12, 1));
  // Blade — a triangle, so it reads as a point rather than a barrel.
  fill(ctx, BLADE, () => {
    ctx.beginPath();
    ctx.moveTo(8, -4);
    ctx.lineTo(20, -1);
    ctx.lineTo(8, 3);
    ctx.closePath();
  });
}

// ---------------------------------------------------------------------------
// The slash
// ---------------------------------------------------------------------------

/**
 * The knife's arc, drawn instead of a muzzle flash. `progress` runs 0..1 and
 * sweeps the arc downwards, so it reads as a swing rather than a flash.
 *
 * `reach` should be the weapon's actual melee reach — an arc that disagrees
 * with the hitbox is worse than no arc at all.
 */
export function drawSlash(
  ctx: CanvasRenderingContext2D,
  reach: number,
  progress: number,
  hit: boolean,
): void {
  const eased = Math.min(1, Math.max(0, progress));
  const sweep = -0.8 + eased * 1.9;

  ctx.save();
  ctx.globalAlpha = 1 - eased * 0.75;
  ctx.strokeStyle = hit ? '#fff3c4' : '#e8ecf5';
  ctx.lineWidth = hit ? 5 : 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, reach + 12, sweep - 0.55, sweep + 0.55);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Helpers — fill-then-outline is the house style
// ---------------------------------------------------------------------------

function fill(ctx: CanvasRenderingContext2D, color: string, path: () => void): void {
  ctx.fillStyle = color;
  path();
  ctx.fill();
  ctx.stroke();
}

function rect(
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
