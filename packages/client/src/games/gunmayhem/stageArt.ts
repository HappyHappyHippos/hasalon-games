import { ARENA_HEIGHT, ARENA_WIDTH, type LevelId } from '@mg/shared/gunmayhem';
import { getImage } from '../../game/images';

/**
 * Stage set dressing: the painted backdrop behind a Gun Mayhem level.
 *
 * Every level ships a painted backdrop at
 * `public/stages/gun_mayhem_stage_<levelId>.png`, drawn over the procedural sky
 * and under the platforms. `getImage` loads it lazily and returns null until it
 * has arrived, so `drawBackdrop` reports whether it actually painted anything —
 * the renderer falls back to the procedural parallax bands and outlined
 * platforms for the frames before the image lands, and on any level whose file
 * is missing or fails to decode.
 *
 * That fallback is the whole error-handling story here: a 404 or a corrupt file
 * is not an error, it just means the stage renders procedurally. Same contract
 * as `music.ts` — one attempt, never retried, degrade quietly. See
 * `game/images.ts`.
 */

/** Where a level's painted stage image asset lives. */
export function backdropUrl(id: LevelId): string {
  return `/stages/gun_mayhem_stage_${id}.png`;
}

/**
 * Blit the painted backdrop for this level.
 *
 * Returns false when the image has not loaded, which is the caller's signal to
 * draw the procedural stage instead.
 */
export function drawBackdrop(ctx: CanvasRenderingContext2D, id: LevelId): boolean {
  const image = getImage(backdropUrl(id));
  if (!image) return false;

  ctx.save();
  ctx.globalAlpha = 1.0;
  ctx.drawImage(image, 0, 0, ARENA_WIDTH, ARENA_HEIGHT);
  ctx.restore();
  return true;
}
