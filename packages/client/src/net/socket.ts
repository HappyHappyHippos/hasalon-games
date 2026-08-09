import {
  PROTOCOL_VERSION,
  TICK_RATE,
  WS_PATH,
  encode,
  type ClientMessage,
  type GameId,
  type GameSnapshot,
  type Identity,
  type ServerMessage,
} from '@mg/shared';
import { feed } from './feed';
// Game-specific, and the only such import here. See `inkBus` for why this
// cannot ride the throttled HUD mirror like everything else does.
import { receiveSkribbl, resetInk } from '../games/skribbl/inkBus';
import type { MemesPrivate } from '@mg/shared/memes';
import { clock } from './clock';
import { voice } from './voice';
import { delayed, readNetSim } from './netsim';
import { sfx } from '../audio';
import {
  loadSession,
  saveSession,
  useStore,
  type Hud,
  type HudPlayer,
  type MemesHud,
  type Secret,
  type SkribblHud,
} from '../store';

/**
 * Ping fast at first, then back off.
 *
 * The clock offset is only as good as the samples behind it, and until it is
 * good the whole playback timeline is wrong. Waiting a full interval per sample
 * meant the opening seconds of every match — the countdown and the first
 * exchange — ran on an estimate that had barely converged. Twelve samples in
 * the first three seconds fixes that, and costs a dozen 30-byte frames.
 */
const PING_FAST_INTERVAL_MS = 250;
const PING_FAST_COUNT = 12;
const PING_INTERVAL_MS = 1000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;
/** The HUD only needs a few updates a second; the canvas has the rest. */
const HUD_INTERVAL_MS = 120;

function socketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}${WS_PATH}`;
}
class GameSocket {
  private ws: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private pingsSent = 0;
  private lastHudAt = 0;
  /** Dev only, via `?netsim=delay,jitter`. Null in production builds. */
  private readonly netsim = readNetSim();
  private sendDelayed: ((encoded: string) => void) | null = null;
  private closedByUs = false;
  private lastCountdown = 0;
  /** Voice flags may only be re-announced after this socket is accepted into a room. */
  private membershipConfirmed = false;

  connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.closedByUs = false;
    this.membershipConfirmed = false;
    useStore.getState().setStatus('connecting');

    const ws = new WebSocket(socketUrl());
    this.ws = ws;

    // A new socket may well have a different path and a different clock offset;
    // carrying the old estimate over would place the first snapshots wrong.
    clock.reset();
    this.sendDelayed = this.netsim
      ? delayed<string>(this.netsim, (encoded) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(encoded);
        })
      : null;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      useStore.getState().setStatus('open');

      // Reclaim our seat before anything queued, so the server knows who we are.
      const session = loadSession();
      if (session) {
        this.raw({
          t: 'resume',
          v: PROTOCOL_VERSION,
          code: session.code,
          playerId: session.playerId,
          token: session.token,
        });
      }

      const queued = this.queue;
      this.queue = [];
      for (const message of queued) this.raw(message);

      this.startPinging();
    };

    const deliver = this.netsim
      ? delayed<ServerMessage>(this.netsim, (message) => this.handle(message))
      : (message: ServerMessage) => this.handle(message);

    ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      deliver(message);
    };

    ws.onclose = () => {
      this.stopPinging();
      this.ws = null;
      this.membershipConfirmed = false;
      useStore.getState().setStatus('closed');
      if (!this.closedByUs) this.scheduleReconnect();
    };

    ws.onerror = () => {
      // 'close' fires straight after; the reconnect is handled there.
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPinging(): void {
    this.stopPinging();
    this.pingsSent = 0;

    // Measure immediately rather than waiting out the first interval — the
    // renderers are already drawing by then.
    this.raw({ t: 'ping', ts: performance.now() });

    const schedule = (): void => {
      const interval =
        this.pingsSent < PING_FAST_COUNT ? PING_FAST_INTERVAL_MS : PING_INTERVAL_MS;
      this.pingTimer = window.setTimeout(() => {
        this.pingsSent += 1;
        this.raw({ t: 'ping', ts: performance.now() });
        schedule();
      }, interval);
    };
    schedule();
  }

  private stopPinging(): void {
    if (this.pingTimer !== null) {
      window.clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private raw(message: ClientMessage): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const encoded = encode(message);
    if (this.sendDelayed) this.sendDelayed(encoded);
    else this.ws.send(encoded);
  }

  /** Send now if connected, otherwise once the socket opens. */
  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.raw(message);
      return;
    }
    this.queue.push(message);
    this.connect();
  }

  // -------------------------------------------------------------------------
  // Outgoing actions
  // -------------------------------------------------------------------------

  create(identity: Identity): void {
    useStore.getState().setBusy(true);
    this.send({ t: 'create', v: PROTOCOL_VERSION, identity });
  }

  join(code: string, identity: Identity): void {
    useStore.getState().setBusy(true);
    this.send({ t: 'join', v: PROTOCOL_VERSION, code: code.trim().toUpperCase(), identity });
  }

  setIdentity(identity: Partial<Identity>): void {
    this.send({ t: 'identity', identity });
  }

  setReady(ready: boolean): void {
    this.send({ t: 'ready', ready });
  }

  setGame(gameId: GameId): void {
    this.send({ t: 'game', gameId });
  }

  setSettings(settings: unknown): void {
    this.send({ t: 'settings', settings });
  }

  start(): void {
    this.send({ t: 'start' });
  }

  rematch(): void {
    this.send({ t: 'rematch' });
  }

  setPaused(paused: boolean): void {
    this.send({ t: 'pause', paused });
  }

  restart(): void {
    this.send({ t: 'restart' });
  }

  leave(): void {
    this.send({ t: 'leave' });
    saveSession(null);
    feed.reset();
    resetInk();
    // The mesh is per-room; leaving one without tearing it down leaves a live
    // microphone open to people you are no longer in a room with.
    voice.stop();
    useStore.getState().reset();
    setHashCode(null);
  }

  /** Game-specific input payload, sent unbuffered. */
  sendInput(payload: unknown): void {
    this.raw({ t: 'input', i: payload });
  }

  /**
   * Game input that must not be dropped.
   *
   * `sendInput` goes through `raw`, which discards silently when the socket is
   * not open — correct for a movement bitmask, where the next sample supersedes
   * it 16 ms later. A typed guess or a chosen word has no next sample: losing
   * one is losing the thing the player did, so these queue until the socket
   * opens instead.
   */
  sendInputReliable(payload: unknown): void {
    this.send({ t: 'input', i: payload });
  }

  /** WebRTC signalling for one peer. Unbuffered — a stale offer is worse than none. */
  sendRtc(to: string, data: unknown): void {
    this.raw({ t: 'rtc', to, data });
  }

  setVoice(on: boolean): void {
    this.send({ t: 'voice', on });
  }

  setListening(on: boolean): void {
    this.send({ t: 'listen', on });
  }

  // -------------------------------------------------------------------------
  // Incoming
  // -------------------------------------------------------------------------

  private confirmMembership(playerId: string | null): void {
    if (this.membershipConfirmed || !playerId) return;
    this.membershipConfirmed = true;
    voice.prepare(playerId);
    voice.reannounce();
  }

  private handle(message: ServerMessage): void {
    const store = useStore.getState();

    switch (message.t) {
      case 'welcome': {
        saveSession({ code: message.room.code, playerId: message.playerId, token: message.token });
        voice.setIceAuth({ code: message.room.code, playerId: message.playerId, token: message.token });
        // Prepare synchronously before store.onWelcome schedules React work.
        // An existing listener can answer the room broadcast with an RTC offer
        // immediately; waiting for the voice hook would leave a small window in
        // which the new socket has no self id and must discard that offer.
        voice.prepare(message.playerId);
        store.onWelcome(message.room, message.playerId);
        setHashCode(message.room.code);
        this.confirmMembership(message.playerId);
        return;
      }

      case 'room':
        store.setRoom(message.room);
        this.confirmMembership(store.playerId);
        return;

      case 'matchStarted':
        feed.reset();
        resetInk();
        this.lastCountdown = 0;
        // `resumed` is the catch-up copy sent to a socket that reconnected into
        // a running match, and reconnects happen on a half-second backoff. Only
        // the real thing bumps the counter the intro splash watches.
        if (message.resumed) store.setRoom(message.room);
        else store.onMatchStarted(message.room);
        store.setHud({ phase: 'countdown', round: 0, countdown: 0, players: [] });
        this.confirmMembership(store.playerId);
        return;

      case 'snapshot':
        feed.push(message.snap, message.st);
        // Before the HUD mirror, and outside its throttle. Skribbl's ink and
        // chat are drained server-side — each appears in exactly one snapshot —
        // so anything the 120 ms throttle skips is lost for good.
        if (message.snap.game === 'skribbl') receiveSkribbl(message.snap);
        this.mirrorHud(message.snap);
        return;

      case 'matchEnded':
        store.onMatchEnded(message.room, message.winnerSeat);
        sfx.win();
        return;

      case 'pong':
        clock.observe(message.ts, message.serverTime, performance.now());
        return;

      case 'rtc':
        void voice.onSignal(message.from, message.data);
        return;

      case 'private':
        this.receivePrivate(message.data);
        return;

      case 'error': {
        if (message.code === 'RESUME_FAILED') {
          // The seat is gone — drop the stale session and show the home screen.
          saveSession(null);
          feed.reset();
          store.reset();
          setHashCode(null);
          return;
        }
        // `message.message` is the server's English; it stays in the logs where
        // it is useful. The toast renders `code` through the dictionary.
        store.setError(message.code);
        return;
      }
    }
  }

  /**
   * Route a `private` payload to the slice that understands it.
   *
   * The message is deliberately game-agnostic on the wire — the server just
   * forwards whatever `GameInstance.privateFor` returned — so the routing has to
   * happen here, and every game that has no secrets must have its slice cleared
   * rather than left holding a stale one from the game before.
   *
   * Exhaustive on purpose, for the same reason `mirrorHud` below is. This used
   * to be `if (gameId === 'memes') … else setSecret(…)`, where the `else` meant
   * "Skribbl" by assumption: a seventh game with private state would have had
   * its payload silently parsed as a Skribbl secret, with no compile error.
   * Adding one is now a build failure until it picks a slice.
   */
  private receivePrivate(data: unknown): void {
    const store = useStore.getState();
    const gameId = store.room?.gameId;

    switch (gameId) {
      case 'memes':
        store.setMemesPrivate((data as MemesPrivate | null) ?? null);
        store.setSecret(null);
        return;
      case 'skribbl':
        store.setSecret((data as Secret | null) ?? null);
        store.setMemesPrivate(null);
        return;
      case 'achtung':
      case 'gravity':
      case 'gunmayhem':
      case 'tanks':
      // No hidden state; their `privateFor` returns null and the server never
      // sends this. Falling through to the same clear as "no room" is correct.
      case undefined:
        store.setSecret(null);
        store.setMemesPrivate(null);
        return;
      default: {
        const never: never = gameId;
        throw new Error(`unhandled game for private state: ${String(never)}`);
      }
    }
  }

  /** Throttled copy of snapshot data that the React HUD actually needs. */
  private mirrorHud(snap: GameSnapshot): void {
    const now = performance.now();
    const isTransition = 'events' in snap && snap.events.length > 0;
    if (!isTransition && now - this.lastHudAt < HUD_INTERVAL_MS) return;
    this.lastHudAt = now;

    // Rides the HUD throttle rather than getting its own path. These change
    // slowly and are displayed as whole milliseconds; pushing them at the
    // snapshot rate would re-render the tree 30 times a second to show the
    // same number.
    useStore.getState().setNet({
      rtt: Math.round(feed.rttMs),
      jitter: Math.round(feed.jitterMs),
      delay: Math.round(feed.delayMs),
    });

    const countdown =
      snap.phase === 'countdown' ? Math.ceil(snap.phaseTicks / TICK_RATE) : 0;

    // One beep per second of the countdown, and a higher one on "go".
    if (countdown !== this.lastCountdown) {
      if (countdown > 0) sfx.countdown(false);
      else if (this.lastCountdown === 1) sfx.countdown(true);
      this.lastCountdown = countdown;
    }

    // A switch rather than a ternary, and deliberately so: with two games the
    // `else` branch was Gun Mayhem by assumption, and adding a third would have
    // silently read its snapshot as Gun Mayhem's — undefined fields everywhere
    // and no compile error. Exhaustive narrowing makes the next game a build
    // failure instead of a mystery.
    let players: HudPlayer[];
    let skribbl: SkribblHud | undefined;
    let memes: MemesHud | undefined;
    switch (snap.game) {
      case 'achtung':
        players = snap.players.map((p) => ({
          seat: p.s,
          score: p.p,
          alive: p.l === 1,
          effects: p.fx,
        }));
        break;
      case 'tanks':
        players = snap.players.map((p) => ({
          seat: p.s,
          score: p.p,
          alive: p.al === 1,
        }));
        break;
      case 'gravity':
        players = snap.players.map((p) => ({
          seat: p.s,
          score: p.p,
          alive: p.al === 1,
        }));
        break;
      case 'gunmayhem':
        players = snap.players.map((p) => ({
          seat: p.s,
          score: p.p,
          alive: p.k > 0,
          stocks: p.k,
          damage: p.d,
          weapon: p.w,
          ammo: p.am,
          bombs: p.bo,
        }));
        break;
      case 'skribbl':
        players = snap.players.map((p) => ({
          seat: p.s,
          score: p.p,
          alive: true,
          guessed: p.g === 1,
          roundScore: p.rp,
        }));
        skribbl = {
          masked: snap.masked,
          drawerSeat: snap.drawerSeat,
          lang: snap.lang,
          phaseTicks: snap.phaseTicks,
          rounds: snap.rounds,
        };
        break;
      case 'memes':
        players = snap.players.map((p) => ({
          seat: p.s,
          score: p.p,
          alive: true,
          roundScore: p.rp,
          submitted: p.sub === 1,
          voted: p.v === 1,
        }));
        memes = {
          phaseTicks: snap.phaseTicks,
          phaseTotal: snap.phaseTotal,
          phaseSeq: snap.phaseSeq,
          rounds: snap.rounds,
          entryIndex: snap.entryIndex,
          entryCount: snap.entryCount,
          stage: snap.stage,
        };
        break;
    }

    const hud: Hud = { phase: snap.phase, round: snap.round, countdown, players, skribbl, memes };
    useStore.getState().setHud(hud);
  }
}

export const socket = new GameSocket();

// Injected rather than imported the other way round: `voice` must not depend on
// the socket, or the two modules form a cycle and whichever loads second sees
// half of the other.
voice.send = (to, data) => socket.sendRtc(to, data);
voice.announce = (on) => socket.setVoice(on);
voice.announceListening = (on) => socket.setListening(on);

// ---------------------------------------------------------------------------
// Shareable #/room/CODE links
// ---------------------------------------------------------------------------

export function readHashCode(): string | null {
  const match = /^#\/room\/([A-Za-z0-9]{4})$/.exec(location.hash);
  return match ? match[1]!.toUpperCase() : null;
}

export function setHashCode(code: string | null): void {
  const next = code ? `#/room/${code}` : '';
  if (location.hash === next) return;
  history.replaceState(null, '', next || location.pathname + location.search);
}
