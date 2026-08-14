/**
 * The live crate layer, packed for the wire.
 *
 * The arena's walls never change and the client already has them from the map
 * template, but the crates do — and they are the one thing a snapshot cannot
 * leave out, because a player joining mid-round has no way to derive which of
 * them have already burned. Six bits per character puts a 15×13 board in 33
 * characters, which is cheap enough to send unconditionally every frame rather
 * than reconstructing it from a seed plus a growing list of holes.
 *
 * Not `btoa`/`Buffer`: one of those exists in the browser and the other in
 * node, and this runs in both.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const INDEX = new Map<string, number>();
for (let i = 0; i < ALPHABET.length; i += 1) INDEX.set(ALPHABET[i]!, i);

/** One character per six tiles, least-significant bit first. */
export function packBits(flags: Uint8Array): string {
  let out = '';
  for (let i = 0; i < flags.length; i += 6) {
    let value = 0;
    for (let bit = 0; bit < 6; bit += 1) {
      if (flags[i + bit]) value |= 1 << bit;
    }
    out += ALPHABET[value];
  }
  return out;
}

/**
 * The inverse, into a fresh array of exactly `length`.
 *
 * Tolerant of a short or corrupt string on purpose: this is parsed from the
 * wire, and a client that renders a few missing crates is better than one that
 * throws out of its animation frame.
 */
export function unpackBits(text: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < text.length; i += 1) {
    const value = INDEX.get(text[i]!);
    if (value === undefined) continue;
    for (let bit = 0; bit < 6; bit += 1) {
      const index = i * 6 + bit;
      if (index >= length) break;
      out[index] = (value >> bit) & 1;
    }
  }
  return out;
}
