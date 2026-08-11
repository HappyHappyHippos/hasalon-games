/**
 * Recolours the worm sprite's coral body to a player's seat colour.
 *
 * A near-copy of `tanks/tankRecolor.ts` rather than a shared generalisation,
 * and deliberately. The two differ in the only interesting line — which hue
 * counts as "the body", green there and red here — and a shared version would
 * need the hue test, the reference luma and the exclusions all passed in, at
 * which point it is a worse-named copy with more moving parts. Changing one
 * should not be able to break a game that already ships.
 *
 * What must survive the pass: the thick black outline, the white eyes and their
 * pupils, and the soft highlights along the top of each segment. All three fall
 * out of keying on hue and scaling by luminance rather than replacing colour
 * outright — a highlight is the same hue at a higher intensity, so it stays a
 * highlight in whatever colour the worm ends up.
 */

const cache = new Map<string, HTMLCanvasElement>();

/**
 * The sprite's own coral, as a luminance.
 *
 * Body pixels are divided by this and the result multiplies the target colour,
 * so mid-tone body lands exactly on the seat colour while highlights come out
 * brighter and shaded segments darker.
 */
const BODY_LUMA = 163;

/**
 * **The exported file's maximum alpha is 254, not 255.**
 *
 * Whatever cut it out shaved one level off every pixel, so an `a === 255` test
 * matches nothing at all and the sprite silently fails to draw. Everything here
 * thresholds well below that; the note is here because the next person to write
 * an alpha test against this asset will otherwise spend an hour on it.
 */
const ALPHA_FLOOR = 10;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(clean, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

/**
 * A recoloured copy, or null if the canvas is unavailable.
 *
 * `shadow` returns the silhouette in flat black, which is how the worms get a
 * hard offset shadow without a second asset — see the note at the top of
 * `tokens.css` about shadows never being blurred.
 */
export function getRecoloredWorm(
  image: HTMLImageElement | HTMLCanvasElement,
  color: string,
  shadow = false,
): HTMLCanvasElement | null {
  const key = `${color}_${shadow}_${image.width}x${image.height}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height);
  const px = data.data;
  const { r: tr, g: tg, b: tb } = hexToRgb(color);

  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3]!;
    if (a < ALPHA_FLOOR) continue;

    if (shadow) {
      px[i] = 0;
      px[i + 1] = 0;
      px[i + 2] = 0;
      continue;
    }

    const r = px[i]!;
    const g = px[i + 1]!;
    const b = px[i + 2]!;
    const max = Math.max(r, g, b);
    const chroma = max - Math.min(r, g, b);

    // Coral is red-dominant with real saturation. The outline is near-black and
    // fails the brightness floor; the eyes are white and fail the chroma one.
    if (max !== r || chroma <= 25 || r <= 60) continue;

    const intensity = (0.299 * r + 0.587 * g + 0.114 * b) / BODY_LUMA;
    px[i] = Math.min(255, Math.round(tr * intensity));
    px[i + 1] = Math.min(255, Math.round(tg * intensity));
    px[i + 2] = Math.min(255, Math.round(tb * intensity));
  }

  ctx.putImageData(data, 0, 0);
  cache.set(key, canvas);
  return canvas;
}
