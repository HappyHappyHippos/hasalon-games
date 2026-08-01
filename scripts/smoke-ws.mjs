/**
 * End-to-end smoke test for a running deployment.
 *
 * A green Docker build says nothing about whether WebSockets survive the host's
 * proxy — that is the part that actually breaks. This opens two real clients,
 * has one create a room and the other join it, and checks the broadcast reaches
 * both. Run it after any deploy that touches hosting, the proxy, or the wire
 * protocol.
 *
 * It then plays a round and reloads one of them mid-match. That is a regression
 * test with a name: a reloading client starts its input sequence over, and the
 * server used to read that as a stream of stale packets and ignore the player
 * for the rest of the match — they could see everyone moving, and could not
 * move themselves.
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
const [welcomeGuest, roomView] = await Promise.all([
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

/**
 * Latency, measured properly.
 *
 * A single sample tells you almost nothing — it is one draw from a distribution
 * whose *shape* is what actually decides how the game feels. Jitter is what
 * forces the client's buffer deeper, and the deeper that buffer the further
 * behind everyone else you are watching. A link with 60 ms median and 40 ms of
 * jitter plays worse than a steady 100 ms one.
 */
const PING_SAMPLES = 40;
const rtts = [];
for (let i = 0; i < PING_SAMPLES; i++) {
  const sentAt = performance.now();
  host.send(JSON.stringify({ t: 'ping', ts: sentAt }));
  await next(host, (m) => m.t === 'pong', 'pong');
  rtts.push(performance.now() - sentAt);
  await new Promise((r) => setTimeout(r, 50));
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};

const rtt = percentile(rtts, 0.5);
const rttMin = Math.min(...rtts);
const rttP95 = percentile(rtts, 0.95);
// Mean absolute deviation from the median: the same quantity the client's
// clock tracks and sizes its jitter buffer from.
const jitter = rtts.reduce((sum, v) => sum + Math.abs(v - rtt), 0) / rtts.length;

console.log(
  `  ✓ round-trip min ${rttMin.toFixed(0)}ms / median ${rtt.toFixed(0)}ms / ` +
    `p95 ${rttP95.toFixed(0)}ms, jitter ${jitter.toFixed(1)}ms`,
);

// ---------------------------------------------------------------------------
// A match, and the reload that used to end it
// ---------------------------------------------------------------------------

host.send(JSON.stringify({ t: 'ready', ready: true }));
await next(host, (m) => m.t === 'room' && m.room.players.every((p) => p.ready), 'both ready');
host.send(JSON.stringify({ t: 'start' }));
const started = await next(host, (m) => m.t === 'matchStarted', 'match started');
const guestSeat = started.room.players.find((p) => p.name === 'SmokeGuest')?.seat ?? -1;
if (guestSeat < 0) throw new Error('guest was not seated');
console.log(`  ✓ match started, guest in seat ${guestSeat}`);

const ARENA_MIDDLE = 640;
const IN_LEFT = 1;
const IN_RIGHT = 2;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The guest's own record from the next snapshot to arrive. */
async function seatState(ws) {
  const { snap } = await next(ws, (m) => m.t === 'snapshot', 'snapshot');
  const me = snap.players.find((p) => p.s === guestSeat);
  if (!me) throw new Error(`guest is not in snapshot for seat ${guestSeat}`);
  return me;
}

/** Falling off the stage would stop them moving for reasons of its own. */
function assertOnStage(me, when) {
  if (me.rt > 0) throw new Error(`guest is respawning ${when} — the run went off the stage`);
  if (me.k <= 0) throw new Error(`guest is out of stocks ${when}`);
}

/**
 * Let go and wait for friction, so the next measurement is of new input rather
 * than of momentum left over from the last one. Without this the check passes
 * even when every input is being discarded — the character is simply coasting.
 */
async function comeToRest(ws, seq) {
  ws.send(JSON.stringify({ t: 'input', i: { seq, bits: 0 } }));
  await wait(400);
  return seatState(ws);
}

