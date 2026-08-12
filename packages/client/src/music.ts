/**
 * Background music.
 *
 * The opposite trade-off from `audio.ts`: sound effects are synthesised because
 * they must fire the instant a bullet lands, but a two-minute loop is a file.
 * Tracks live in `public/music` (see the ATTRIBUTION there) and are fetched
 * lazily — nothing is requested until a room actually needs that track.
 *
 * Everything here fails soft. A missing file, a codec the browser dislikes, an
 * autoplay block: all of them end with silence, never an exception. Music is
 * the one part of the app that must never be able to break a match.
 */

import type { GameId } from '@mg/shared';
import { sfx } from './audio';

const SETTINGS_KEY = 'mg.music';
/** Quiet enough to sit under a roomful of conversation on first launch. */
export const DEFAULT_MUSIC_VOLUME = 0.16;

export type MusicTrack = 'lobby' | GameId;

/**
 * ── ASSET SWAP POINT ────────────────────────────────────────────────────────
 * The intro sting, played once under the logo splash at the start of a match.
 *
 * Nothing here yet: drop a file at this path in `packages/client/public/music/`
 * and it plays instead of the synthesised placeholder, no code change. Keep it
 * under `INTRO_MS` (see `ui/Intro.tsx`) so it does not outlive the animation.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const INTRO_STING_URL = '/music/intro.mp3';

/**
 * All mp3, and that is not a detail.
 *
 * Two of these used to be Ogg Vorbis, which **Safari has never supported** — not
 * "old Safari", any of it, desktop and iOS alike. On every iPhone in the family
 * the element fired `error` on load, the track went into `broken` below, and
 * since `lobby` is what plays on every screen outside a match, the site was
 * silent from first paint. It looked like a code bug and was a codec choice.
 *
 * mp3 is the one format every target decodes. Anything dropped in here later
 * should be mp3 too unless someone adds real format negotiation.
 */
const TRACKS: Record<MusicTrack, string> = {
  lobby: '/music/lobby.mp3',
  gunmayhem: '/music/gunmayhem.mp3',
  achtung: '/music/achtung.mp3',
  memes: '/music/memes.mp3',
  tanks: '/music/tanks.mp3',
  gravity: '/music/gravity.mp3',
  // Skribbl deliberately shares the quiet lo-fi lobby bed. `play` notices the
  // URL is unchanged and lets it continue rather than restarting on match start.
  skribbl: '/music/lobby.mp3',
  worms: '/music/worms.mp3',
  telephone: '/music/lobby.mp3',
};

/** Long enough to feel deliberate, short enough not to overlap two melodies. */
const FADE_MS = 700;
const FADE_STEP_MS = 50;
/** How far the music drops while a menu is open, as a fraction of volume. */
const DUCK_SCALE = 0.25;

/**
 * Events that can satisfy an autoplay policy.
 *
 * `click` and `touchend` are the load-bearing ones: iOS Safari does not treat
 * `pointerdown` as a media user-activation, so a retry hooked only to that
 * never fires on the devices most likely to need it.
 */
const GESTURE_EVENTS = ['pointerdown', 'click', 'touchend', 'keydown'] as const;

interface MusicSettings {
  muted: boolean;
  volume: number;
}

class Music {
  private settings: MusicSettings = loadSettings();
  /** Two elements so a track change can crossfade instead of cutting. */
  private players: (HTMLAudioElement | null)[] = [null, null];
  private active = 0;
  /** What is actually playing. */
  private current: MusicTrack | null = null;
  /** What *should* be playing, whether or not we managed it. */
  private wanted: MusicTrack | null = null;
  private ducked = false;
  private fadeTimer: number | null = null;
  /**
   * Tracks that have failed to load more than once.
   *
   * Deliberately not on the first failure. This used to retire a track for the
   * whole session the moment one `error` fired, which turned any transient
   * hiccup — a dropped request on a phone changing cell, a reload mid-fetch —
   * into permanent silence with no way back. Two strikes, because a genuinely
   * missing or undecodable file fails every single time and a flaky network
   * does not.
   */
  private broken = new Set<MusicTrack>();
  private failures = new Map<MusicTrack, number>();
  /** Set while we're waiting on a gesture to satisfy the autoplay policy. */
  private gestureHooked = false;

  get isMuted(): boolean {
    return this.settings.muted;
  }

  get volume(): number {
    return this.settings.volume;
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    saveSettings(this.settings);
    if (muted) {
      this.stopAll();
      this.current = null;
    } else if (this.wanted) {
      // Unmuting mid-session picks the music back up for wherever we are *now*,
      // which is not necessarily the screen the mute happened on.
      this.current = null;
      this.play(this.wanted);
    }
  }

  setVolume(volume: number): void {
    this.settings.volume = Math.min(1, Math.max(0, volume));
    saveSettings(this.settings);
    const player = this.players[this.active];
    if (player) player.volume = this.targetVolume();
  }

  /** Drop to a murmur while a menu or a pause overlay is up. */
  duck(ducked: boolean): void {
    if (this.ducked === ducked) return;
    this.ducked = ducked;
    const player = this.players[this.active];
    if (player) player.volume = this.targetVolume();
  }

