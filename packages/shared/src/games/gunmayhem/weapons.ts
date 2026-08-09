import type { WeaponKind } from './types';

export interface WeaponDef {
  kind: WeaponKind;
  name: string;
  /** Single glyph for the HUD and crate art. */
  icon: string;
  damage: number;
  /** Ticks between shots. */
  cooldown: number;
  /** Bullet speed in units per second. */
  speed: number;
  /** Multiplier on knockback. */
  kbMul: number;
  /**
   * 0 would mean infinite; nothing currently uses it. The pistol used to be
   * the exception (issue #40 gave it a 10-round magazine and a reload — see
   * `PISTOL_RELOAD_TICKS` in constants.ts and `spendRound` in shooting.ts).
   */
  ammo: number;
  pellets: number;
  /** Radians of random spread per pellet. */
  spread: number;
  /**
   * Backwards shove applied to the shooter, in units per second, the same
   * standing as airborne.
   *
   * Compare against `RUN_SPEED` (345) to read these: a value near it is a shove
   * you fight, well over it is a launch. Ground friction bleeds a kick off in
   * about `recoil / 31` ticks and air friction takes six times longer, so the
   * air is where these are felt. Recoil-jumping is a real technique.
   */
  recoil: number;
  explosive: boolean;
  blastRadius: number;
  /** Ticks before the bullet expires. */
  life: number;
  /**
   * Present only on melee weapons, and its presence is what selects the melee
   * path in `sim.ts:stepShooting` — no projectile, an instant hitbox `reach`
   * units in front of you, and a `lunge` forwards instead of recoil back.
   */
  melee?: { reach: number; lunge: number };
}

export const WEAPONS: Record<WeaponKind, WeaponDef> = {
  pistol: {
    kind: 'pistol',
    name: 'Pistol',
    icon: '•',
    damage: 6,
    cooldown: 13,
    speed: 1500,
    kbMul: 1,
    // Issue #40: ten rounds, then a reload — see `PISTOL_RELOAD_TICKS` and
    // `spendRound` in `shooting.ts`. It is the default weapon, so an empty
    // pistol reloads in place instead of swapping to itself.
    ammo: 10,
    pellets: 1,
    spread: 0,
    recoil: 150,
    explosive: false,
    blastRadius: 0,
    life: 70,
  },
  smg: {
    kind: 'smg',
    name: 'SMG',
    icon: '⋯',
    damage: 3.2,
    cooldown: 5,
    speed: 1650,
    kbMul: 0.62,
    ammo: 70,
    pellets: 1,
    spread: 0.045,
    recoil: 45,
    explosive: false,
    blastRadius: 0,
    life: 60,
  },
  shotgun: {
    kind: 'shotgun',
    name: 'Shotgun',
    icon: '⋙',
    damage: 5.5,
    cooldown: 32,
    speed: 1350,
    kbMul: 1.25,
    ammo: 20,
    pellets: 6,
    spread: 0.12,
    recoil: 360,
    explosive: false,
    blastRadius: 0,
    life: 38,
  },
  sniper: {
    kind: 'sniper',
    name: 'Sniper',
    icon: '⤙',
    damage: 15,
    cooldown: 58,
    speed: 2700,
    kbMul: 2.3,
    ammo: 7,
    pellets: 1,
    spread: 0,
    recoil: 460,
    explosive: false,
    blastRadius: 0,
    life: 90,
  },
  rocket: {
    kind: 'rocket',
    name: 'Rocket',
    icon: '➤',
    damage: 40,
    cooldown: 65,
    speed: 950,
    kbMul: 4.5,
    ammo: 6,
    pellets: 1,
    spread: 0,
    recoil: 450,
    explosive: true,
    blastRadius: 220,
    life: 120,
  },
  knife: {
    kind: 'knife',
    name: 'Knife',
    icon: '†',
    damage: 24,
    cooldown: 22,
    // Nothing that describes a bullet applies. `pellets: 0` also means the
    // spread draw never happens, so melee never touches the RNG stream.
    speed: 0,
    kbMul: 3.0,
    ammo: 10,
    pellets: 0,
    spread: 0,
    recoil: 0,
    explosive: false,
    blastRadius: 0,
    life: 0,
    melee: { reach: 48, lunge: 420 },
  },
};

/** What crates can contain. Repeats are simply more likely. */
export const CRATE_POOL: WeaponKind[] = [
  'smg',
  'smg',
  'smg',
  'shotgun',
  'shotgun',
  'shotgun',
  'sniper',
  'sniper',
  'rocket',
  'knife',
  'knife',
];

export const DEFAULT_WEAPON: WeaponKind = 'pistol';
