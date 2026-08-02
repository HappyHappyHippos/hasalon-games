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
import { clock } from './clock';
import { voice } from './voice';
import { delayed, readNetSim } from './netsim';
import { sfx } from '../audio';
import { loadSession, saveSession, useStore, type Hud, type HudPlayer } from '../store';

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

  connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.closedByUs = false;
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

  /** WebRTC signalling for one peer. Unbuffered — a stale offer is worse than none. */
  sendRtc(to: string, data: unknown): void {
    this.raw({ t: 'rtc', to, data });
  }

  setVoice(on: boolean): void {
    this.send({ t: 'voice', on });
  }

  // -------------------------------------------------------------------------
  // Incoming
  // -------------------------------------------------------------------------

  private handle(message: ServerMessage): void {
    const store = useStore.getState();

    switch (message.t) {
      case 'welcome': {
        saveSession({ code: message.room.code, playerId: message.playerId, token: message.token });
        store.onWelcome(message.room, message.playerId);
        setHashCode(message.room.code);
        return;
      }

      case 'room':
        store.setRoom(message.room);
        return;

      case 'matchStarted':
        feed.reset();
        this.lastCountdown = 0;
        // `resumed` is the catch-up copy sent to a socket that reconnected into
        // a running match, and reconnects happen on a half-second backoff. Only
        // the real thing bumps the counter the intro splash watches.
        if (message.resumed) store.setRoom(message.room);
        else store.onMatchStarted(message.room);
        store.setHud({ phase: 'countdown', round: 0, countdown: 0, players: [] });
        return;

      case 'snapshot':
        feed.push(message.snap, message.st);
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

  /** Throttled copy of snapshot data that the React HUD actually needs. */
  private mirrorHud(snap: GameSnapshot): void {
    const now = performance.now();
    const isTransition = snap.events.length > 0;
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

    const players: HudPlayer[] =
      snap.game === 'achtung'
        ? snap.players.map((p) => ({
            seat: p.s,
            score: p.p,
            alive: p.l === 1,
            effects: p.fx,
          }))
        : snap.players.map((p) => ({
            seat: p.s,
            score: p.p,
            alive: p.k > 0,
            stocks: p.k,
            damage: p.d,
            weapon: p.w,
            ammo: p.am,
            bombs: p.bo,
          }));

    const hud: Hud = { phase: snap.phase, round: snap.round, countdown, players };
    useStore.getState().setHud(hud);
  }
}

export const socket = new GameSocket();

// Injected rather than imported the other way round: `voice` must not depend on
// the socket, or the two modules form a cycle and whichever loads second sees
// half of the other.
voice.send = (to, data) => socket.sendRtc(to, data);
voice.announce = (on) => socket.setVoice(on);

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
