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

/**
 * The most recent room view each socket has been sent.
 *
 * Kept because `next` is an **edge** trigger — it attaches its listener when it
 * is called, so it can only ever see what arrives afterwards. Plenty of what
 * this script wants to assert is a **state**: "everyone is ready" is a fact
 * about the room, not an event, and it is frequently already true by the time
 * we get round to checking.
 *
 * That distinction is what broke this script. The host starts ready by design,
 * so the room reaches all-ready the moment the *guest* readies. The host then
 * sends its own `ready: true`, which changes nothing — and the server
 * deliberately does not broadcast a room on a no-op ready (`Room.setReady`,
 * added so a bot re-readying on every broadcast could not rate-limit itself).
 * So the script sat waiting for a message that correctly never came, about a
 * condition that had been satisfied for several seconds.
 */
const lastRoom = new WeakMap();

/** A room view in one line, so a timeout says what the room actually looked like. */
function describeRoom(room) {
  if (!room) return 'no room seen yet';
  const players = room.players
    .map((p) => `${p.name}[${p.ready ? 'ready' : 'not-ready'},seat ${p.seat}]`)
    .join(' ');
  return `phase=${room.phase} game=${room.gameId} players: ${players}`;
}

/** Resolve on the first message matching `pred`, or reject with a useful name. */
function next(ws, pred, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // The last room state is almost always the thing you need to see to know
      // why a wait failed, and reconstructing it from a bare label means
      // re-running with a debugger attached.
      reject(
        new Error(`timed out waiting for ${label}\n    last room: ${describeRoom(lastRoom.get(ws))}`),
      );
    }, TIMEOUT_MS);
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

/**
 * Resolve once the socket's room satisfies `pred` — **now or later**.
 *
 * The state-shaped counterpart to `next`. Use this for anything phrased as "the
 * room is in this condition"; use `next` only when the *arrival* of the message
 * is the thing under test, such as proving a broadcast travelled from one
 * client to another.
 */
function untilRoom(ws, pred, label) {
  const current = lastRoom.get(ws);
  if (current && pred(current)) return Promise.resolve({ t: 'room', room: current });
  return next(ws, (m) => m.room !== undefined && pred(m.room), label);
}

function connect(label) {
  const ws = new WebSocket(wsUrl);
  ws.on('error', (err) => {
    console.error(`[${label}] socket error: ${err.message}`);
    process.exitCode = 1;
  });
  // Recorded from the socket's first byte, before anything awaits it, so no
  // room view can slip past between one `await` and the next.
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.room !== undefined) lastRoom.set(ws, msg.room);
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

// Guest -> server -> host proves the reverse direction too. Deliberately `next`
// rather than `untilRoom`: the *arrival* of this broadcast is the thing under
// test, and a state check would pass without proving anything travelled.
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

// Keep the wire probe deterministic. Gun Mayhem defaults to a random stage,
// but the combat checks below require both seats to start on one clear firing
// lane. Green Hills has a full-width floor that both bots can drop onto.
host.send(JSON.stringify({ t: 'settings', settings: { levelId: 'green', powerupsEnabled: false } }));
await next(
  host,
  (m) => m.t === 'room' && m.room.settings.levelId === 'green',
  'deterministic smoke settings',
);

// The host is already ready by design, so this often changes nothing and
// correctly produces no broadcast. Ask about the state, not an event.
host.send(JSON.stringify({ t: 'ready', ready: true }));
await untilRoom(host, (r) => r.players.every((p) => p.ready), 'both ready');
host.send(JSON.stringify({ t: 'start' }));
const started = await next(host, (m) => m.t === 'matchStarted', 'match started');
const guestSeat = started.room.players.find((p) => p.name === 'SmokeGuest')?.seat ?? -1;
if (guestSeat < 0) throw new Error('guest was not seated');
console.log(`  ✓ match started, guest in seat ${guestSeat}`);

