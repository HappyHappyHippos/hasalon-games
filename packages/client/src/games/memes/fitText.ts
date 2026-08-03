export interface FitTextOptions {
  width: number;
  height: number;
  text: string;
  minSize: number;
  maxSize: number;
  lineHeight?: number;
  averageGlyphWidth?: number;
}

/**
 * Largest font size whose conservative text estimate fits a fixed caption box.
 * The predicate is monotone, so a binary search is both fast and deterministic.
 */
export function fitText({
  width,
  height,
  text,
  minSize,
  maxSize,
  lineHeight = 1.05,
  averageGlyphWidth = 0.62,
}: FitTextOptions): number {
  const floor = Math.max(1, minSize);
  if (width <= 0 || height <= 0 || text.length === 0 || maxSize <= floor) return floor;

  const fits = (size: number): boolean => {
    const columns = Math.max(1, Math.floor(width / (size * averageGlyphWidth)));
    const lines = Math.max(1, Math.ceil(Array.from(text).length / columns));
    return lines * size * lineHeight <= height;
  };

  let low = floor;
  let high = Math.max(floor, maxSize);
  for (let i = 0; i < 14; i += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return Math.round(low * 10) / 10;
}
