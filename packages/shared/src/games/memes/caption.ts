import { MAX_CAPTION_BOXES, MAX_CAPTION_CHARS, MIN_USABLE_CHARS } from './constants';

/**
 * C0/C1 controls, zero-width marks, and bidi embedding/override controls.
 *
 * The control characters are the point, so `no-control-regex` is exactly
 * backwards here: a caption is drawn on everyone's screen, and a stray
 * U+202E would flip the direction of every character after it, for every
 * player. Stripping them is the whole job of this constant.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

export function sanitize(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .normalize('NFC')
    .replace(UNSAFE, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return Array.from(cleaned).slice(0, MAX_CAPTION_CHARS).join('');
}

export function normalizeCaption(raw: unknown, minimumSlots: number): string[] {
  const values = Array.isArray(raw) ? raw : [];
  const minimum = minimumSlots === 2 ? 2 : 1;
  const count = Math.min(MAX_CAPTION_BOXES, Math.max(minimum, values.length));
  return Array.from({ length: count }, (_, index) => sanitize(values[index]));
}

export function isUsableCaption(texts: readonly unknown[], minimumSlots: number): boolean {
  const normalized = normalizeCaption(texts, minimumSlots);
  return normalized.some((text) => {
    const useful = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    return useful >= MIN_USABLE_CHARS;
  });
}
