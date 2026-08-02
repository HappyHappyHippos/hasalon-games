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
      return r * 1.05;
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
  const eye = Math.max(1.4, r * 0.16); // Slightly smaller for 3/4 view

  ctx.save();
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.2, r * 0.14);
  ctx.lineCap = 'round';

  const leftEye = r * 0.15;
  const rightEye = r * 0.65;
  const eyeY = -r * 0.05;

  switch (face) {
    case 'default':
      // Skribbl neutral: ._.
      dot(ctx, leftEye, eyeY, eye);
      dot(ctx, rightEye, eyeY, eye);
      ctx.beginPath();
      ctx.moveTo(r * 0.3, r * 0.25);
      ctx.lineTo(r * 0.5, r * 0.25);
      ctx.stroke();
      break;

    case 'happy':
      // Skribbl happy: dots and big smile
      dot(ctx, leftEye, eyeY, eye);
      dot(ctx, rightEye, eyeY, eye);
      ctx.beginPath();
      ctx.arc(r * 0.4, r * 0.15, r * 0.25, 0, Math.PI);
      ctx.stroke();
      break;

    case 'angry':
      // Angry brows and frown
      dot(ctx, leftEye, eyeY, eye);
      dot(ctx, rightEye, eyeY, eye);
      ctx.beginPath();
      ctx.moveTo(leftEye - eye, eyeY - r * 0.2);
      ctx.lineTo(leftEye + eye, eyeY - r * 0.05);
      ctx.moveTo(rightEye + eye, eyeY - r * 0.2);
      ctx.lineTo(rightEye - eye, eyeY - r * 0.05);
      ctx.moveTo(r * 0.25, r * 0.4);
      ctx.quadraticCurveTo(r * 0.4, r * 0.25, r * 0.55, r * 0.4);
      ctx.stroke();
      break;

    case 'shades':
      // Sunglasses with a straight mouth
      ctx.fillRect(-r * 0.05, eyeY - r * 0.15, r * 0.95, r * 0.35);
      ctx.beginPath();
      ctx.moveTo(r * 0.3, r * 0.35);
      ctx.lineTo(r * 0.5, r * 0.35);
      ctx.stroke();
      break;

    case 'dead':
      // x_x
      for (const x of [leftEye, rightEye]) {
        ctx.beginPath();
        ctx.moveTo(x - eye, eyeY - eye);
        ctx.lineTo(x + eye, eyeY + eye);
        ctx.moveTo(x + eye, eyeY - eye);
        ctx.lineTo(x - eye, eyeY + eye);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(r * 0.3, r * 0.35);
      ctx.lineTo(r * 0.5, r * 0.35);
      ctx.stroke();
      break;

    case 'cyclops':
      // One big eye and a mouth
      dot(ctx, r * 0.4, eyeY, eye * 1.7);
      ctx.fillStyle = '#fdf6e8';
      dot(ctx, r * 0.45, eyeY - eye * 0.4, eye * 0.5);
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.moveTo(r * 0.3, r * 0.4);
      ctx.lineTo(r * 0.5, r * 0.4);
      ctx.stroke();
      break;
  }

  ctx.restore();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}
