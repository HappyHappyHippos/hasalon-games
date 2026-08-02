import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveStatic } from './static';

/**
 * Byte-range serving, which exists for one reason: **Safari will not play media
 * without it.** Its audio and video stack opens every resource with
 * `Range: bytes=0-1` and refuses anything answered with a plain `200`.
 *
 * That is invisible in development — Vite serves `public/` and handles ranges
 * itself — and invisible in Chrome and Firefox, which happily take the whole
 * file. It only shows up as "the music doesn't work on my iPhone" against a
 * production deploy, which is a long way from the code that causes it. Hence
 * these tests.
 */

const BODY = Buffer.from('0123456789abcdef', 'utf8'); // 16 bytes, positions == values

let root: string;
let server: Server;
let base: string;

beforeAll(async () => {
  const box = await mkdtemp(join(tmpdir(), 'mg-static-'));
  // The bait sits one level above what is served, so a traversal that works
  // would find something real rather than a 404 that proves nothing.
  await writeFile(join(box, 'secret.txt'), 'SECRET');
  root = join(box, 'public');
  await mkdir(root);
  await writeFile(join(root, 'tune.mp3'), BODY);
  await writeFile(join(root, 'index.html'), '<!doctype html><title>x</title>');

  server = createServer((req, res) => {
    void serveStatic(req, res, root).then((handled) => {
      if (!handled) res.writeHead(404).end('nope');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(join(root, '..'), { recursive: true, force: true });
});

function get(path: string, range?: string): Promise<Response> {
  return fetch(base + path, range ? { headers: { Range: range } } : undefined);
}

describe('serveStatic', () => {
  it('advertises range support on an ordinary response', async () => {
    const res = await get('/tune.mp3');
    expect(res.status).toBe(200);
    // Without this header a client never asks for a range in the first place.
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BODY);
  });

  it("answers Safari's opening probe with a 206", async () => {
    // `bytes=0-1` verbatim: this is the request that decides whether an iPhone
    // will play the file at all.
    const res = await get('/tune.mp3', 'bytes=0-1');
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-1/${BODY.length}`);
    expect(res.headers.get('content-length')).toBe('2');
    expect(await res.text()).toBe('01');
  });

  it('serves an open-ended range to the end of the file', async () => {
    const res = await get('/tune.mp3', 'bytes=10-');
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 10-15/${BODY.length}`);
    expect(await res.text()).toBe('abcdef');
  });

  it('serves a suffix range', async () => {
    const res = await get('/tune.mp3', 'bytes=-4');
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 12-15/${BODY.length}`);
    expect(await res.text()).toBe('cdef');
  });

  it('clamps a range that overruns the end rather than rejecting it', async () => {
    // Players routinely ask past the tail. The spec says clamp, and rejecting
    // instead reads to the client as a broken file.
    const res = await get('/tune.mp3', 'bytes=12-9999');
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 12-15/${BODY.length}`);
    expect(await res.text()).toBe('cdef');
  });

  it('rejects a range that starts past the end', async () => {
    const res = await get('/tune.mp3', 'bytes=99-200');
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${BODY.length}`);
  });

  it('falls back to the whole file for anything it cannot parse', async () => {
    // Multipart ranges included: no browser asks for them here, and a wrong
    // implementation is worse than an honest 200.
    for (const header of ['bytes=0-1,4-5', 'items=0-1', 'bytes=abc', 'nonsense']) {
      const res = await get('/tune.mp3', header);
      expect(res.status, header).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(BODY);
    }
  });

  it('answers HEAD without a body, for both plain and ranged requests', async () => {
    const plain = await fetch(base + '/tune.mp3', { method: 'HEAD' });
    expect(plain.status).toBe(200);
    expect(plain.headers.get('content-length')).toBe(String(BODY.length));

    const ranged = await fetch(base + '/tune.mp3', {
      method: 'HEAD',
      headers: { Range: 'bytes=0-1' },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-length')).toBe('2');
  });

  it('never serves a file outside the root', async () => {
    // A real file, one level above the served directory. Percent-encoded
    // because `fetch` resolves a literal `../` away before the request is sent,
    // so only the encoded form reaches `decodeURIComponent` inside the handler.
    //
    // Asserting on the body rather than the status: `normalize` collapses the
    // traversal before the explicit 403 guard sees it, so this legitimately
    // comes back 404 — what matters is that the contents never appear.
    const res = await fetch(`${base}/%2e%2e%2fsecret.txt`);
    expect(res.status).not.toBe(200);
    expect(await res.text()).not.toContain('SECRET');
  });
});
