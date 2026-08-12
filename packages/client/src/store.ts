import { create } from 'zustand';
import { isFaceIndex, isHatIndex } from '@mg/shared';
import type { ErrorCode, Identity, RoomView } from '@mg/shared';
import type { MemesPrivate, MemesStageEntry } from '@mg/shared/memes';
import type { TelephonePrivate, TelephoneSnapshot } from '@mg/shared/telephone';
import { isLang, type Lang } from './i18n';
import { DEFAULT_MUSIC_VOLUME } from './music';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed';

export interface Session {
  code: string;
  playerId: string;
  token: string;
}

/**
 * The slice of live game state the React HUD needs, mirrored out of the
 * snapshot feed at a few frames a second. Deliberately game-agnostic: Achtung
 * fills in `effects`, Gun Mayhem fills in `stocks`/`damage`/`weapon`, and the
 * HUD components read whichever they care about.
 */
export interface HudPlayer {
  seat: number;
  score: number;
  alive: boolean;
  effects?: string[];
  stocks?: number;
  damage?: number;
  weapon?: string;
  ammo?: number;
  bombs?: number;
  /** Skribbl: got the word this round. */
  guessed?: boolean;
  /** Skribbl: points earned this round, for the reveal screen. */
  roundScore?: number;
  /** Meme Machine: finished writing this round. */
  submitted?: boolean;
  /** Meme Machine: cast a ballot on the staged entry. */
  voted?: boolean;
  /** Worms: total health across this seat's living worms. */
  health?: number;
  /** Worms: how many of this seat's worms are still alive. */
  wormsLeft?: number;
}

/**
 * Skribbl's slice of the HUD.
 *
 * Here rather than read off `SnapshotFeed` in the component, because the feed is
 * polled from a `requestAnimationFrame` loop and rAF is suspended outright in a
 * backgrounded tab. The canvas can afford that — there is nobody looking at it —
 * but the word, the clock and the phase cannot: coming back to a tab would show
 * a frozen header until the next frame. The socket keeps mirroring this whether
 * or not anything is being painted.
 */
export interface SkribblHud {
  /** Blanks and revealed letters. Never the whole word, except during reveal. */
  masked: string;
  drawerSeat: number;
  /** The word list's language, which need not match the interface's. */
  lang: 'he' | 'en';
  /** Ticks left in the current phase. */
  phaseTicks: number;
  rounds: number;
}

/**
 * Worms' slice of the HUD.
 *
 * The turn clock, the wind and the current weapon are all React, for the same
 * reason Skribbl's word is: they are read, not watched, and `requestAnimationFrame`
 * stops dead in a backgrounded tab. Coming back to find a frozen turn timer
 * would be indistinguishable from the game having hung.
 */
export interface WormsHud {
  /** Seat whose turn it is, or -1 between turns. */
  activeSeat: number;
  /** Ticks left on the turn or retreat clock. */
  turnTicks: number;
  /** -1000..1000. Sign is the direction it blows. */
  wind: number;
  weapon: string;
  /** Seconds on the grenade fuse. */
  fuse: number;
  /** Shots left, for the weapons that are limited. */
  ammo: Record<string, number>;
  /** Charge on the shot being held, 0..1000. */
  power: number;
  /**
   * Where the map reticle is, or -1 when nothing is marked.
   *
   * The HUD needs this and not just the renderer: a weapon that needs a target
   * refuses to fire until one is placed, and without the flag the fire button
   * looks live and silently does nothing.
   */
  targetX: number;
  targetY: number;
}

/** Meme Machine is entirely React-rendered, so its latest whole stage view lives here. */
export interface MemesHud {
  phaseTicks: number;
  phaseTotal: number;
  phaseSeq: number;
  rounds: number;
  entryIndex: number;
  entryCount: number;
  stage: MemesStageEntry | null;
}
export type TelephoneHud = TelephoneSnapshot;

export interface Hud {
  phase: string;
  round: number;
  /** Seconds left on the countdown, or 0. */
  countdown: number;
  players: HudPlayer[];
  skribbl?: SkribblHud;
  worms?: WormsHud;
  memes?: MemesHud;
  telephone?: TelephoneHud;
}

/**
 * One line of Skribbl's chat.
 *
 * A separate slice rather than part of `Hud`, because the two are different
 * shapes of thing: `Hud` is a *mirror* of the newest snapshot, replaced whole
 * every 120 ms, while chat is append-only history. Putting it in the mirror
 * would mean re-sending the entire log in every snapshot and losing any line
 * that landed between two mirrors.
 */
export interface ChatLine {
  id: number;
  kind: 'guess' | 'correct' | 'close' | 'system';
  seat: number;
  text: string;
}

/** The private half of the world, for whoever is drawing. */
export interface Secret {
  word: string;
  choices: string[];
}

