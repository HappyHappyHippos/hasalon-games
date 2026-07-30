/**
 * Hides a jump in a drawn position by carrying the gap forward and decaying it.
 *
 * The problem it solves is specific. Your own character is drawn from two
 * different clocks: a *predicted* body at `now`, and an *interpolated* one a
 * snapshot interval plus half a round trip in the past. The renderer switches
 * between them whenever the server takes over — the first frame of hitstun, say
 * — and the switch alone moves the character by however far it travelled in
 * that gap. At full sprint that is over a hundred pixels, in one frame, in the
 * middle of the most legible moment of a fight. The prediction resyncs are the
 * same shape of problem from the other direction.
 *
 * So rather than trying to make the two clocks agree, the jump is absorbed:
 * the character keeps the position it was drawn at and slides to the new one
 * over about a fifth of a second. Nothing about the simulation changes — this
 * is purely what the eye is shown.
 */

/** Time constant of the decay. Roughly 99% gone after 4x this. */
const TAU_MS = 80;
/**
 * Above this the jump is drawn as a jump.
 *
 * Respawning and the start of a round genuinely teleport you across the stage,
 * and sliding there would read as the character flying to its spawn point.
 * Comfortably above the worst clock-switch gap (~150px at a sprint) and well
 * below the length of the arena.
 */
const MAX_SMOOTHED_JUMP = 240;
/**
 * Below this the offset is spent and is dropped outright, so the character
 * lands exactly on its target rather than asymptotically near it. A quarter of
 * an arena unit is a fifth of a screen pixel.
 */
const EPSILON = 0.25;

export class PositionSmoother {
  private offsetX = 0;
  private offsetY = 0;
  private lastX = 0;
  private lastY = 0;
  private lastAt = 0;
  private started = false;

  reset(): void {
    this.started = false;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  /**
   * @param jumped the caller knows the target moved for a reason that is not
   *   motion — it changed which clock it came from, or it was resynchronised.
   * @returns where to actually draw.
   */
  apply(
    x: number,
    y: number,
    now: number,
    jumped: boolean,
  ): { x: number; y: number } {
    if (!this.started) {
      this.started = true;
      this.offsetX = 0;
      this.offsetY = 0;
    } else {
      const dt = Math.min(Math.max(now - this.lastAt, 0), 250);
      const keep = Math.exp(-dt / TAU_MS);
      this.offsetX *= keep;
      this.offsetY *= keep;

      if (jumped) {
        // The gap the eye would otherwise see. `lastX/Y` is what was drawn, so
        // this already includes any offset still decaying from a previous jump.
        const dx = this.lastX - x;
        const dy = this.lastY - y;
        const smoothable = Math.hypot(dx, dy) <= MAX_SMOOTHED_JUMP;
        this.offsetX = smoothable ? dx : 0;
        this.offsetY = smoothable ? dy : 0;
      }

      if (Math.abs(this.offsetX) < EPSILON) this.offsetX = 0;
      if (Math.abs(this.offsetY) < EPSILON) this.offsetY = 0;
    }

    this.lastAt = now;
    this.lastX = x + this.offsetX;
    this.lastY = y + this.offsetY;
    return { x: this.lastX, y: this.lastY };
  }
}
