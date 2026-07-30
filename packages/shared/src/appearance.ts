/**
 * Hats and faces.
 *
 * Like colours in `players.ts`, these belong to the room rather than to any one
 * game — the hat you pick in the lobby sits on your soldier in Gun Mayhem and
 * on your curve's head in Achtung. Unlike colours they are *not* unique per
 * room: eight people in eight crowns is a perfectly good afternoon.
 *
 * Only the index travels. The actual shapes are drawn on the canvas client-side
 * (`client/src/game/appearance.ts`), so nothing here reaches the simulation and
 * no snapshot gets wider.
 */

export const HATS = [
  'none',
  'cap',
  'crown',
  'tophat',
  'horns',
  'headband',
  'halo',
  'beanie',
] as const;

export const HAT_NAMES = [
  'No hat',
  'Cap',
  'Crown',
  'Top hat',
  'Horns',
  'Headband',
  'Halo',
  'Beanie',
] as const;

export const FACES = ['default', 'happy', 'angry', 'shades', 'dead', 'cyclops'] as const;

export const FACE_NAMES = ['Normal', 'Happy', 'Angry', 'Shades', 'Dizzy', 'Cyclops'] as const;

export type Hat = (typeof HATS)[number];
export type Face = (typeof FACES)[number];

export function hatFor(hatIndex: number): Hat {
  return HATS[normalize(hatIndex, HATS.length)]!;
}

export function faceFor(faceIndex: number): Face {
  return FACES[normalize(faceIndex, FACES.length)]!;
}

/** True for a value that is safe to store as someone's hat index. */
export function isHatIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < HATS.length;
}

export function isFaceIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < FACES.length;
}

/** Tolerates junk from old saved identities and hostile clients alike. */
function normalize(index: number, length: number): number {
  if (!Number.isFinite(index)) return 0;
  const whole = Math.trunc(index);
  return ((whole % length) + length) % length;
}
