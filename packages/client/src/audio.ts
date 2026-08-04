/**
 * Sound, synthesised on the fly.
 *
 * No audio files: everything here is a handful of oscillators and a noise
 * buffer, which keeps the bundle small and means there is nothing to load
 * before the first shot is fired. It matters more than it sounds like it
 * should — Gun Mayhem is a different game with and without a hit sound.
 */

const MUTE_KEY = 'mg.muted';

type Wave = OscillatorType;

interface ToneOptions {
  freq: number;
  /** Sweep to this frequency over the note; omitted means a flat pitch. */
  to?: number;
  duration: number;
  gain?: number;
  type?: Wave;
  delay?: number;
}

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = loadMuted();

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Storage unavailable; the setting just won't persist.
    }
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  /**
   * Browsers refuse to start audio before a gesture, so the context is built
   * on first use and nudged awake each time.
   */
  private ready(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone({ freq, to, duration, gain = 0.2, type = 'square', delay = 0 }: ToneOptions): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;

    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);

    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(env).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private burst(duration: number, gain: number, cutoffFrom: number, cutoffTo: number): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;

    if (!this.noise) {
      const frames = Math.floor(ctx.sampleRate * 0.5);
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }

    const start = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffFrom, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, cutoffTo), start + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, start);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter).connect(env).connect(this.master);
    source.start(start);
    source.stop(start + duration);
  }

  // -------------------------------------------------------------------------
  // The kit
  // -------------------------------------------------------------------------

  click(): void {
    this.tone({ freq: 660, duration: 0.045, gain: 0.1, type: 'square' });
  }

  jump(double = false): void {
    this.tone({
      freq: double ? 520 : 380,
      to: double ? 900 : 720,
      duration: 0.12,
      gain: 0.12,
      type: 'triangle',
    });
  }

  shoot(kind: string): void {
    switch (kind) {
      case 'shotgun':
        this.burst(0.16, 0.28, 2600, 300);
        this.tone({ freq: 160, to: 70, duration: 0.14, gain: 0.16, type: 'sawtooth' });
        break;
      case 'sniper':
        this.burst(0.2, 0.24, 5200, 500);
        this.tone({ freq: 900, to: 180, duration: 0.2, gain: 0.14, type: 'square' });
        break;
      case 'rocket':
        this.tone({ freq: 220, to: 620, duration: 0.3, gain: 0.16, type: 'sawtooth' });
        break;
      case 'smg':
        this.burst(0.05, 0.14, 3400, 900);
        break;
      default:
        this.burst(0.06, 0.18, 3000, 700);
        this.tone({ freq: 300, to: 150, duration: 0.06, gain: 0.1, type: 'square' });
    }
  }

  hit(): void {
    this.tone({ freq: 200, to: 90, duration: 0.09, gain: 0.2, type: 'square' });
  }

  explode(): void {
    this.burst(0.45, 0.42, 1800, 80);
    this.tone({ freq: 120, to: 40, duration: 0.4, gain: 0.2, type: 'sawtooth' });
  }

  ringOut(): void {
    this.tone({ freq: 520, to: 70, duration: 0.5, gain: 0.22, type: 'sawtooth' });
  }

  pickup(): void {
    this.tone({ freq: 660, duration: 0.07, gain: 0.14, type: 'square' });
    this.tone({ freq: 990, duration: 0.09, gain: 0.14, type: 'square', delay: 0.07 });
  }

  /** Powerups get a brighter, longer arpeggio than a weapon crate. */
  powerup(): void {
    this.tone({ freq: 620, duration: 0.07, gain: 0.13, type: 'triangle' });
    this.tone({ freq: 830, duration: 0.07, gain: 0.13, type: 'triangle', delay: 0.06 });
    this.tone({ freq: 1240, duration: 0.11, gain: 0.13, type: 'triangle', delay: 0.12 });
  }

  /** A knife swing. Connecting adds the meaty part on top of the whoosh. */
  stab(connected: boolean): void {
    this.burst(0.07, 0.1, 4200, 1400);
    if (connected) {
      this.tone({ freq: 260, to: 110, duration: 0.11, gain: 0.2, type: 'square' });
    }
  }

  shieldPop(): void {
    this.tone({ freq: 1100, to: 320, duration: 0.16, gain: 0.16, type: 'triangle' });
    this.burst(0.1, 0.12, 2600, 600);
  }

  /** Quiet by design — it fires on every landing, several times a second. */
  land(): void {
    this.tone({ freq: 150, to: 90, duration: 0.05, gain: 0.05, type: 'sine' });
  }

  countdown(final = false): void {
    this.tone({ freq: final ? 880 : 440, duration: final ? 0.28 : 0.1, gain: 0.16, type: 'square' });
  }

  win(): void {
    [523, 659, 784, 1047].forEach((freq, i) => {
      this.tone({ freq, duration: 0.18, gain: 0.16, type: 'square', delay: i * 0.09 });
    });
  }

  crash(): void {
    this.tone({ freq: 300, to: 60, duration: 0.35, gain: 0.2, type: 'sawtooth' });
  }

  // -------------------------------------------------------------------------
  // Tank Trouble
  // -------------------------------------------------------------------------

  /** A tank's main gun: short, blunt, and lower than Gun Mayhem's pistol. */
  tankFire(heavy = false): void {
    this.tone({
      freq: heavy ? 220 : 320,
      to: heavy ? 50 : 90,
      duration: heavy ? 0.2 : 0.13,
      gain: 0.16,
      type: 'sawtooth',
    });
    this.burst(heavy ? 0.16 : 0.09, 0.14, 1800, 300);
  }

  /**
   * A wall bounce.
   *
   * Very quiet and very short on purpose: with six shells in the air and six
   * bounces each, this fires dozens of times a second in a busy round, and
   * anything with a tail turns the arena into a wall of noise. The renderer
   * additionally caps how many it plays per frame.
   */
  ricochet(): void {
    this.tone({ freq: 1400, to: 2200, duration: 0.035, gain: 0.05, type: 'square' });
  }

  // -------------------------------------------------------------------------
  // Gravity Guy
  // -------------------------------------------------------------------------

  /** The gravity flip — a swoop whose direction follows the one you flipped to. */
  flip(down = true): void {
    this.tone({
      freq: down ? 700 : 300,
      to: down ? 300 : 700,
      duration: 0.14,
      gain: 0.11,
      type: 'triangle',
    });
  }

  /** Running into a wall. Blunter and shorter than `crash`. */
  crush(): void {
    this.tone({ freq: 180, to: 45, duration: 0.22, gain: 0.18, type: 'square' });
    this.burst(0.16, 0.16, 900, 120);
  }

  /**
   * The title sting under the intro splash.
   *
   * A placeholder, and deliberately a synthesised one: it needs no asset, so the
   * splash works the day it ships. `music.sting()` prefers a real file whenever
   * one is dropped into `public/music` and falls back to this. Warmer waveform
   * and a longer tail than the rest of the kit — this is a flourish, not a
   * notification.
   */
  fanfare(): void {
    [392, 523, 659, 784].forEach((freq, i) => {
      this.tone({ freq, duration: 0.5, gain: 0.13, type: 'triangle', delay: i * 0.13 });
    });
    this.tone({ freq: 1047, duration: 0.9, gain: 0.11, type: 'sine', delay: 0.52 });
  }
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export const sfx = new Sfx();
