import { inflateSync } from 'node:zlib';

/**
 * Just enough PNG to read the stage backdrops.
 *
 * 8-bit truecolour, non-interlaced — which is what every file in
 * `client/public/stages/` is, and the decoder asserts rather than degrading, so
 * a re-export in another format fails loudly here instead of producing a mask
 * full of garbage.
 *
 * Written by hand because the repo has no image dependency and this is the only
 * thing that ever needed one: `derive-stage-boxes.mjs` is a one-off authoring
 * tool, not part of the build.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @returns {{ width: number, height: number, rgb: Uint8Array }} rgb is 3 bytes per pixel. */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');

  let width = 0;
  let height = 0;
  const idat = [];

  for (let at = 8; at < buffer.length; ) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const colorType = body[9];
      const interlace = body[12];
      if (depth !== 8 || colorType !== 2 || interlace !== 0) {
        throw new Error(`unsupported PNG: depth=${depth} colorType=${colorType} interlace=${interlace}`);
      }
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }

    at += 12 + length; // length + type + body + CRC
  }

  const raw = inflateSync(Buffer.concat(idat));
  return { width, height, rgb: defilter(raw, width, height) };
}

/**
 * Undo the per-scanline filters (PNG spec §9.2).
 *
 * Every filter reads back into the row it is writing, so this cannot be
 * vectorised or done out of order — the byte-at-a-time loop is the algorithm.
 */
function defilter(raw, width, height) {
  const bpp = 3;
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    const to = y * stride;
    const up = to - stride;

    for (let i = 0; i < stride; i += 1) {
      const x = raw[from + i];
      const a = i >= bpp ? out[to + i - bpp] : 0;
      const b = y > 0 ? out[up + i] : 0;
      const c = y > 0 && i >= bpp ? out[up + i - bpp] : 0;

      let value;
      if (filter === 0) value = x;
      else if (filter === 1) value = x + a;
      else if (filter === 2) value = x + b;
      else if (filter === 3) value = x + ((a + b) >> 1);
      else if (filter === 4) value = x + paeth(a, b, c);
      else throw new Error(`bad filter ${filter} on row ${y}`);

      out[to + i] = value & 0xff;
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
