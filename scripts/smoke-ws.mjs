/**
 * End-to-end smoke test for a running deployment.
 *
 * A green Docker build says nothing about whether WebSockets survive the host's
 * proxy — that is the part that actually breaks. This opens two real clients,
 * has one create a room and the other join it, and checks the broadcast reaches
 * both. Run it after any deploy that touches hosting, the proxy, or the wire
 * protocol.
 *
 *   npm run smoke                          # against production
 *   npm run smoke -- http://localhost:3000 # against a local `npm start`
 *
 * Deliberately not part of `npm test`: it needs a live server, and vitest runs
 * offline.
 */
import WebSocket from 'ws';
import { PROTOCOL_VERSION, WS_PATH } from '../packages/shared/src/protocol.ts';

const DEFAULT_HOST = 'https://hasalon-games-production.up.railway.app';
const TIMEOUT_MS = 15_000;

const target = process.argv[2] ?? DEFAULT_HOST;
const wsUrl = target.replace(/^http/, 'ws').replace(/\/$/, '') + WS_PATH;

/** Resolve on the first message matching `pred`, or reject with a useful name. */
function next(ws, pred, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), TIMEOUT_MS);
    const onMsg = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.t === 'error') {
        clearTimeout(timer);
        reject(new Error(`server error while waiting for ${label}: ${msg.code} ${msg.message}`));
        return;
      }
      if (!pred(msg)) return;
      clearTimeout(timer);
      ws.off('message', onMsg);
      resolve(msg);
    };
    ws.on('message', onMsg);
  });
}

function connect(label) {
  const ws = new WebSocket(wsUrl);
  ws.on('error', (err) => {
    console.error(`[${label}] socket error: ${err.message}`);
    process.exitCode = 1;
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[${label}] connect timed out`)), TIMEOUT_MS);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
  });
}

const identity = (name, colorIndex) => ({ name, colorIndex, hat: 0, face: 0 });

console.log(`smoke: ${wsUrl}\n`);

const host = await connect('host');
console.log('  ✓ host connected');
host.send(JSON.stringify({ t: 'create', v: PROTOCOL_VERSION, identity: identity('SmokeHost', 0) }));
const welcome = await next(host, (m) => m.t === 'welcome', 'host welcome');
const { code } = welcome.room;
console.log(`  ✓ room created: ${code}`);

const guest = await connect('guest');
guest.send(JSON.stringify({ t: 'join', v: PROTOCOL_VERSION, code, identity: identity('SmokeGuest', 2) }));

// The join must reach the guest *and* be broadcast to the host — one-way would
// still look like a pass if we only checked the guest.
const [, roomView] = await Promise.all([
  next(guest, (m) => m.t === 'welcome', 'guest welcome'),
  next(host, (m) => m.t === 'room' && m.room.players.length === 2, 'host sees both players'),
]);
console.log(`  ✓ both players in room: ${roomView.room.players.map((p) => p.name).join(', ')}`);

// Guest -> server -> host proves the reverse direction too.
guest.send(JSON.stringify({ t: 'ready', ready: true }));
await next(
  host,
  (m) => m.t === 'room' && m.room.players.some((p) => p.name === 'SmokeGuest' && p.ready),
  'host sees guest ready',
);
console.log('  ✓ guest ready broadcast reached host');

const sentAt = Date.now();
host.send(JSON.stringify({ t: 'ping', ts: sentAt }));
await next(host, (m) => m.t === 'pong', 'pong');
const rtt = Date.now() - sentAt;
console.log(`  ✓ round-trip ${rtt}ms`);

host.send(JSON.stringify({ t: 'leave' }));
guest.send(JSON.stringify({ t: 'leave' }));
host.close();
guest.close();

console.log(`\nPASS — two clients shared a room over ${wsUrl.startsWith('wss') ? 'wss' : 'ws'}.`);
if (rtt > 150) {
  console.log(`NOTE: ${rtt}ms is high for a 60 Hz fighter. Check the deploy region.`);
}
