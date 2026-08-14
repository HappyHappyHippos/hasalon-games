/**
 * Keep the trajectory useful without disclosing the landing point.
 *
 * The percentage handles short shots (which used to remain fully visible even
 * after lowering the simulation cap); the absolute cap keeps long, high-power
 * arcs from stretching across most of the arena.
 */
export function aimPreviewPointCount(totalPoints: number): number {
  if (totalPoints <= 0) return 0;
  return Math.min(totalPoints, Math.max(2, Math.min(55, Math.ceil(totalPoints * 0.62))));
}
