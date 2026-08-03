/**
 * Fetch Imgflip's own default text geometry for the locally curated templates.
 *
 * `get_memes` exposes only a box count. The generator search endpoint returns
 * the actual x/y/width/height defaults that make labels land on Drake's white
 * panels, the Two Buttons labels, and other template-specific targets. Keeping
 * this generated data beside the shared manifest makes the game work offline.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsPath = path.join(root, 'packages/shared/src/games/memes/templateAssets.ts');
const outputPath = path.join(root, 'packages/shared/src/games/memes/templateLayouts.ts');
const source = await readFile(assetsPath, 'utf8');
const assets = [...source.matchAll(/\{ id: '((?:\\'|[^'])+)', name: '((?:\\'|[^'])+)', aspect: [^,]+, slots: ([12]), tier: '[^']+', source: 'https:\/\/imgflip\.com\/meme\/([^']+)' \}/g)]
  .map((match) => ({
    id: match[1].replaceAll("\\'", "'"),
    name: match[2].replaceAll("\\'", "'"),
    slots: Number(match[3]),
    slug: match[4],
  }));

if (assets.length === 0) throw new Error(`No meme assets found in ${assetsPath}`);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

async function fetchLayout(asset) {
  const params = new URLSearchParams({
    q: asset.name,
    event_type: '',
    limit: '20',
    transparent_only: '0',
    include_nsfw: '0',
    gifs_only: '0',
    allow_gifs: '0',
  });
  const response = await fetch(`https://imgflip.com/ajax_meme_search_new?${params}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 HasalonGames/1.0 (family game asset curation)' },
  });
  if (!response.ok) throw new Error(`${asset.id}: Imgflip returned ${response.status}`);
  const data = await response.json();
  const result = data.results?.find((candidate) =>
    candidate.url_name?.toLowerCase() === asset.slug.toLowerCase()
      || candidate.name?.toLowerCase() === asset.name.toLowerCase(),
  );
  if (!result?.default_settings || !result.w || !result.h) return [asset.id, null];

  let settings;
  try {
    settings = JSON.parse(result.default_settings).filter((box) => !box.type || box.type === 'text');
  } catch {
    return [asset.id, null];
  }
  if (settings.length === 0) return [asset.id, null];

  // Meme Machine intentionally has one or two caption fields. Preserve the
  // first matching Imgflip targets; players can drag either one when a joke
  // needs a different panel.
  const selected = asset.slots === 1
    ? [settings[0]]
    : settings.length === 1
      ? [settings[0], settings[0]]
      : settings.slice(0, 2);
  const boxes = selected.map((box) => {
    const x = clamp(Number(box.x) / result.w, 0, 0.98);
    const y = clamp(Number(box.y) / result.h, 0, 0.98);
    const w = clamp(Number(box.w) / result.w, 0.02, 1 - x);
    const h = clamp(Number(box.h) / result.h, 0.02, 1 - y);
    const color = String(box.font_color ?? '').toLowerCase();
    const style = color === '#000000' || color === 'black' ? 'plain' : 'impact';
    const align = ['left', 'right'].includes(box.text_align) ? box.text_align : 'center';
    return { x, y, w, h, style, align };
  });
  return [asset.id, boxes];
}

const layouts = new Map();
const queue = [...assets];
const workers = Array.from({ length: 8 }, async () => {
  while (queue.length > 0) {
    const asset = queue.shift();
    const [id, boxes] = await fetchLayout(asset);
    if (boxes) layouts.set(id, boxes);
  }
});
await Promise.all(workers);

const lines = [
  '/** Generated from Imgflip default_settings by scripts/curate-meme-layouts.mjs. */',
  "import type { MemeTextBox } from './types';",
  '',
  'export const MEME_LAYOUTS: Readonly<Record<string, readonly MemeTextBox[]>> = {',
];
for (const asset of assets) {
  const boxes = layouts.get(asset.id);
  if (!boxes) continue;
  lines.push(`  '${asset.id}': ${JSON.stringify(boxes)},`);
}
lines.push('};', '');
await writeFile(outputPath, lines.join('\n'), 'utf8');
console.log(`Wrote Imgflip geometry for ${layouts.size}/${assets.length} templates.`);
