import {
  boxesForCaptionCount,
  templateById,
  type MemeTextBox,
  type MemesStageEntry,
} from '@mg/shared/memes';
import { memeUrl } from './preload';

type Drawable = HTMLImageElement | HTMLVideoElement;

function loadDrawable(templateId: string, format: 'jpg' | 'mp4'): Promise<Drawable> {
  if (format === 'mp4') {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.onloadeddata = () => resolve(video);
      video.onerror = () => reject(new Error('Could not load animated meme'));
      video.src = memeUrl(templateId);
      video.load();
    });
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load meme image'));
    image.src = memeUrl(templateId);
  });
}

function dimensions(source: Drawable): { width: number; height: number } {
  return source instanceof HTMLVideoElement
    ? { width: source.videoWidth, height: source.videoHeight }
    : { width: source.naturalWidth, height: source.naturalHeight };
}

function linesFor(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split(/\r?\n/);
  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
      if (paragraphs.length > 1) lines.push('');
      continue;
    }
    let line = words[0]!;
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`;
      if (ctx.measureText(candidate).width <= width) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: MemeTextBox,
  x: number,
  y: number,
  widthRatio: number,
  heightRatio: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (!text || !text.trim()) return;
  const left = x * canvasWidth;
  const top = y * canvasHeight;
  const width = widthRatio * canvasWidth;
  const height = heightRatio * canvasHeight;
  const padding = Math.max(4, canvasWidth * 0.008);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const latin = !/[\u0590-\u05ff]/u.test(text);
  const rendered = latin ? text.toLocaleUpperCase('en') : text;
  const floor = Math.max(12, canvasWidth * 0.025);
  let size = Math.min(canvasWidth * 0.09, availableHeight);
  let lines: string[] = [];
  while (size > floor) {
    ctx.font = `900 ${size}px Rubik, Arial, sans-serif`;
    lines = linesFor(ctx, rendered, availableWidth);
    if (lines.length * size * 1.08 <= availableHeight) break;
    size -= 1;
  }

  ctx.save();
  ctx.font = `900 ${size}px Rubik, Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = box.align === 'center' ? 'center' : box.align;
  ctx.direction = /[\u0590-\u05ff]/u.test(rendered) ? 'rtl' : 'ltr';
  const textX = box.align === 'center' ? left + width / 2 : box.align === 'right' ? left + width - padding : left + padding;
  const blockHeight = lines.length * size * 1.08;
  const firstY = top + (height - blockHeight) / 2 + size * 0.54;
  if (box.style === 'panel') {
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(left, top, width, height);
    ctx.strokeStyle = '#14110f';
    ctx.lineWidth = Math.max(2, canvasWidth * 0.004);
    ctx.strokeRect(left, top, width, height);
  }
  lines.forEach((line, index) => {
    const lineY = firstY + index * size * 1.08;
    if (box.style === 'impact') {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#14110f';
      ctx.lineWidth = Math.max(3, size * 0.12);
      ctx.strokeText(line, textX, lineY, availableWidth);
      ctx.fillStyle = '#fff';
    } else {
      ctx.fillStyle = '#14110f';
    }
    ctx.fillText(line, textX, lineY, availableWidth);
  });
  ctx.restore();
}

/**
 * The three fields the renderer below actually reads.
 *
 * Structural rather than `MemesStageEntry`, so the end-of-match gallery — whose
 * entries carry a round and an author instead of a live tally — can be saved by
 * the same code that saves the one currently on stage.
 */
export type DownloadableMeme = Pick<MemesStageEntry, 'templateId' | 'texts' | 'positions'>;

/** Render the meme to a real image and download it locally. */
export async function downloadMeme(stage: DownloadableMeme): Promise<void> {
  const template = templateById(stage.templateId);
  if (!template) throw new Error('Unknown meme template');
  await document.fonts?.ready;
  const source = await loadDrawable(stage.templateId, template.format);
  const natural = dimensions(source);
  if (natural.width <= 0 || natural.height <= 0) throw new Error('Meme has no dimensions');
  const scale = Math.min(1, 1280 / Math.max(natural.width, natural.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(natural.width * scale));
  canvas.height = Math.max(1, Math.round(natural.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  boxesForCaptionCount(template, stage.texts.length).forEach((box, index) => {
    const position = stage.positions[index] ?? box;
    drawCaption(
      ctx,
      stage.texts[index] ?? '',
      box,
      position.x,
      position.y,
      position.w ?? box.w,
      position.h ?? box.h,
      canvas.width,
      canvas.height,
    );
  });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode meme')), 'image/jpeg', 0.9);
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `hasalon-${stage.templateId}.jpg`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
