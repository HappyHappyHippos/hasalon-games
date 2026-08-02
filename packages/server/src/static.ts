import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Minimal static file server for the built client, with an SPA fallback.
 * Vite emits content-hashed filenames under /assets, so those get a long
 * immutable cache while index.html is always revalidated.
 */
export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
): Promise<boolean> {
  const rootPath = resolve(root);
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);

  if (pathname.endsWith('/')) pathname += 'index.html';

  const candidate = resolve(join(rootPath, normalize(pathname)));
  // Reject anything that escaped the root via ../ or a symlinked path.
  if (candidate !== rootPath && !candidate.startsWith(rootPath + sep)) {
    res.writeHead(403).end('Forbidden');
    return true;
  }

  const direct = await tryFile(candidate);
  if (direct) {
    sendFile(req, res, candidate, direct.size, false);
    return true;
  }

  // Unknown path with no file extension: hand it to the SPA router.
  if (!extname(pathname)) {
    const indexPath = join(rootPath, 'index.html');
    const index = await tryFile(indexPath);
    if (index) {
      sendFile(req, res, indexPath, index.size, true);
      return true;
    }
  }

  return false;
}

async function tryFile(path: string): Promise<{ size: number } | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? { size: info.size } : null;
  } catch {
    return null;
  }
}

function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  size: number,
  isSpaFallback: boolean,
): void {
  const ext = extname(path).toLowerCase();
  const immutable = !isSpaFallback && ext !== '.html' && path.includes(`${sep}assets${sep}`);
  const cache = immutable ? 'public, max-age=31536000, immutable' : 'no-cache';
  const type = MIME_TYPES[ext] ?? 'application/octet-stream';

  const range = parseRange(req.headers.range, size);

  // 416, per RFC 9110: the client asked for bytes that do not exist.
  if (range === 'unsatisfiable') {
    res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' });
    res.end();
    return;
  }

  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': length,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cache,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(path, { start: range.start, end: range.end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    // Advertised on every response, not just ranged ones — it is how a client
    // knows it may ask.
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(path).pipe(res);
}

/**
 * A single byte range, or null for "serve the whole thing".
 *
 * Media is why this exists. Safari's audio and video stack opens every resource
 * with `Range: bytes=0-1` and refuses to play anything answered with a plain
 * `200` — so without this the music is silent on every iPhone and Mac however
 * good the file is. Chrome and Firefox tolerate the whole-file response, which
 * is exactly why it went unnoticed.
 *
 * Deliberately handles one range only. Multipart ranges need a
 * `multipart/byteranges` body, no browser asks for them here, and a wrong
 * implementation is worse than an honest whole-file `200` — which is what any
 * unparseable or multi-range header falls back to.
 */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header || size === 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  let start: number;
  let end: number;

  if (rawStart === '') {
    // `bytes=-500` — the last 500 bytes.
    if (rawEnd === '') return null;
    const suffix = Number(rawEnd);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start >= size) return 'unsatisfiable';
  // A range that overruns the end is clamped rather than rejected, which is
  // what the spec asks for and what players actually send at the tail.
  end = Math.min(end, size - 1);
  if (end < start) return 'unsatisfiable';

  return { start, end };
}
