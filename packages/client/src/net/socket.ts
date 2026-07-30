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
import { sfx } from '../audio';
import { loadSession, saveSession, useStore, type Hud, type HudPlayer } from '../store';

const PING_INTERVAL_MS = 2000;
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
  private lastHudAt = 0;
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

    ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handle(message);
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
    this.pingTimer = window.setInterval(() => {
      this.raw({ t: 'ping', ts: performance.now() });
    }, PING_INTERVAL_MS);
  }

  private stopPinging(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private raw(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(message));
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
    useStore.getState().reset();
    setHashCode(null);
  }

  /** Game-specific input payload, sent unbuffered. */
  sendInput(payload: unknown): void {
    this.raw({ t: 'input', i: payload });
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
        store.setRoom(message.room);
        store.setHud({ phase: 'countdown', round: 0, countdown: 0, players: [] });
        return;

      case 'snapshot':
        feed.push(message.snap);
        this.mirrorHud(message.snap);
        return;

      case 'matchEnded':
        store.onMatchEnded(message.room, message.winnerSeat);
        sfx.win();
        return;

      case 'pong':
        feed.observeRtt(performance.now() - message.ts);
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
        store.setError(message.message);
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
