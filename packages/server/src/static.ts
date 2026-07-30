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

  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(path).pipe(res);
}
