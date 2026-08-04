import { shuffle, type RngState } from './rng';
import { MEME_ASSETS } from './templateAssets';
import { GIF_MEME_ASSETS } from './gifTemplateAssets';
import { MEME_LAYOUTS } from './templateLayouts';
import { MAX_CAPTION_BOXES } from './constants';
import type { MemeTemplate, MemeTextBox } from './types';

const ADDED_BOX_WIDTH = 0.8;
const ADDED_BOX_HEIGHT = 0.18;

function overlapArea(a: MemeTextBox, b: MemeTextBox): number {
  const width = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return width * height;
}

/** Put a new box in the largest available band, preferring the image centre. */
function placeAddedBox(existing: readonly MemeTextBox[]): MemeTextBox {
  let best: MemeTextBox | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const lastY = Math.round((1 - ADDED_BOX_HEIGHT) * 100);
  for (let step = 0; step <= lastY; step += 1) {
    const candidate: MemeTextBox = {
      x: (1 - ADDED_BOX_WIDTH) / 2,
      y: step / 100,
      w: ADDED_BOX_WIDTH,
      h: ADDED_BOX_HEIGHT,
      style: 'impact',
      align: 'center',
    };
    const overlap = existing.reduce((sum, box) => sum + overlapArea(candidate, box), 0);
    const centreDistance = Math.abs(candidate.y + candidate.h / 2 - 0.5);
    const score = overlap * 1_000 + centreDistance;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best!;
}

const TOP_BOTTOM: MemeTextBox[] = [
  { x: 0.04, y: 0.03, w: 0.92, h: 0.24, style: 'impact', align: 'center' },
  { x: 0.04, y: 0.73, w: 0.92, h: 0.24, style: 'impact', align: 'center' },
];
const BOTTOM: MemeTextBox[] = [
  { x: 0.05, y: 0.7, w: 0.9, h: 0.26, style: 'impact', align: 'center' },
];
const RIGHT_PANELS: MemeTextBox[] = [
  { x: 0.53, y: 0.05, w: 0.43, h: 0.4, style: 'impact', align: 'center' },
  { x: 0.53, y: 0.55, w: 0.43, h: 0.4, style: 'impact', align: 'center' },
];
const LEFT_RIGHT: MemeTextBox[] = [
  { x: 0.03, y: 0.05, w: 0.45, h: 0.3, style: 'impact', align: 'center' },
  { x: 0.52, y: 0.05, w: 0.45, h: 0.3, style: 'impact', align: 'center' },
];

/** Hand-tuned fallbacks for templates absent from Imgflip's saved generator geometry. */
const BOX_OVERRIDES: Readonly<Record<string, MemeTextBox[]>> = {
  'drake-hotline-bling': RIGHT_PANELS,
  'tuxedo-winnie-the-pooh': RIGHT_PANELS,
  'sleeping-shaq': RIGHT_PANELS,
  'woman-yelling-at-cat': LEFT_RIGHT,
  'buff-doge-vs-cheems': LEFT_RIGHT,
  'epic-handshake': LEFT_RIGHT,
  '354700819-two-guys-on-a-bus': LEFT_RIGHT,
};

/** Current Imgflip Top 30 Days list, snapshotted locally for offline matches. */
export const MEME_TEMPLATES: MemeTemplate[] = [...MEME_ASSETS, ...GIF_MEME_ASSETS].map((asset) => ({
  id: asset.id,
  name: asset.name,
  slots: asset.slots,
  boxes: [...(MEME_LAYOUTS[asset.id] ?? BOX_OVERRIDES[asset.id] ?? (asset.slots === 1 ? BOTTOM : TOP_BOTTOM))],
  aspect: asset.aspect,
  format: asset.format ?? 'jpg',
  nudge: asset.slots === 2
    ? { he: 'ציפיות מול מציאות…', en: 'Expectation versus reality…' }
    : { he: 'הרגע הזה כש…', en: 'That moment when…' },
  tier: asset.tier,
}));

const BY_ID = new Map(MEME_TEMPLATES.map((template) => [template.id, template]));

export function templateById(id: string): MemeTemplate | undefined {
  return BY_ID.get(id);
}

/** Template boxes plus the shared geometry for player-added captions. */
export function boxesForCaptionCount(
  template: MemeTemplate | undefined,
  count: number,
): MemeTextBox[] {
  if (!template) return [];
  const total = Math.min(MAX_CAPTION_BOXES, Math.max(template.slots, Math.round(count)));
  const boxes = template.boxes.map((box) => ({ ...box }));
  while (boxes.length < total) boxes.push(placeAddedBox(boxes));
  return boxes;
}

export function isKnownTemplate(id: string): boolean {
  return BY_ID.has(id);
}

export function pickTemplates(
  count: number,
  used: ReadonlySet<string>,
  rng: RngState,
): MemeTemplate[] {
  if (count <= 0 || MEME_TEMPLATES.length === 0) return [];
  const fresh = shuffle(rng, MEME_TEMPLATES.filter((template) => !used.has(template.id)));
  const fallback = shuffle(rng, MEME_TEMPLATES.filter((template) => used.has(template.id)));
  return [...fresh, ...fallback].slice(0, Math.min(count, MEME_TEMPLATES.length));
}
