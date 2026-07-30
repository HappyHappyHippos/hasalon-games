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

const SETTINGS_KEY = 'mg.music';

export type MusicTrack = 'lobby' | GameId;

/**
 * Two of these are Ogg because the machine they were fetched on had no ffmpeg.
 * Both extensions are served by the production static handler.
 */
const TRACKS: Record<MusicTrack, string> = {
  lobby: '/music/lobby.ogg',
  gunmayhem: '/music/gunmayhem.mp3',
  achtung: '/music/achtung.ogg',
};

/** Long enough to feel deliberate, short enough not to overlap two melodies. */
const FADE_MS = 700;
const FADE_STEP_MS = 50;
/** How far the music drops while a menu is open, as a fraction of volume. */
const DUCK_SCALE = 0.25;

interface MusicSettings {
  muted: boolean;
  volume: number;
}

class Music {
  private settings: MusicSettings = loadSettings();
  /** Two elements so a track change can crossfade instead of cutting. */
  private players: (HTMLAudioElement | null)[] = [null, null];
  private active = 0;
  private current: MusicTrack | null = null;
  private ducked = false;
  private fadeTimer: number | null = null;
  /** Tracks whose file failed to load. Never retried — they aren't coming back. */
  private broken = new Set<MusicTrack>();
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
    } else if (this.current) {
      // Unmuting mid-session should pick the music back up where we are now.
      const track = this.current;
      this.current = null;
      this.play(track);
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
    if (this.current === track) return;
    this.current = track;
    if (this.settings.muted || this.broken.has(track)) return;

    const next = (this.active + 1) % 2;
    const previous = this.players[this.active];

    const player = new Audio(TRACKS[track]);
    player.loop = true;
    player.preload = 'auto';
    player.volume = 0;
    player.onerror = () => {
      // No file, or a codec this browser won't take. Give up on it quietly.
      this.broken.add(track);
      if (this.players[next] === player) this.players[next] = null;
    };

    this.players[next] = player;
    this.active = next;

    this.start(player);
    this.crossfade(player, previous);
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
   */
  private start(player: HTMLAudioElement): void {
    const attempt = player.play();
    if (!attempt) return;
    attempt.catch(() => {
      if (this.gestureHooked) return;
      this.gestureHooked = true;

      const retry = (): void => {
        window.removeEventListener('pointerdown', retry);
        window.removeEventListener('keydown', retry);
        this.gestureHooked = false;
        const active = this.players[this.active];
        if (active && !this.settings.muted) void active.play().catch(() => undefined);
      };

      window.addEventListener('pointerdown', retry, { once: true });
      window.addEventListener('keydown', retry, { once: true });
    });
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
  const fallback: MusicSettings = { muted: false, volume: 0.4 };
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
