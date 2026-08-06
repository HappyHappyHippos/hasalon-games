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
    const paragraphs = text.split(/\r?\n/);
    let totalLines = 0;

    for (const para of paragraphs) {
      if (para.length === 0) {
        totalLines += 1;
        continue;
      }
      const words = para.split(/\s+/);
      let currentLineLen = 0;
      let paraLines = 1;

      for (const word of words) {
        const wordLen = Array.from(word).length;
        if (wordLen === 0) continue;

        if (currentLineLen === 0) {
          if (wordLen <= columns) {
            currentLineLen = wordLen;
          } else {
            paraLines += Math.ceil(wordLen / columns) - 1;
            currentLineLen = wordLen % columns || columns;
          }
        } else {
          if (currentLineLen + 1 + wordLen <= columns) {
            currentLineLen += 1 + wordLen;
          } else {
            paraLines += 1;
            if (wordLen <= columns) {
              currentLineLen = wordLen;
            } else {
              paraLines += Math.ceil(wordLen / columns) - 1;
              currentLineLen = wordLen % columns || columns;
            }
          }
        }
      }
      totalLines += paraLines;
    }

    return totalLines * size * lineHeight <= height;
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
