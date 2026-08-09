/**
 * Small canvas helpers shared by the game renderers.
 *
 * These lived as private copies in three `Renderer.ts` files, which was fine
 * until the copies stopped matching. Two ways they had already diverged, both
 * of which this file exists to prevent recurring:
 *
 * - Tank Trouble's rounded-rect had no radius clamp, so a corner radius larger
 *   than half the box produced a malformed path there and a correct one in the
 *   other two.
 * - Tank Trouble's `shade` took a *positive* factor to darken while the other
 *   two took a negative one, so `shade(c, 0.45)` darkened in one renderer and
 *   lightened in the others. Moving a line between renderers inverted it
 *   silently. That one is not merged — see `darken` below.
 */

/**
 * Add a rounded-rect path. The caller fills or strokes it.
 *
 * The radius is clamped to half the shorter side, because `arcTo` with a radius
 * larger than the box produces a path that is not the rectangle anyone asked
 * for.
 */
export function roundRect(
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

/**
 * Darken (negative amount) or lighten (positive amount) a `#rrggbb` colour,
 * as `rgb(r, g, b)`.
 *
 * The sign convention is the point: one function where the direction is in the
 * argument, so `shade(c, -0.25)` reads as "a quarter darker" everywhere.
 */
export function shade(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const num = Number.parseInt(value, 16);
  const channel = (shift: number): number => {
    const base = (num >> shift) & 0xff;
    const next = amount < 0 ? base * (1 + amount) : base + (255 - base) * amount;
    return Math.round(Math.min(255, Math.max(0, next)));
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
