/**
 * Recolors the green tank body/hull in `tank_game_tank_asset.png` to match a player's seat color.
 */

const canvasCache = new Map<string, HTMLCanvasElement>();

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * Creates an offscreen canvas containing a recolored version of the tank sprite.
 * Green body pixels are mapped to targetColor while preserving shading, outlines, and treads.
 */
export function getRecoloredTankSprite(
  img: HTMLImageElement | HTMLCanvasElement,
  targetColor: string,
  shadow = false,
): HTMLCanvasElement | null {
  const cacheKey = `${targetColor}_${shadow}_${img.width}x${img.height}`;
  if (canvasCache.has(cacheKey)) {
    return canvasCache.get(cacheKey)!;
  }

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, img.width, img.height);
  const data = imgData.data;

  const { r: tr, g: tg, b: tb } = hexToRgb(targetColor);

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 10) continue;

    if (shadow) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
      continue;
    }

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;

    // Detect green body pixels (where green is dominant and chroma > 20)
    if (max === g && chroma > 20 && g > 45) {
      // Intensity multiplier relative to standard green hull tone (~130)
      const intensity = (0.299 * r + 0.587 * g + 0.114 * b) / 130;
      data[i] = Math.min(255, Math.round(tr * intensity));
      data[i + 1] = Math.min(255, Math.round(tg * intensity));
      data[i + 2] = Math.min(255, Math.round(tb * intensity));
    }
  }

  ctx.putImageData(imgData, 0, 0);
  canvasCache.set(cacheKey, canvas);
  return canvas;
}
