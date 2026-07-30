import type { GameSnapshot } from '@mg/shared';

export interface FeedEntry {
  snap: GameSnapshot;
  /** performance.now() when this arrived. */
  at: number;
}

/** ~3 seconds of history: far more than interpolation needs, still bounded. */
const MAX_ENTRIES = 90;

/**
 * Snapshots deliberately live outside React.
 *
 * They arrive 30 times a second; pushing them through component state would
 * re-render the whole tree at 30 Hz for no benefit. The canvas renderers read
 * this buffer directly in their animation frame, and only slow-moving derived
 * data (scores, phase) is mirrored into the store for the HUD.
 */
class SnapshotFeed {
  entries: FeedEntry[] = [];

  /** Smoothed round-trip time, used to decide how far ahead to predict. */
  rttMs = 60;

  push(snap: GameSnapshot): void {
    this.entries.push({ snap, at: performance.now() });
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  get latest(): FeedEntry | null {
    return this.entries[this.entries.length - 1] ?? null;
  }

  observeRtt(sample: number): void {
    // Cheap exponential smoothing; a single spike shouldn't move prediction far.
    this.rttMs = this.rttMs * 0.8 + Math.min(sample, 1000) * 0.2;
  }

  reset(): void {
    this.entries = [];
  }
}

export const feed = new SnapshotFeed();