/**
 * Hold a direction and report how far the seat actually travelled. Always runs
 * towards the middle of the arena: a short run off the edge kills you, and a
 * character parked against a wall cannot move at all — both would read as the
 * bug this is here to detect.
 */
async function run(ws, seqFrom) {
  const before = await seatState(ws);
  assertOnStage(before, 'before the run');
  const bits = before.x > ARENA_MIDDLE ? IN_LEFT : IN_RIGHT;

  for (let i = 0; i < 12; i++) {
    ws.send(JSON.stringify({ t: 'input', i: { seq: seqFrom + i, bits } }));
    await wait(20);
  }

  const after = await seatState(ws);
  assertOnStage(after, 'after the run');
  return Math.abs(after.x - before.x);
}

// Wait out the countdown — nobody can act during it, so moving before it ends
// proves nothing.
await next(
  guest,
  (m) => m.t === 'snapshot' && m.snap.phase === 'playing',
  'countdown to finish',
);

const movedBefore = await run(guest, 1);
if (!(movedBefore > 5)) throw new Error(`guest did not move before reload (${movedBefore})`);
console.log(`  ✓ guest moved ${movedBefore.toFixed(0)}px under their own input`);

// Stand still, at a sequence number well above anything the new page will send.
const rested = await comeToRest(guest, 500);
assertOnStage(rested, 'at rest');

// Now the actual regression: a reload. The tab keeps its session and resumes
// the same seat, but the page is new, so its input sequence starts over. That
// used to look exactly like a stale packet — every input silently discarded,
// the player frozen in place while everyone else moved normally.
guest.close();
const reloaded = await connect('guest-reloaded');
reloaded.send(
  JSON.stringify({
    t: 'resume',
    v: PROTOCOL_VERSION,
    code,
    playerId: welcomeGuest.playerId,
    token: welcomeGuest.token,
  }),
);
await next(reloaded, (m) => m.t === 'welcome', 'resume welcome');
console.log(`  ✓ guest resumed their seat after a reload (at rest, x=${rested.x.toFixed(0)})`);

// Sequence numbers 1..12, far below the 500 the old page reached.
const movedAfter = await run(reloaded, 1);
if (!(movedAfter > 5)) {
  throw new Error(
    `guest is frozen after reloading (moved ${movedAfter.toFixed(1)}px) — ` +
      'the server is still discarding their input as stale',
  );
}
console.log(`  ✓ guest still moves after reloading (${movedAfter.toFixed(0)}px)`);

// ---------------------------------------------------------------------------
// The hit that used to cost you the rest of your life
// ---------------------------------------------------------------------------

/**
 * Get shot, then try to walk.
 *
 * Two players reported getting stuck in place after being hit — bullets still
 * shoved them around, but their own controls did nothing until they died. The
 * cause was a hitstun timer set to a fractional number of ticks, counted down
 * with `if (t > 0) t -= 1` so it stopped on a small negative, and compared with
 * `=== 0` to decide whether you had your controls back. It never matched again.
 *
 * Every part of that is server-side and covered by unit tests now. This is here
 * because it is the *behaviour* the players described, and checking it against
 * a real deployment costs one extra exchange.
 */
const hostSeat = started.room.players.find((p) => p.name === 'SmokeHost')?.seat ?? -1;
if (hostSeat < 0) throw new Error('host was not seated');

const IN_SHOOT = 16;

/** Both seats out of the same snapshot, so their positions are comparable. */
async function bothSeats(ws) {
  const { snap } = await next(ws, (m) => m.t === 'snapshot', 'snapshot');
  const shooter = snap.players.find((p) => p.s === hostSeat);
  const target = snap.players.find((p) => p.s === guestSeat);
  if (!shooter || !target) throw new Error('a seat is missing from the snapshot');
  return { shooter, target };
}

// Spawn invulnerability lasts 1.8s of play and nothing lands until it is gone.
for (let i = 0; i < 200; i++) {
  const { target } = await bothSeats(host);
  if (target.iv <= 0) break;
}

