/**
 * Keeps your own gunfire from being played twice.
 *
 * Your shots are drawn and heard the moment you pull the trigger rather than a
 * round trip later — `predictor.ts` decides when one happens, as part of
 * replaying your input, because firing moves you and the kick has to be part of
 * the same simulation as the movement. Then the server's own `shot` event
 * arrives for the same shot, and without this it would flash and bang a second
 * time.
 *
 * That is all this does now. It used to reproduce the server's cooldown, ammo
 * and phase gates itself in order to guess when you had fired, which meant two
 * independent clocks deciding the same thing and occasionally disagreeing by a
 * tick — a flash with no kick, or the reverse.
 */
export class LocalShotFx {
  /** Locally-played shots that have not yet been matched to a server event. */
  private pending: number[] = [];

  /** Record that we have already drawn and played a shot at `now`. */
  played(now: number): void {
    this.pending.push(now);
  }

  /**
   * Called when the server's own-seat `shot` event arrives. True means we
   * already played this one and the renderer should skip it.
   */
  consume(now: number): boolean {
    while (this.pending.length > 0 && now - this.pending[0]! > MATCH_WINDOW_MS) {
      this.pending.shift();
    }
    if (this.pending.length === 0) return false;
    this.pending.shift();
    return true;
  }

  reset(): void {
    this.pending = [];
  }
}

/**
 * How long a locally-played shot waits to be matched with the server's echo.
 *
 * Comfortably past any round trip we would still call playable. An entry that
 * ages out just means one extra flash, which is what the old behaviour looked
 * like anyway.
 */
const MATCH_WINDOW_MS = 600;