/**
 * Connection quality, for the readout in the corner.
 *
 * Worth showing because "the game is laggy" and "my connection is bad" look
 * identical from the sofa, and only one of them is worth reporting. `delay` is
 * how far behind the present other players are being drawn — the number that
 * actually decides how the match feels, and the one that grows when `jitter`
 * does.
 */
export interface NetStats {
  rtt: number;
  jitter: number;
  delay: number;
}

export const emptyHud: Hud = { phase: 'countdown', round: 0, countdown: 0, players: [] };

/**
 * On-screen controls. `auto` asks the device; the other two are the escape
 * hatch for when it answers wrongly — see `useTouchControls`.
 */
export type TouchControlsMode = 'auto' | 'on' | 'off';

export interface AppState {
  status: ConnectionStatus;
  room: RoomView | null;
  playerId: string | null;
  identity: Identity;
  /**
   * The *code*, not the server's message. The server speaks English into its
   * logs and the client looks the wording up per language, so a toast that is
   * already on screen when someone switches language switches with it.
   */
  error: ErrorCode | null;
  pendingCode: string;
  busy: boolean;
  hud: Hud;
  net: NetStats;
  matchWinnerSeat: number | null;
  /** Sound effects. Music is muted separately — most people want one, not both. */
  muted: boolean;
  musicMuted: boolean;
  musicVolume: number;
  touchControls: TouchControlsMode;
  lang: Lang;
  optionsOpen: boolean;
  /**
   * Bumped once per `matchStarted`, which is the cue for the intro splash.
   *
   * Deliberately *not* derived from `room.phase` going to `playing`. Refreshing
   * mid-match resumes straight into a running match, and a three-second curtain
   * while everyone else is already playing is the opposite of helpful. The
   * server only sends `matchStarted` when a match actually starts, so a counter
   * on that message is the one signal that means "from the top".
   */
  matchNonce: number;
  /** Skribbl's chat log. Append-only; see `ChatLine`. */
  chat: ChatLine[];
  /**
   * Whatever the server has told this client alone.
   *
   * Skribbl's word, when we are the one drawing. Arrives on the `private`
   * message rather than in a snapshot, because a snapshot is encoded once and
   * sent to the whole room — see `Room.sendPrivate`.
   */
  secret: Secret | null;
  /** Meme Machine's per-socket template, draft, and ballot state. */
  memesPrivate: MemesPrivate | null;
  telephonePrivate: TelephonePrivate | null;

  setStatus(status: ConnectionStatus): void;
  setRoom(room: RoomView | null): void;
  setIdentity(patch: Partial<Identity>): void;
  setError(error: ErrorCode | null): void;
  setPendingCode(code: string): void;
  setBusy(busy: boolean): void;
  setHud(hud: Hud): void;
  /**
   * Append chat lines, ignoring any already seen.
   *
   * The dedupe is load-bearing, not defensive: `mirrorHud` runs on every
   * snapshot including the catch-up replay a reconnecting player is sent, so
   * without it the whole visible history appends a second time.
   */
  pushChat(lines: ChatLine[]): void;
  setSecret(secret: Secret | null): void;
  setMemesPrivate(value: MemesPrivate | null): void;
  setTelephonePrivate(value: TelephonePrivate | null): void;
  setNet(net: NetStats): void;
  setMuted(muted: boolean): void;
  setMusicMuted(muted: boolean): void;
  setMusicVolume(volume: number): void;
  setTouchControls(mode: TouchControlsMode): void;
  setLang(lang: Lang): void;
  setOptionsOpen(open: boolean): void;
  onMatchStarted(room: RoomView): void;
  onWelcome(room: RoomView, playerId: string): void;
  onMatchEnded(room: RoomView, winnerSeat: number | null): void;
  reset(): void;
}

/** Name and colour are yours everywhere, so they live in localStorage. */
const IDENTITY_KEY = 'mg.identity';

/**
 * So does the controls override: it is a property of the device you are on, and
 * someone who had to turn it on once should never have to find it again.
 */
const TOUCH_KEY = 'mg.touchControls';

/**
 * Language is the same kind of thing: a property of the person, not the room.
 *
 * The default is Hebrew rather than whatever the browser reports. An invite
 * link opened on a phone set to en-US should still look like the site the host
 * is describing down the phone — and one tap in the options changes it for good.
 */
const LANG_KEY = 'mg.lang';

/**
 * The seat, however, belongs to *this tab*.
 *
 * sessionStorage survives a reload (so refreshing mid-match puts you straight
 * back in your seat) but is not shared between tabs — with localStorage, a
 * second tab would resume the first tab's seat, kick it off, and the two would
 * take turns stealing it back forever.
 */
const SESSION_KEY = 'mg.session';

