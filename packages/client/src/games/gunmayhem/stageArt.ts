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



/** Where a level's painted stage image asset lives. */
export function backdropUrl(id: LevelId): string {
  return `/stages/gun_mayhem_stage_${id}.png`;
}

/**
 * Blit the painted backdrop for this level, if it has loaded.
 */
export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  id: LevelId,
  _now: number,
): boolean {
  const url = backdropUrl(id);
  const image = getImage(url);
  if (!image) return false;

  ctx.save();
  ctx.globalAlpha = 1.0;
  ctx.drawImage(image, 0, 0, ARENA_WIDTH, ARENA_HEIGHT);
  ctx.restore();
  return true;
}

/** Scenery for a level, drawn behind the platforms. */
export function drawScenery(_ctx: CanvasRenderingContext2D, _level: Level, _now: number): void {}
