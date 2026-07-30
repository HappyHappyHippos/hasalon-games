/**
 * Seat colours. These belong to the room, not to any one game — the colour you
 * pick in the lobby is the colour of your curve and of your little soldier.
 */

export const PLAYER_COLORS = [
  '#ff453a',
  '#32d74b',
  '#0a84ff',
  '#ffd60a',
  '#ff9f0a',
  '#bf5af2',
  '#64d2ff',
  '#ff6482',
] as const;

export const COLOR_NAMES = [
  'Red',
  'Green',
  'Blue',
  'Yellow',
  'Orange',
  'Purple',
  'Cyan',
  'Pink',
] as const;

export function colorFor(colorIndex: number): string {
  return PLAYER_COLORS[colorIndex % PLAYER_COLORS.length]!;
}