  play(track: MusicTrack): void {
    // What the app *wants* playing, recorded even when we cannot honour it —
    // muted, or the file is broken. Unmuting three screens later has to pick up
    // the track for the screen you are on now, not the one you muted on.
    this.wanted = track;

    if (this.current === track) return;
    // Two track ids can name the same file — Skribbl and the lobby share one.
    // Swapping between them should not restart the music.
    if (this.current && TRACKS[this.current] === TRACKS[track]) {
      this.current = track;
      this.wanted = track;
      return;
    }
    // `current` is only claimed once we are actually going to try. It used to be
    // set above this guard, so a muted or broken track still became "current"
    // and the bed then stayed silent until some *other* track was requested.
    if (this.settings.muted || this.broken.has(track)) return;
    this.current = track;

    const next = (this.active + 1) % 2;
    const previous = this.players[this.active];

    const player = new Audio(TRACKS[track]);
    player.loop = true;
    player.preload = 'auto';
    player.volume = 0;
    player.onerror = () => {
      // No file, a codec this browser won't take, or a request that died on the
      // way. Only the first two are permanent, and we cannot tell them apart
      // from here — so count strikes rather than condemning on the first.
      const strikes = (this.failures.get(track) ?? 0) + 1;
      this.failures.set(track, strikes);
      if (strikes >= 2) this.broken.add(track);
      if (this.players[next] === player) this.players[next] = null;
      if (this.current === track) this.current = null;
    };

    this.players[next] = player;
    this.active = next;

    this.start(player);
    this.crossfade(player, previous);
  }

  /**
   * The one-shot under the intro splash.
   *
   * Tries the real file and falls back to the synthesised fanfare if it is not
   * there — which is the normal case until an asset is dropped in, so the
   * fallback is the feature rather than the error path. `canplaythrough` is what
   * decides: a missing file fires `error` instead, and neither fires twice.
   *
   * Follows the SFX mute rather than the music mute. It is a flourish attached
   * to an animation, not part of the bed, and someone who turned the music off
   * to hear their family talk still expects the game to make noises.
   */
  sting(): void {
    if (sfx.isMuted) return;

    const player = new Audio(INTRO_STING_URL);
    player.volume = Math.max(0.25, this.settings.volume);
    let settled = false;

    const fallback = (): void => {
      if (settled) return;
      settled = true;
      release(player);
      sfx.fanfare();
    };

    player.oncanplaythrough = () => {
      if (settled) return;
      settled = true;
      // A rejected play() here means no gesture yet. The splash only ever
      // follows a button press, so this is close to unreachable — but silence
      // beats an unhandled rejection either way.
      void player.play().catch(fallback);
    };
    player.onerror = fallback;

    // Belt and braces: if neither event fires (a proxy holding the request
    // open, say), the placeholder still plays rather than nothing at all.
    window.setTimeout(fallback, 600);
  }

  stopAll(): void {
    this.clearFade();
    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i];
      if (!player) continue;
      release(player);
      this.players[i] = null;
    }
  }

  private targetVolume(): number {
    if (this.settings.muted) return 0;
    return this.settings.volume * (this.ducked ? DUCK_SCALE : 1);
  }

  /**
   * Browsers refuse to start audio before a gesture. Unlike a sound effect —
   * which is always *caused* by a click — music starts on a phase change, so a
   * rejection here is routine on first load. Wait for the next interaction.
   *
   * Two things this gets right that the previous version did not, and between
   * them they were most of why the music never played:
   *
   * - **It re-arms.** The old retry removed its listeners, tried once more, and
   *   swallowed the rejection. One failed attempt and that was the session.
   * - **It listens for `click` and `touchend`, not just `pointerdown`.** iOS
   *   Safari does not grant media activation on `pointerdown` — it grants it on
   *   `touchend`/`click`. So on an iPhone the single retry was being spent on
   *   the one event guaranteed not to satisfy the policy.
   */
  private start(player: HTMLAudioElement): void {
    const attempt = () => {
      const promise = player.play();
      if (!promise) return;
      promise.catch(() => {
        // A track that has since been swapped out should not keep queueing
        // retries; the newer one has its own.
        if (this.players[this.active] !== player) return;
        if (this.gestureHooked) return;
        this.gestureHooked = true;

        const retry = (): void => {
          for (const event of GESTURE_EVENTS) window.removeEventListener(event, retry);
          this.gestureHooked = false;
          const active = this.players[this.active];
          if (active && !this.settings.muted) this.start(active);
        };

        for (const event of GESTURE_EVENTS) {
          window.addEventListener(event, retry, { once: true });
        }
      });
    };
    attempt();
  }

  private crossfade(incoming: HTMLAudioElement, outgoing: HTMLAudioElement | null): void {
    this.clearFade();

    const target = this.targetVolume();
    const from = outgoing?.volume ?? 0;
    const steps = Math.max(1, Math.round(FADE_MS / FADE_STEP_MS));
    let step = 0;

    this.fadeTimer = window.setInterval(() => {
      step += 1;
      const t = Math.min(1, step / steps);
      incoming.volume = target * t;
      if (outgoing) outgoing.volume = from * (1 - t);

      if (t < 1) return;

      this.clearFade();
      if (outgoing) {
        release(outgoing);
        const index = this.players.indexOf(outgoing);
        if (index !== -1) this.players[index] = null;
      }
    }, FADE_STEP_MS);
  }

  private clearFade(): void {
    if (this.fadeTimer !== null) {
      window.clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }
}

/**
 * Tear an element down for good.
 *
 * Detaching `onerror` first is the whole point: clearing `src` is itself an
 * error condition as far as the element is concerned, so a naive teardown
 * fires the handler and marks a perfectly good track permanently broken. The
 * symptom is music that never comes back after the first mute or track change.
 */
function release(player: HTMLAudioElement): void {
  player.onerror = null;
  player.pause();
  player.removeAttribute('src');
  player.load();
}

function loadSettings(): MusicSettings {
  const fallback: MusicSettings = { muted: false, volume: DEFAULT_MUSIC_VOLUME };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<MusicSettings>;
    return {
      muted: parsed.muted === true,
      volume:
        typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1
          ? parsed.volume
          : fallback.volume,
    };
  } catch {
    return fallback;
  }
}

function saveSettings(settings: MusicSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable; the setting just won't persist.
  }
}

export const music = new Music();
