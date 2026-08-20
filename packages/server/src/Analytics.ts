/**
 * Where events go, and the only thing in the codebase that writes them.
 *
 * Three sinks, and they are not three copies of the same idea — each one is the
 * answer to a different question:
 *
 * - **stdout**, one line of NDJSON per event. This is the *stream*, and it is
 *   the portability guarantee: Railway, CloudWatch, Cloud Logging, Loki and
 *   `docker logs` all collect stdout with no configuration and no SDK. Moving
 *   host changes nothing here.
 * - **a file**, if `ANALYTICS_FILE` points somewhere. This is the *store*, and
 *   it exists so the dashboard survives a restart — which on Railway happens
 *   every deploy and every time the app is allowed to sleep.
 * - **memory**, always. This is the *read model*: the dashboard aggregates from
 *   here and nowhere else, so there is exactly one query path regardless of
 *   whether a file is configured. The file's whole job is to refill it at boot.
 *
 * No aggregation happens on write. Counters maintained alongside the log are a
 * second version of the truth that drifts the first time the aggregation logic
 * changes, and at this scale summing a few thousand rows on request costs
 * nothing — see `summary.ts`.
 *
 * **Recording must never affect a match.** Every path here is wrapped, the file
 * write is a stream (never a synchronous flush), and a sink that fails is
 * dropped rather than retried. An analytics bug that pauses the tick loop would
 * be a far worse outcome than a missing row.
 *
 * A singleton, like `serverNow`. Analytics is cross-cutting — the alternative is
 * threading a recorder through `Room`, `MatchClock` and `roster` so that a side
 * channel can appear in three call signatures that have nothing to do with it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AnalyticsEvent, AnalyticsEventName } from '@mg/shared';

/** How long events are kept. Everything older is dropped at boot and daily after. */
const DEFAULT_RETENTION_DAYS = 90;

/**
 * Ceiling on the in-memory read model.
 *
 * At family scale a busy evening is a few hundred rows, so this is years of
 * headroom — it exists so that a runaway loop somewhere cannot turn the log into
 * a memory leak, not because it is expected to bind.
 */
const DEFAULT_MEMORY_LIMIT = 100_000;

const DAY_MS = 86_400_000;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Ceiling on events recorded per second, across the whole process.
 *
 * The file sink is a synchronous append — the right trade for a few rows a
 * minute, since it needs no stream lifecycle and survives a `SIGKILL` with
 * everything on disk. It is the wrong trade at a thousand rows a second, and
 * one misbehaving socket can generate those: the flood guard in `app.ts` lets a
 * client send 200 messages a second, and every rejected one is an `error` event.
 * Past this the excess is dropped, which is what a rate limit is for.
 */
const MAX_EVENTS_PER_SECOND = 50;

export interface AnalyticsOptions {
  /** NDJSON path. Null disables the durable store; the dashboard then covers this boot only. */
  file?: string | null;
  retentionDays?: number;
  /** Off under test, where the log would drown the reporter. */
  stdout?: boolean;
  memoryLimit?: number;
}

export class Analytics {
  private events: AnalyticsEvent[] = [];
  private file: string | null = null;
  private retentionDays = DEFAULT_RETENTION_DAYS;
  private memoryLimit = DEFAULT_MEMORY_LIMIT;
  private useStdout = false;
  private listeners = new Set<(event: AnalyticsEvent) => void>();
  private pruneTimer: NodeJS.Timeout | null = null;
  /** Set once when the file turns out to be unwritable, so we complain exactly once. */
  private fileBroken = false;
  private windowStart = 0;
  private windowCount = 0;

  /**
   * Point the recorder at its sinks and refill the read model from disk.
   *
   * Called once from `index.ts`. Safe to call again — the tests do, to redirect
   * a run at a scratch file — and each call replaces the previous configuration
   * wholesale rather than merging into it.
   */
  configure(options: AnalyticsOptions): void {
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.memoryLimit = options.memoryLimit ?? DEFAULT_MEMORY_LIMIT;
    this.useStdout = options.stdout ?? false;
    this.file = options.file ?? null;
    this.fileBroken = false;
    this.events = [];

    if (this.file) this.load(this.file);

    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
    this.pruneTimer.unref?.();
  }

