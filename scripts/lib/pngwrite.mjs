import { deflateSync } from 'node:zlib';

/**
 * Minimal PNG writer — 8-bit truecolour, adaptively filtered per scanline.
 *
 * Exists so `derive-stage-boxes.mjs` can dump a visual diff of the derived
 * hitboxes over the artwork. Reading a mask is the only way to tell a good
 * classifier from a plausible-looking one, and eyeballing numbers does not
 * substitute for it.
 *
 * `channels` is 3 (RGB) by default and 4 for RGBA. The alpha path is what
 * `derive-worms-terrain.mjs` emits its destructible terrain layer through — a
 * silhouette is exactly "the painting with the background knocked out", and
 * there is no way to say that in colour type 2.
 *
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} pixels `width * height * channels` bytes, row-major.
 * @param {3 | 4} [channels]
 */
export function encodePng(width, height, pixels, channels = 3) {
  if (channels !== 3 && channels !== 4) throw new Error(`channels must be 3 or 4, got ${channels}`);

  const raw = filter(pixels, width, height, channels);
  const stride = width * channels;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 4 ? 6 : 2; // colour type: truecolour, with alpha for 4
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Per-scanline filtering, picking whichever of the five the spec offers costs
 * the fewest bytes for that row.
 *
 * Worth the thirty lines: unfiltered rows made the Worms background plates
 * 1.2 MB each, because a smooth gradient is a *terrible* thing to hand deflate
 * raw and a wonderful one to hand it as differences — most rows of a sky
 * gradient become a run of zeroes. The heuristic is the standard one from the
 * spec's §12.8, minimising the sum of absolute signed differences.
 */
function filter(pixels, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc((stride + 1) * height);

  const apply = (type, row, up, y, i) => {
    const x = pixels[row + i];
    const a = i >= bpp ? pixels[row + i - bpp] : 0;
    const b = y > 0 ? pixels[up + i] : 0;
    const c = y > 0 && i >= bpp ? pixels[up + i - bpp] : 0;
    if (type === 0) return x;
    if (type === 1) return x - a;
    if (type === 2) return x - b;
    if (type === 3) return x - ((a + b) >> 1);
    return x - paeth(a, b, c);
  };

  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    const up = row - stride;
    let bestType = 0;
    let bestScore = Infinity;

    for (let type = 0; type < 5; type += 1) {
      let score = 0;
      for (let i = 0; i < stride; i += 1) {
        const value = apply(type, row, up, y, i) & 0xff;
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
      }
    }

    out[y * (stride + 1)] = bestType;
    for (let i = 0; i < stride; i += 1) {
      out[y * (stride + 1) + 1 + i] = apply(bestType, row, up, y, i) & 0xff;
    }
  }

  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
