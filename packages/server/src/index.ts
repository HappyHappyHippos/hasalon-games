import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WS_PATH } from '@mg/shared';
import { createApp } from './app';

/**
 * `--port` wins over the PORT environment variable so the dev script can pin
 * itself to 3000 regardless of whatever PORT the surrounding tooling exports.
 * Hosting platforms set PORT and pass no arguments, so they still work.
 */
function argPort(): number | null {
  const index = process.argv.indexOf('--port');
  const value = index === -1 ? null : Number(process.argv[index + 1]);
  return value !== null && Number.isInteger(value) && value > 0 ? value : null;
}

const PORT = argPort() ?? Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

const here = dirname(fileURLToPath(import.meta.url));
/** In production the bundle sits at packages/server/dist/server.js. */
const clientDist = process.env.CLIENT_DIST
  ? resolve(process.env.CLIENT_DIST)
  : resolve(here, '../../client/dist');

const app = createApp({ clientDist });

const port = await app.listen(PORT, HOST);
console.log(`[mg] listening on http://${HOST}:${port}  (websocket at ${WS_PATH})`);
console.log(`[mg] serving client from ${clientDist}`);

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[mg] shutting down');
  void app.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