  /**
   * Write one event.
   *
   * `fields` is spread *before* `t` and `e` so a caller cannot accidentally
   * overwrite either — a stray `e` in a field bag would produce a row the
   * dashboard silently miscategorises.
   */
  record(name: AnalyticsEventName, fields: Record<string, unknown> = {}): void {
    try {
      const now = Date.now();
      // Rolls over on a clock that moved *either* way. `>= 1000` alone only
      // handles time going forwards, and `Date.now()` is not monotonic — an NTP
      // correction stepping it back is the reason `serverClock.ts` exists. A
      // backwards step leaves the difference permanently negative, so the window
      // never rolls, `windowCount` climbs past the cap and stays there, and the
      // usage log goes quiet for good rather than for a second.
      if (now - this.windowStart >= 1000 || now < this.windowStart) {
        this.windowStart = now;
        this.windowCount = 0;
      }
      this.windowCount += 1;
      if (this.windowCount > MAX_EVENTS_PER_SECOND) return;

      const event: AnalyticsEvent = { ...clean(fields), t: new Date(now).toISOString(), e: name };
      this.events.push(event);
      if (this.events.length > this.memoryLimit) {
        this.events.splice(0, this.events.length - this.memoryLimit);
      }

      const line = JSON.stringify(event);
      // Pure JSON, no `[mg]` prefix — that is what separates an event from the
      // server's ordinary chatter when both land in the same log pipeline.
      if (this.useStdout) console.log(line);
      this.append(line);

      for (const listener of this.listeners) listener(event);
    } catch {
      // A log line is never worth an exception in a game loop.
    }
  }

  /** Newest last. The dashboard's only source; see the note at the top of the file. */
  all(): readonly AnalyticsEvent[] {
    return this.events;
  }

  /** The raw log, for download. The escape hatch that makes this format non-lock-in. */
  ndjson(): string {
    return this.events.map((event) => JSON.stringify(event)).join('\n');
  }

  /** Test hook: observe every event without configuring a sink. Returns an unsubscribe. */
  subscribe(listener: (event: AnalyticsEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------
  // The file sink
  // -------------------------------------------------------------------------

  private append(line: string): void {
    if (!this.file || this.fileBroken) return;
    try {
      appendFileSync(this.file, `${line}\n`);
    } catch (error) {
      // A read-only or missing mount is a deployment mistake, not a crash. Say
      // so once and fall back to stdout, which is still capturing everything.
      this.fileBroken = true;
      console.warn(`[mg] analytics: cannot write ${this.file}; stdout only`, error);
    }
  }

  /**
   * Refill memory from disk, dropping anything past the retention window.
   *
   * Lines that do not parse are skipped rather than fatal: a log truncated
   * mid-write by a killed container is normal, and losing the last row is a far
   * better outcome than refusing to boot.
   */
  private load(file: string): void {
    try {
      mkdirSync(dirname(file), { recursive: true });
      if (!existsSync(file)) return;

      const cutoff = Date.now() - this.retentionDays * DAY_MS;
      const kept: AnalyticsEvent[] = [];
      let seen = 0;
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue;
        seen += 1;
        const event = parseEvent(line);
        if (event && Date.parse(event.t) >= cutoff) kept.push(event);
      }

      this.events = kept.slice(-this.memoryLimit);
      // Rewrite only when something was actually dropped, so an ordinary restart
      // does not rewrite the whole log for nothing.
      if (this.events.length !== seen) this.rewrite();
    } catch (error) {
      console.warn(`[mg] analytics: could not read ${file}`, error);
    }
  }

  private prune(): void {
    const cutoff = Date.now() - this.retentionDays * DAY_MS;
    const before = this.events.length;
    this.events = this.events.filter((event) => Date.parse(event.t) >= cutoff);
    if (this.events.length !== before) this.rewrite();
  }

  private rewrite(): void {
    if (!this.file || this.fileBroken) return;
    try {
      writeFileSync(this.file, this.events.length ? `${this.ndjson()}\n` : '');
    } catch (error) {
      this.fileBroken = true;
      console.warn(`[mg] analytics: cannot rewrite ${this.file}; stdout only`, error);
    }
  }
}

function parseEvent(line: string): AnalyticsEvent | null {
  try {
    const value = JSON.parse(line) as unknown;
    if (typeof value !== 'object' || value === null) return null;
    const event = value as AnalyticsEvent;
    return typeof event.t === 'string' && typeof event.e === 'string' ? event : null;
  } catch {
    return null;
  }
}

/**
 * Drop empty fields.
 *
 * Absent is cleaner than `null` in a format meant to be read by eye, and it
 * keeps a row about a lobby action from carrying six columns of nothing.
 */
function clean(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

export const analytics = new Analytics();

/**
 * Read the sink configuration out of the environment.
 *
 * The default file path is relative, so `npm run dev` produces a working
 * dashboard with no setup at all. In a container that path is ephemeral, which
 * is the correct default too — it matches the rest of the server, where nothing
 * is persisted — and mounting a volume over it is the one-line upgrade. See
 * `docs/analytics.md`.
 */
export function analyticsOptionsFromEnv(): AnalyticsOptions {
  const configured = process.env.ANALYTICS_FILE?.trim();
  const days = Number(process.env.ANALYTICS_DAYS);
  return {
    // Resolved, so the startup line names a real place. A relative default lands
    // in `/app/data` in the container and in `packages/server/data` under
    // `npm run dev`, and "data/events.ndjson" printed on its own is no help at
    // all in working out which.
    file: configured === 'off' ? null : resolve(configured || 'data/events.ndjson'),
    retentionDays: Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS,
    stdout: true,
  };
}
