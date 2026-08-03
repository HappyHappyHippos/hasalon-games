import { preloadImages } from '../../game/images';

export function memeUrl(templateId: string): string {
  return `/memes/${encodeURIComponent(templateId)}.jpg`;
}

/** Warm only template ids this socket has legitimately learned. */
export function preloadMemes(templateIds: readonly string[]): void {
  preloadImages(templateIds.filter(Boolean).map(memeUrl));
}