const ARENA_MIDDLE = 640;
const IN_LEFT = 1;
const IN_RIGHT = 2;
const IN_DOWN = 8;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** One seat's record from the next snapshot to arrive. Defaults to the guest. */
async function seatState(ws, seat = guestSeat) {
  const { snap } = await next(ws, (m) => m.t === 'snapshot', 'snapshot');
  const me = snap.players.find((p) => p.s === seat);
  if (!me) throw new Error(`no snapshot record for seat ${seat}`);
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
async function comeToRest(ws, seq, seat = guestSeat) {
  ws.send(JSON.stringify({ t: 'input', i: { seq, bits: 0 } }));
  await wait(400);
  return seatState(ws, seat);
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

// Put both bots on the same full-width floor before measuring movement and
// combat. Otherwise a valid random/elevated spawn can put a platform between
// the pistol and its target, making the live deployment look broken.
host.send(JSON.stringify({ t: 'input', i: { seq: 1, bits: IN_DOWN } }));
guest.send(JSON.stringify({ t: 'input', i: { seq: 1, bits: IN_DOWN } }));
await wait(1200);
host.send(JSON.stringify({ t: 'input', i: { seq: 2, bits: 0 } }));
guest.send(JSON.stringify({ t: 'input', i: { seq: 2, bits: 0 } }));
await wait(200);

const movedBefore = await run(guest, 3);
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
 * shoved them around, but their own controls did nothing until they died. That
 * was hitstun, a timer that took the controls away for a few ticks after a hit
 * and, set to a fractional number of ticks, sometimes never gave them back.
 *
 * Hitstun no longer exists: a hit costs momentum and nothing else. So this is
 * now a check that the *stronger* property holds against a real deployment —
 * being shot never affects your controls at all — and it costs one exchange.
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
console.log(`  ✓ guest took a hit (${struck.d} damage)`);

// Let the knockback bleed off, so what we measure next is input and not the
// shove. `comeToRest` sends a zero mask and waits out friction.
const shoved = await comeToRest(reloaded, 1500);
assertOnStage(shoved, 'after being shot');

const movedAfterHit = await run(reloaded, 1501);
if (!(movedAfterHit > 5)) {
  throw new Error(
    `guest is stuck after being shot (moved ${movedAfterHit.toFixed(1)}px) — ` +
      'being hit is not supposed to affect the controls at all',
  );
}
console.log(`  ✓ guest still moves after being shot (${movedAfterHit.toFixed(0)}px)`);

// Bullet tunnelling — a fast round stepping clean over a body between two ticks
// — is deliberately *not* probed here. It only shows up on the sniper, at
// 2700 units/sec, and there is no wire message that hands a player a specific
// weapon: crates drop one at random every 7–12 seconds, which is neither quick
// nor repeatable. A probe firing the pistol would pass either way and prove
// nothing. `sim.test.ts:bullet collision` covers it against the real simulation.

// ---------------------------------------------------------------------------
// Recoil
// ---------------------------------------------------------------------------

/**
 * Firing has to move the shooter.
 *
 * Recoil was in the code for a long time and nobody could feel it: a ground
 * multiplier scaled it down, and ground friction — six times air friction —
 * finished it off inside a tick. A pistol shot moved you under a pixel. The kick
 * is one impulse now, the same standing as airborne, and this is the check that
 * it survives contact with a real server rather than only a unit test.
 */
const settled = await comeToRest(host, 1600, hostSeat);
const restingX = settled.x;
// Trigger only: no direction held, so anything that moves them is the kick.
host.send(JSON.stringify({ t: 'input', i: { seq: 1601, bits: IN_SHOOT } }));
await wait(1000);
host.send(JSON.stringify({ t: 'input', i: { seq: 1700, bits: 0 } }));

const kicked = await seatState(host, hostSeat);
const pushed = Math.abs(kicked.x - restingX);
// Recoil pushes opposite to facing, and nothing else was pressed.
if (!(pushed > 5)) {
  throw new Error(`a second of pistol fire moved the shooter ${pushed.toFixed(1)}px — recoil is not landing`);
}
console.log(`  ✓ recoil moved the shooter ${pushed.toFixed(0)}px in a second of pistol fire`);

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

// ---------------------------------------------------------------------------
// Voice signalling
// ---------------------------------------------------------------------------

/**
 * The relay, not the audio.
 *
 * Voice chat is peer-to-peer: no media passes through the server, so there is
 * nothing here that a deploy could break except the post box. That part *is*
 * worth checking against a real host, because it is a new message type going
 * through the same proxy that has broken WebSockets before, and because the
 * failure is silent — everyone's microphone appears to work and nobody can hear
 * anyone.
 *
 * Whether two particular players can actually reach each other is a NAT
 * question this cannot answer. The mesh is STUN-only, so a player behind
 * carrier-grade NAT — the norm on Israeli mobile — may still fail; the client
 * reports that per-peer on screen.
 */
host.send(JSON.stringify({ t: 'rtc', to: welcomeGuest.playerId, data: { kind: 'probe' } }));
const relayed = await next(reloaded, (m) => m.t === 'rtc', 'rtc relayed to the guest');
if (relayed.from !== welcome.playerId) {
  throw new Error(`rtc arrived stamped from ${relayed.from}, expected the host`);
}
console.log('  ✓ webrtc signalling relayed between the two clients');

reloaded.send(JSON.stringify({ t: 'voice', on: true }));
await next(
  host,
  (m) => m.t === 'room' && m.room.players.some((p) => p.id === welcomeGuest.playerId && p.voice),
  'host sees the guest unmute',
);
console.log('  ✓ mic state broadcast to the room');

host.send(JSON.stringify({ t: 'leave' }));
reloaded.send(JSON.stringify({ t: 'leave' }));
host.close();
reloaded.close();

// ---------------------------------------------------------------------------
// Meme caption geometry over the real wire
// ---------------------------------------------------------------------------

const memeHost = await connect('meme-host');
memeHost.send(JSON.stringify({ t: 'create', v: PROTOCOL_VERSION, identity: identity('MemeHost', 4) }));
const memeWelcome = await next(memeHost, (m) => m.t === 'welcome', 'meme host welcome');
const memeCode = memeWelcome.room.code;
const memeGuest = await connect('meme-guest');
memeGuest.send(JSON.stringify({ t: 'join', v: PROTOCOL_VERSION, code: memeCode, identity: identity('MemeGuest', 5) }));
await Promise.all([
  next(memeGuest, (m) => m.t === 'welcome', 'meme guest welcome'),
  next(memeHost, (m) => m.t === 'room' && m.room.players.length === 2, 'meme host sees guest'),
]);

memeHost.send(JSON.stringify({ t: 'game', gameId: 'memes' }));
await next(memeHost, (m) => m.t === 'room' && m.room.gameId === 'memes', 'Meme Machine selected');
memeHost.send(JSON.stringify({ t: 'ready', ready: true }));
memeGuest.send(JSON.stringify({ t: 'ready', ready: true }));
await untilRoom(memeHost, (r) => r.players.every((player) => player.ready), 'meme players ready');

const memeHostPrivate = next(memeHost, (m) => m.t === 'private' && !!m.data?.templateId, 'meme host private template');
const memeStarted = next(memeHost, (m) => m.t === 'matchStarted', 'meme match started');
memeHost.send(JSON.stringify({ t: 'start' }));
await Promise.all([memeStarted, memeHostPrivate]);
await next(
  memeHost,
  (m) => m.t === 'snapshot' && m.snap.game === 'memes' && m.snap.phase === 'writing',
  'meme writing phase',
);

const resized = { x: 0.11, y: 0.13, w: 0.31, h: 0.22 };
memeHost.send(JSON.stringify({
  t: 'input',
  i: { k: 'draft', texts: ['resize-smoke'], p: [resized] },
}));
const drafted = await next(
  memeHost,
  (m) => m.t === 'private' && m.data?.draft?.[0] === 'resize-smoke',
  'resized meme draft echo',
);
if (drafted.data.positions?.[0]?.w !== resized.w || drafted.data.positions?.[0]?.h !== resized.h) {
  throw new Error('resized meme geometry did not survive the server draft path');
}

// Reconnection must restore the private geometry before composing continues.
memeHost.close();
const memeReloaded = await connect('meme-host-reloaded');
const memeResumeWelcome = next(memeReloaded, (m) => m.t === 'welcome', 'meme resume welcome');
const restoredPrivate = next(
  memeReloaded,
  (m) => m.t === 'private' && m.data?.draft?.[0] === 'resize-smoke',
  'meme restored private geometry',
);
memeReloaded.send(JSON.stringify({
  t: 'resume',
  v: PROTOCOL_VERSION,
  code: memeCode,
  playerId: memeWelcome.playerId,
  token: memeWelcome.token,
}));
const [, restored] = await Promise.all([memeResumeWelcome, restoredPrivate]);
if (restored.data.positions?.[0]?.w !== resized.w || restored.data.positions?.[0]?.h !== resized.h) {
  throw new Error('resized meme geometry was lost across reconnect');
}

const hostSubmitted = next(
  memeReloaded,
  (m) => m.t === 'private' && m.data?.submitted === true,
  'meme host submission',
);
memeReloaded.send(JSON.stringify({
  t: 'input',
  i: { k: 'submit', texts: ['resize-smoke'], p: [resized] },
}));
await hostSubmitted;
const revealedStage = next(
  memeReloaded,
  (m) => m.t === 'snapshot' && m.snap.game === 'memes' && m.snap.phase === 'reveal' && !!m.snap.stage,
  'resized meme reveal',
);
memeGuest.send(JSON.stringify({
  t: 'input',
  i: { k: 'submit', texts: ['guest-smoke'], p: [resized] },
}));
const revealed = await revealedStage;
if (revealed.snap.stage.positions?.[0]?.w !== resized.w || revealed.snap.stage.positions?.[0]?.h !== resized.h) {
  throw new Error(`resized meme geometry did not reach the shared stage: ${JSON.stringify(revealed.snap.stage)}`);
}
console.log('  ✓ resized Meme caption survived draft, reconnect, and reveal');

memeReloaded.send(JSON.stringify({ t: 'leave' }));
memeGuest.send(JSON.stringify({ t: 'leave' }));
memeReloaded.close();
memeGuest.close();

// ---------------------------------------------------------------------------
// Worms: a whole turn, and terrain that actually changes
// ---------------------------------------------------------------------------

/**
 * The one thing about Worms that cannot be checked anywhere but over the wire.
 *
 * Its terrain destruction does not travel in the snapshot — craters ride the
 * `private` channel, because they are far too big to re-send thirty times a
 * second and a delta is useless to anyone who joins late. So "does a shot
 * actually change the map on the *other* client" is a question about the wire,
 * not about the simulation, and no unit test can answer it.
 */
const wormHost = await connect('worm-host');
wormHost.send(JSON.stringify({ t: 'create', v: PROTOCOL_VERSION, identity: identity('WormHost', 6) }));
const wormWelcome = await next(wormHost, (m) => m.t === 'welcome', 'worm host welcome');
const wormCode = wormWelcome.room.code;
const wormGuest = await connect('worm-guest');
wormGuest.send(JSON.stringify({ t: 'join', v: PROTOCOL_VERSION, code: wormCode, identity: identity('WormGuest', 7) }));
await Promise.all([
  next(wormGuest, (m) => m.t === 'welcome', 'worm guest welcome'),
  next(wormHost, (m) => m.t === 'room' && m.room.players.length === 2, 'worm host sees guest'),
]);

wormHost.send(JSON.stringify({ t: 'game', gameId: 'worms' }));
await next(wormHost, (m) => m.t === 'room' && m.room.gameId === 'worms', 'Worms selected');
// A fixed stage and no wind, so this is the same shot every run.
wormHost.send(JSON.stringify({ t: 'settings', settings: { stageId: 'small_green', windEnabled: false, turnSeconds: 20 } }));
await next(wormHost, (m) => m.t === 'room' && m.room.settings.stageId === 'small_green', 'Worms stage pinned');
wormHost.send(JSON.stringify({ t: 'ready', ready: true }));
wormGuest.send(JSON.stringify({ t: 'ready', ready: true }));
await untilRoom(wormHost, (r) => r.players.every((player) => player.ready), 'worm players ready');

const wormStarted = next(wormHost, (m) => m.t === 'matchStarted', 'worm match started');
wormHost.send(JSON.stringify({ t: 'start' }));
const wormMatch = await wormStarted;
const wormHostSeat = wormMatch.room.players.find((p) => p.id === wormWelcome.playerId)?.seat;
if (wormHostSeat === undefined || wormHostSeat < 0) throw new Error('worm host was not seated');

// Two worms each at this room size — the thing that makes a two-player match a
// game rather than a duel.
const firstTurn = await next(
  wormHost,
  (m) => m.t === 'snapshot' && m.snap.game === 'worms' && m.snap.phase === 'turn' && m.snap.ac > 0,
  'first Worms turn',
);
if (firstTurn.snap.worms.length !== 4) {
  throw new Error(`expected four worms for two players, got ${firstTurn.snap.worms.length}`);
}
console.log(`  ✓ Worms dealt ${firstTurn.snap.worms.length} worms across 2 seats`);

// Whoever is up, hold fire until the shot goes. Power charges off the held
// button server-side, so this is the whole of "take a turn".
const IN_FIRE_WORMS = 32;
const activeSeat = firstTurn.snap.worms.find((w) => w.i === firstTurn.snap.ac)?.s;
const shooter = activeSeat === wormHostSeat ? wormHost : wormGuest;
const watcher = activeSeat === wormHostSeat ? wormGuest : wormHost;

const boomSeen = next(
  watcher,
  (m) => m.t === 'snapshot' && m.snap.game === 'worms' && m.snap.events.some((e) => e.t === 'boom'),
  'explosion on the other client',
);
const craterSeen = next(
  watcher,
  (m) => m.t === 'private' && Array.isArray(m.data?.c) && m.data.c.length > 0,
  'crater on the other client',
);

let wormSeq = 1;
const holdFire = setInterval(() => {
  shooter.send(JSON.stringify({ t: 'input', i: { seq: wormSeq++, bits: IN_FIRE_WORMS } }));
}, 16);
let craters;
try {
  await boomSeen;
  craters = await craterSeen;
} finally {
  clearInterval(holdFire);
}

const [cx, cy, cr] = craters.data.c[0];
if (!Number.isInteger(cx) || !Number.isInteger(cy) || !(cr > 0)) {
  throw new Error(`crater is not a sane integer tuple: ${JSON.stringify(craters.data.c[0])}`);
}
console.log(`  ✓ a Worms shot carved a ${cr}-unit crater at ${cx},${cy} and the other client was told`);

// A client arriving mid-match has to get the whole map, not just what happens
// next. This is the failure the `private` channel was chosen to avoid.
const wormLate = await connect('worm-late');
wormLate.send(JSON.stringify({
  t: 'join',
  v: PROTOCOL_VERSION,
  code: wormCode,
  identity: identity('WormLate', 2),
}));
await next(wormLate, (m) => m.t === 'welcome', 'late Worms joiner welcome');
const lateTerrain = await next(
  wormLate,
  (m) => m.t === 'private' && Array.isArray(m.data?.c),
  'late joiner is told the terrain',
);
if (lateTerrain.data.c.length < craters.data.c.length) {
  throw new Error(
    `a client joining mid-match got ${lateTerrain.data.c.length} craters, expected at least ${craters.data.c.length}`,
  );
}
console.log(`  ✓ a client joining mid-match was sent all ${lateTerrain.data.c.length} craters`);

wormHost.send(JSON.stringify({ t: 'leave' }));
wormGuest.send(JSON.stringify({ t: 'leave' }));
wormLate.send(JSON.stringify({ t: 'leave' }));
wormHost.close();
wormGuest.close();
wormLate.close();


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