function loadIdentity(): Identity {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>;
      // Anything missing defaults rather than resetting the whole identity —
      // this runs against values saved before hats and faces existed.
      return {
        name: typeof parsed.name === 'string' ? parsed.name : '',
        colorIndex: Number.isInteger(parsed.colorIndex) ? Number(parsed.colorIndex) : 0,
        hat: isHatIndex(parsed.hat) ? parsed.hat : 0,
        face: isFaceIndex(parsed.face) ? parsed.face : 0,
      };
    }
  } catch {
    // Corrupt or unavailable storage — fall through to the default.
  }
  return { name: '', colorIndex: 0, hat: 0, face: 0 };
}

function loadTouchControls(): TouchControlsMode {
  try {
    const raw = localStorage.getItem(TOUCH_KEY);
    if (raw === 'on' || raw === 'off' || raw === 'auto') return raw;
  } catch {
    // Storage disabled — detection alone decides.
  }
  return 'auto';
}

function loadLang(): Lang {
  try {
    const raw = localStorage.getItem(LANG_KEY);
    if (isLang(raw)) return raw;
  } catch {
    // Storage disabled — Hebrew it is, every visit.
  }
  return 'he';
}

export function saveSession(session: Session | null): void {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Private mode / storage disabled: reconnecting just won't survive reloads.
  }
}

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (
      typeof parsed.code === 'string' &&
      typeof parsed.playerId === 'string' &&
      typeof parsed.token === 'string'
    ) {
      return { code: parsed.code, playerId: parsed.playerId, token: parsed.token };
    }
  } catch {
    // Ignore.
  }
  return null;
}

export const useStore = create<AppState>((set) => ({
  status: 'idle',
  room: null,
  playerId: null,
  identity: loadIdentity(),
  error: null,
  pendingCode: '',
  busy: false,
  hud: emptyHud,
  chat: [],
  secret: null,
  memesPrivate: null,
  telephonePrivate: null,
  net: { rtt: 0, jitter: 0, delay: 0 },
  matchWinnerSeat: null,
  muted: false,
  musicMuted: false,
  musicVolume: DEFAULT_MUSIC_VOLUME,
  touchControls: loadTouchControls(),
  lang: loadLang(),
  optionsOpen: false,
  matchNonce: 0,

  setStatus: (status) => set({ status }),
  setRoom: (room) => set({ room }),

  setIdentity: (patch) =>
    set((state) => {
      const identity = { ...state.identity, ...patch };
      try {
        localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
      } catch {
        // Not fatal — the name just won't be remembered next visit.
      }
      return { identity };
    }),

  setError: (error) => set({ error, busy: false }),
  setPendingCode: (pendingCode) => set({ pendingCode }),
  setBusy: (busy) => set({ busy }),
  setHud: (hud) => set({ hud }),
  setSecret: (secret) => set({ secret }),
  setMemesPrivate: (memesPrivate) => set({ memesPrivate }),
  setTelephonePrivate: (telephonePrivate) => set({ telephonePrivate }),

  pushChat: (lines) =>
    set((state) => {
      if (lines.length === 0) return {};
      const seen = new Set(state.chat.map((line) => line.id));
      const fresh = lines.filter((line) => !seen.has(line.id));
      if (fresh.length === 0) return {};
      // Bounded: the panel scrolls, and an evening of guessing would otherwise
      // grow this without limit.
      return { chat: [...state.chat, ...fresh].slice(-200) };
    }),
  setNet: (net) => set({ net }),
  setMuted: (muted) => set({ muted }),
  setMusicMuted: (musicMuted) => set({ musicMuted }),
  setMusicVolume: (musicVolume) => set({ musicVolume }),

  setTouchControls: (touchControls) => {
    try {
      localStorage.setItem(TOUCH_KEY, touchControls);
    } catch {
      // Not fatal — it just won't be remembered next visit.
    }
    set({ touchControls });
  },

  setLang: (lang) => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // Not fatal — it just won't be remembered next visit.
    }
    set({ lang });
  },

  setOptionsOpen: (optionsOpen) => set({ optionsOpen }),

  onMatchStarted: (room) =>
    set((state) => ({
      room,
      chat: [],
      secret: null,
      memesPrivate: null,
      telephonePrivate: null,
      matchNonce: state.matchNonce + 1,
    })),

  onWelcome: (room, playerId) =>
    set({ room, playerId, error: null, busy: false, matchWinnerSeat: null }),

  onMatchEnded: (room, winnerSeat) => set({ room, matchWinnerSeat: winnerSeat }),

  reset: () =>
    set({
      room: null,
      playerId: null,
      hud: emptyHud,
      chat: [],
      secret: null,
      memesPrivate: null,
      telephonePrivate: null,
      matchWinnerSeat: null,
      busy: false,
    }),
}));

// Handy when poking at lobby/connection state from the browser console.
if (import.meta.env.DEV) {
  (window as unknown as { mgStore: typeof useStore }).mgStore = useStore;
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** Seat of the local player in the running match, or -1 while spectating. */
export function selectMySeat(state: AppState): number {
  if (!state.room || !state.playerId) return -1;
  return state.room.players.find((p) => p.id === state.playerId)?.seat ?? -1;
}

