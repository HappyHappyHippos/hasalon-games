import { preloadImages } from '../../game/images';
import { templateById } from '@mg/shared/memes';

const warmedVideos = new Map<string, HTMLVideoElement>();

export function memeUrl(templateId: string): string {
  const extension = templateById(templateId)?.format ?? 'jpg';
  return `/memes/${encodeURIComponent(templateId)}.${extension}`;
}

/** Warm only template ids this socket has legitimately learned. */
export function preloadMemes(templateIds: readonly string[]): void {
  const ids = templateIds.filter(Boolean);
  preloadImages(ids.filter((id) => templateById(id)?.format !== 'mp4').map(memeUrl));
  for (const id of ids) {
    if (templateById(id)?.format !== 'mp4' || warmedVideos.has(id)) continue;
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = memeUrl(id);
    video.load();
    warmedVideos.set(id, video);
  }
}
