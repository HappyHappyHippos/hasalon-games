/**
 * Hats and faces, drawn.
 *
 * The indices come from `@mg/shared/appearance`; the shapes live here because
 * they are pure presentation — nothing in either simulation knows or cares what
 * is on your head. Both renderers and the lobby preview call these, so a hat
 * looks the same everywhere it appears.
 *
 * Every function draws in a coordinate space where (0, 0) is the centre of the
 * head and `r` is its radius, and leaves the context exactly as it found it.
 * Callers translate/scale into place.
 */

import { faceFor, hatFor } from '@mg/shared';
import { getImage } from './images';

const INK = '#14110f';

/** Darken or lighten a hex colour. Mirrors the helper in each Renderer. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (channel: number): number =>
    Math.round(amount < 0 ? channel * (1 + amount) : channel + (255 - channel) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/**
 * How far above the top of the head this hat reaches, in the same units as `r`.
 *
 * Gun Mayhem stacks a damage label and a "this is you" arrow above every head,
 * and a top hat is taller than the gap they were spaced for. Callers add this
 * to their own vertical offsets so the labels ride over the hat instead of
 * through it.
 */
export function hatRise(hatIndex: number, r: number): number {
  switch (hatFor(hatIndex)) {
    case 'none':
    case 'headband':
      return 0;
    case 'cap':
      return r * 0.7;
    case 'crown':
      return r * 0.75;
    case 'horns':
      return r * 0.85;
    case 'halo':
      return r * 0.98;
    case 'tophat':
    case 'beanie':
    case 'beret':
    case 'pirate':
      return r * 1.05;
    case 'cowboy':
    case 'university':
      return r * 1.2;
    case 'birthday':
    case 'santa':
      return r * 1.5;
  }
}

/**
 * Draws the hat sitting on top of a head of radius `r` centred at the origin.
 * `outline` off is for tiny renderings (an Achtung head) where a 2px stroke
 * would swallow the shape whole.
 */
export function drawHat(
  ctx: CanvasRenderingContext2D,
  hatIndex: number,
  color: string,
  r: number,
  outline = true,
): void {
  const hat = hatFor(hatIndex);
  if (hat === 'none') return;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.strokeStyle = INK;

  // The top of the head, where everything below sits.
  const top = -r;

  const customImg = getImage(`/hats/${hat}.png`);
  if (customImg) {
    let hatW = r * 2.1;
    let hatH = (hatW * customImg.height) / customImg.width;
    let offsetY = top - hatH + r * 0.3;

    if (hat === 'santa' || hat === 'birthday') {
      hatW = r * 1.8;
      hatH = (hatW * customImg.height) / customImg.width;
      offsetY = top - hatH + r * 0.25;
    } else if (hat === 'pirate') {
      hatW = r * 2.8;
      hatH = (hatW * customImg.height) / customImg.width;
      offsetY = top - hatH + r * 0.45;
    } else if (hat === 'university' || hat === 'cowboy') {
      hatW = r * 2.2;
      hatH = (hatW * customImg.height) / customImg.width;
      offsetY = top - hatH + r * 0.35;
    } else if (hat === 'beret') {
      hatW = r * 2.1;
      hatH = (hatW * customImg.height) / customImg.width;
      offsetY = top - hatH + r * 0.15;
    }

    ctx.drawImage(customImg, -hatW / 2, offsetY, hatW, hatH);
    ctx.restore();
    return;
  }

  switch (hat) {
    case 'cap': {
      ctx.fillStyle = shade(color, 0.35);
      ctx.beginPath();
      ctx.arc(0, top + r * 0.25, r * 0.95, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      if (outline) ctx.stroke();
      // Peak, forward.
      ctx.beginPath();
      ctx.ellipse(r * 0.55, top + r * 0.28, r * 0.85, r * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      if (outline) ctx.stroke();
      break;
    }

    case 'crown': {
      ctx.fillStyle = '#ffd60a';
      ctx.beginPath();
      ctx.moveTo(-r * 0.9, top + r * 0.3);
      ctx.lineTo(-r * 0.9, top - r * 0.55);
      ctx.lineTo(-r * 0.45, top - r * 0.1);
      ctx.lineTo(0, top - r * 0.75);
      ctx.lineTo(r * 0.45, top - r * 0.1);
      ctx.lineTo(r * 0.9, top - r * 0.55);
      ctx.lineTo(r * 0.9, top + r * 0.3);
      ctx.closePath();
      ctx.fill();
      if (outline) ctx.stroke();
      break;
    }

    case 'tophat': {
      ctx.fillStyle = INK;
      // Brim.
      ctx.beginPath();
      ctx.ellipse(0, top + r * 0.15, r * 1.15, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      if (outline) ctx.stroke();
      // Stack.
      ctx.beginPath();
      ctx.rect(-r * 0.6, top - r * 1.05, r * 1.2, r * 1.2);
      ctx.fill();
      if (outline) ctx.stroke();
      // A band in the player's colour, so a top hat still reads as *yours*.
      ctx.fillStyle = color;
      ctx.fillRect(-r * 0.6, top - r * 0.25, r * 1.2, r * 0.3);
      break;
    }

    case 'horns': {
      ctx.fillStyle = '#fdf6e8';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * r * 0.55, top + r * 0.2);
        ctx.quadraticCurveTo(side * r * 1.25, top - r * 0.1, side * r * 1.05, top - r * 0.85);
        ctx.quadraticCurveTo(side * r * 0.7, top - r * 0.25, side * r * 0.25, top + r * 0.15);
        ctx.closePath();
        ctx.fill();
        if (outline) ctx.stroke();
      }
      break;
    }

    case 'headband': {
      ctx.fillStyle = color === '#ff453a' ? '#0a84ff' : '#ff453a';
      ctx.fillRect(-r, top + r * 0.15, r * 2, r * 0.4);
      if (outline) ctx.strokeRect(-r, top + r * 0.15, r * 2, r * 0.4);
      // Trailing ends, off the back.
      ctx.beginPath();
      ctx.moveTo(-r * 0.95, top + r * 0.35);
      ctx.lineTo(-r * 1.7, top + r * 0.9);
      ctx.moveTo(-r * 0.95, top + r * 0.35);
      ctx.lineTo(-r * 1.5, top + r * 1.3);
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = Math.max(1, r * 0.22);
      ctx.stroke();
      break;
    }

    case 'halo': {
      ctx.strokeStyle = '#ffd60a';
      ctx.lineWidth = Math.max(1.5, r * 0.22);
      ctx.beginPath();
      ctx.ellipse(0, top - r * 0.7, r * 0.85, r * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case 'beanie': {
      ctx.fillStyle = shade(color, -0.35);
      ctx.beginPath();
      ctx.arc(0, top + r * 0.3, r * 0.95, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      if (outline) ctx.stroke();
      // Bobble.
      ctx.fillStyle = '#fdf6e8';
      ctx.beginPath();
      ctx.arc(0, top - r * 0.75, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      if (outline) ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

/**
 * Draws the face on a head of radius `r` centred at the origin, looking right.
 * The caller has already flipped the context for facing, so this always draws
 * as though facing right.
 */
export function drawFace(ctx: CanvasRenderingContext2D, faceIndex: number, r: number): void {
  const face = faceFor(faceIndex);
  const img = getImage(`/faces/${face}.svg`);

  if (img) {
    // The SVGs are 100x100, and we want to fit them to the head size (radius r).
    // The head's top-left in drawing coordinates is (-r, -r).
    // Drawing it at width = r * 2, height = r * 2 covers the head perfectly.
    ctx.drawImage(img, -r, -r, r * 2, r * 2);
  }
}
