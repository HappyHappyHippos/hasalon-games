import { MAX_CAPTION_CHARS, MIN_USABLE_CHARS } from './constants';

/** C0/C1 controls, zero-width marks, and bidi embedding/override controls. */
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

export function normalizeCaption(raw: readonly unknown[], slots: number): string[] {
  const count = slots === 2 ? 2 : 1;
  return Array.from({ length: count }, (_, index) => sanitize(raw[index]));
}

export function isUsableCaption(texts: readonly unknown[], slots: number): boolean {
  const normalized = normalizeCaption(texts, slots);
  const useful = normalized.join('').match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return useful >= MIN_USABLE_CHARS;
}
