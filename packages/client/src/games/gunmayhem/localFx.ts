import { TICK_MS } from '@mg/shared';
import {
  IN_SHOOT,
  WEAPONS,
  cooldownMul,
  emptyBuffs,
  type GmBuffKind,
  type GmBuffs,
  type GmSnapshotPlayer,
  type WeaponKind,
} from '@mg/shared/gunmayhem';

/**
 * Fires your gun's *look and sound* the moment you press the trigger, instead
 * of a round trip later.
 *
 * Movement was already predicted, so pressing right moved you immediately while
 * pressing fire did nothing at all until the server said so. On a 70 ms
 * connection that is 140 ms of holding a trigger against silence, and it is the
 * single most obvious piece of lag left in the game — worse than the actual
 * latency, because nothing on screen acknowledges the input.
 *
 * Nothing here is authoritative. No bullet exists, nothing takes damage,
 * nothing is sent. The server still decides entirely who shot and what it hit;
 * this only brings forward the muzzle flash, the recoil kick on the sprite, the
 * shake and the bang, and then steps out of the way when the real event lands.
 */

/** Everything the renderer needs to draw a shot, identical to the server event's payload. */
export interface LocalShot {
  kind: WeaponKind;
  x: number;
  y: number;
  dir: 1 | -1;
}

/**
 * How long a locally-played shot waits to be matched with the server's echo.
 *
 * Comfortably past any round trip we would still call playable. An entry that
 * ages out just means one extra flash, which is what the old behaviour looked
 * like anyway.
 */
const MATCH_WINDOW_MS = 600;

export class LocalShotFx {
  /** Locally-played shots that have not yet been matched to a server event. */
  private pending: number[] = [];

  private cooldownUntil = 0;

  /** Rounds fired locally since `ammoTick`, to keep an empty gun from flashing. */
  private spent = 0;
  private ammoTick = -1;

  /**
   * Decide whether to play a shot this frame.
   *
   * `body` is the *predicted* local body, so the flash appears at the barrel
   * where the player sees themselves, not where the server last said they were.
   */
  update(
    now: number,
    tick: number,
    server: GmSnapshotPlayer | undefined,
    body: { x: number; y: number; facing: 1 | -1 },
    bits: number,
    controllable: boolean,
  ): LocalShot | null {
    const held = (bits & IN_SHOOT) !== 0;

    if (!server || !controllable) {
      // Hitstun, respawn, out of stocks, countdown: the server owns the
      // character and prediction is off. Guessing shots here would be guessing
      // about a body we are not simulating.
      if (!controllable) this.cooldownUntil = 0;
      return null;
    }

    // The server's ammo count is the truth as of its own tick; our local shots
    // since then are the correction. Re-baselining on every new tick keeps the
    // error bounded to one snapshot's worth of firing.
    if (tick !== this.ammoTick) {
      this.ammoTick = tick;
      this.spent = 0;
    }

    const weapon = WEAPONS[server.w];
    // A knife is a swing, not a shot, and `stab` events carry hit information
    // we cannot know locally — whether it connected changes the whole effect.
    if (weapon.melee) return null;

    // Capacity 0 means infinite, which is the pistol and only the pistol.
    if (weapon.ammo > 0 && server.am - this.spent <= 0) return null;

    // Held, not pressed. `stepShooting` gates on the held bit and the cooldown
    // and nothing else, so every gun is effectively full-auto and releasing and
    // re-pressing inside the cooldown fires nothing. Triggering on the rising
    // edge instead would flash on presses the server ignores.
    if (!held || now < this.cooldownUntil) return null;

    const buffs = readBuffs(server);
    const ticks = Math.max(1, Math.round(weapon.cooldown * cooldownMul(buffs)));
    this.cooldownUntil = now + ticks * TICK_MS;
    this.spent += 1;
    this.pending.push(now);

    return { kind: weapon.kind, x: body.x, y: body.y, dir: body.facing };
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
    this.cooldownUntil = 0;
    this.spent = 0;
    this.ammoTick = -1;
  }
}

/** `bf` is absent when no buffs are active, and omits any that are not. */
function readBuffs(server: GmSnapshotPlayer): GmBuffs {
  const buffs = emptyBuffs();
  if (server.bf) {
    for (const kind of Object.keys(server.bf) as GmBuffKind[]) {
      buffs[kind] = server.bf[kind] ?? 0;
    }
  }
  return buffs;
}