const opening = await bothSeats(host);
// Face the guest and hold the trigger. `heldBits` persists server-side until it
// is changed, so one message is a held button.
const toward = opening.target.x > opening.shooter.x ? IN_RIGHT : IN_LEFT;
host.send(JSON.stringify({ t: 'input', i: { seq: 1000, bits: toward | IN_SHOOT } }));

let struck = null;
for (let i = 0; i < 400 && !struck; i++) {
  const { target } = await bothSeats(host);
  if (target.d > 0) struck = target;
}
host.send(JSON.stringify({ t: 'input', i: { seq: 1400, bits: 0 } }));

if (!struck) {
  throw new Error('the host never managed to hit the guest — the probe proved nothing');
}
console.log(`  ✓ guest took a hit (${struck.d} damage, hitstun ${struck.st})`);

// Let the knockback bleed off, so what we measure next is input and not the
// shove. `comeToRest` sends a zero mask and waits out friction.
const shoved = await comeToRest(reloaded, 1500);
assertOnStage(shoved, 'after being shot');
if (shoved.st < 0) {
  throw new Error(`hitstun settled at ${shoved.st} — negative, so the controls never come back`);
}

const movedAfterHit = await run(reloaded, 1501);
if (!(movedAfterHit > 5)) {
  throw new Error(
    `guest is stuck after being shot (moved ${movedAfterHit.toFixed(1)}px) — ` +
      'hitstun never handed the controls back',
  );
}
console.log(`  ✓ guest still moves after being shot (${movedAfterHit.toFixed(0)}px)`);

// ---------------------------------------------------------------------------
// Snapshot cadence
// ---------------------------------------------------------------------------

/**
 * How evenly the server is actually sending.
 *
 * Snapshots are the clock the whole client renders against, so unevenness here
 * is unevenness on everyone's screen and no amount of client-side smoothing
 * recovers it. Two numbers, and they mean different things:
 *
 * - `authored` compares the `st` stamps the server puts on the frames. This is
 *   the tick loop's own pacing, with the network removed. It should be flat.
 * - `arrival` compares when they actually landed here, so it also carries
 *   whatever the network and the Railway proxy did in between.
 */
const SPACING_SAMPLES = 60;
const authoredAt = [];
const arrivedAt = [];
while (arrivedAt.length < SPACING_SAMPLES) {
  const message = await next(host, (m) => m.t === 'snapshot', 'snapshot');
  authoredAt.push(message.st);
  arrivedAt.push(performance.now());
}

const gaps = (stamps) => stamps.slice(1).map((v, i) => v - stamps[i]);
const spread = (values) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
};

const authored = spread(gaps(authoredAt));
const arrival = spread(gaps(arrivedAt));

console.log(
  `  ✓ snapshot cadence: authored ${authored.mean.toFixed(1)}±${authored.sd.toFixed(1)}ms, ` +
    `arrived ${arrival.mean.toFixed(1)}±${arrival.sd.toFixed(1)}ms (target 33.3ms)`,
);

host.send(JSON.stringify({ t: 'leave' }));
reloaded.send(JSON.stringify({ t: 'leave' }));
host.close();
reloaded.close();

console.log(`\nPASS — two clients shared a room over ${wsUrl.startsWith('wss') ? 'wss' : 'ws'}.`);
if (rtt > 150) {
  console.log(`NOTE: median ${rtt.toFixed(0)}ms is high for a 60 Hz fighter. Check the deploy region.`);
}
if (jitter > 25) {
  console.log(
    `NOTE: ${jitter.toFixed(0)}ms of jitter forces a deep client buffer, which costs everyone ` +
      'latency on each other. Worth more attention than the median.',
  );
}
if (authored.sd > 4) {
  console.log(
    `NOTE: the server's own send spacing varies by ${authored.sd.toFixed(1)}ms. That is the tick ` +
      'loop, not the network — it should be near zero.',
  );
}
