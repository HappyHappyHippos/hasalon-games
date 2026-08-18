import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WS_PATH } from '@mg/shared';
import { createApp } from './app';
import { analytics, analyticsOptionsFromEnv } from './Analytics';
import { analyticsTimeZone } from './summary';

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

// Before the first socket can open, so no visit is dropped on the floor while
// the log is still deciding where it lives.
const analyticsOptions = analyticsOptionsFromEnv();
analytics.configure(analyticsOptions);

const app = createApp({ clientDist });

const port = await app.listen(PORT, HOST);
console.log(`[mg] listening on http://${HOST}:${port}  (websocket at ${WS_PATH})`);
console.log(`[mg] serving client from ${clientDist}`);
console.log(
  `[mg] usage log → ${analyticsOptions.file ?? 'stdout only'} (${analyticsOptions.retentionDays}d, ${analyticsTimeZone()})`,
);
// Said out loud because the failure is silent otherwise: the dashboard simply
// 404s in production and looks like a routing bug rather than a missing secret.
if (!process.env.ADMIN_TOKEN?.trim()) {
  console.log(
    process.env.NODE_ENV === 'production'
      ? '[mg] /admin is disabled — set ADMIN_TOKEN to enable the usage dashboard'
      : '[mg] /admin is open (development); set ADMIN_TOKEN before deploying',
  );
}

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[mg] shutting down');
  // After `close`, not before: tearing down the rooms is what writes their
  // `room_close` rows, and stopping the recorder first would drop the last
  // evening of every restart.
  void app
    .close()
    .then(() => analytics.dispose())
    .then(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
