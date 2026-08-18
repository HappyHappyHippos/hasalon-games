/**
 * Meme Machine's server and wire models.
 *
 * The secrecy boundary is deliberate: player templates and drafts live only in
 * `MemesState`/`MemesPrivate`; captions enter the broadcast snapshot only when
 * their own entry reaches the stage; authorship stays `-1` until `result`.
 */

import type { RngState } from './rng';

export type MemesPhase =
  | 'intro'
  | 'writing'
  | 'reveal'
  | 'voting'
  | 'result'
  | 'standings'
  | 'matchOver';

export interface MemesConfig {
  game: 'memes';
  writeSeconds: number;
  voteSeconds: number;
  rounds: number;
  nudges: boolean;
}

export type MemesVote = -1 | 0 | 1;

/** Normalised physical image geometry for a player-moved/resized caption box. */
export interface MemeBoxPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type MemesInput =
  | { k: 'draft'; texts: string[]; p?: MemeBoxPosition[] }
  | { k: 'submit'; texts: string[]; p?: MemeBoxPosition[] }
  | { k: 'skipMeme' }
  | { k: 'vote'; v: MemesVote }
  | { k: 'react'; r: number };

export interface MemesEntry {
  authorId: string;
  authorSeat: number;
  templateId: string;
  texts: string[];
  positions: MemeBoxPosition[];
  ballots: Map<string, MemesVote>;
  award: number;
  top: boolean;
  reactions: number[];
}

export interface MemesPlayer {
  id: string;
  seat: number;
  name: string;
  colorIndex: number;
  score: number;
  roundScore: number;
  templateId: string;
  draft: string[];
  draftPositions: MemeBoxPosition[];
  submitted: boolean;
  draftBudget: number;
  skipsRemaining: number;
  /** Server-only lifecycle fact, supplied through GameInstance.setConnected. */
  connected: boolean;
}

/**
 * One finished meme, kept for the end-of-match gallery.
 *
 * Archived at `finishRound`, after `awardTopMemes` has settled `award` and
 * `top`, and specifically *before* `dealRound` empties `entries` for the next
 * round. Authorship is a seat rather than an id because nothing is secret any
 * more by the time this is sent.
 */
export interface MemesGalleryEntry {
  templateId: string;
  texts: string[];
  positions: MemeBoxPosition[];
  authorSeat: number;
  award: number;
  top: 0 | 1;
  round: number;
}

export interface MemesState {
  config: MemesConfig;
  rng: RngState;
  players: MemesPlayer[];
  phase: MemesPhase;
  phaseTicks: number;
  phaseTotal: number;
  phaseSeq: number;
  tickCount: number;
  round: number;
  entries: MemesEntry[];
  entryIndex: number;
  usedTemplates: Set<string>;
  /** Every scored meme of the match so far, oldest first. */
  gallery: MemesGalleryEntry[];
}

export interface MemesStageEntry {
  templateId: string;
  texts: string[];
  positions: MemeBoxPosition[];
  authorSeat: number;
  ballots: number;
  eligible: number;
  tally: [number, number, number] | null;
  award: number;
  top: 0 | 1;
  reactions: number[];
}

export interface MemesSnapshotPlayer {
  s: number;
  p: number;
  rp: number;
  sub: 0 | 1;
  v: 0 | 1;
}

export interface MemesSnapshot {
  game: 'memes';
  tick: number;
  phase: MemesPhase;
  phaseTicks: number;
  phaseTotal: number;
  phaseSeq: number;
  round: number;
  rounds: number;
  entryIndex: number;
  entryCount: number;
  stage: MemesStageEntry | null;
  players: MemesSnapshotPlayer[];
  /**
   * Every meme of the match, and **null until the match is over**.
   *
   * Deliberately not carried the whole way through. `Room.broadcastSnapshot`
   * encodes one snapshot per broadcast and pushes the same string to everybody
   * thirty times a second; a list that grows by one meme per player per round
   * would be re-encoded and re-sent on every one of those ticks for the length
   * of the match, to say something nobody can look at yet. At `matchOver` the
   * tick loop has stopped, so this is encoded once — and because `sendCatchUp`
   * replays the last snapshot, somebody who reconnects onto the end screen
   * still gets the whole gallery.
   */
  gallery: MemesGalleryEntry[] | null;
}

export interface MemesPrivate {
  templateId: string;
  slots: number;
  nudge: string;
  draft: string[];
  positions: MemeBoxPosition[];
  submitted: boolean;
  myVote: MemesVote | null;
  isAuthor: boolean;
  skipsRemaining: number;
}

export interface MemeTextBox {
  x: number;
  y: number;
  w: number;
  h: number;
  style: 'impact' | 'panel' | 'plain';
  /** Physical alignment from Imgflip's image coordinate system. */
  align: 'center' | 'left' | 'right';
}

export interface MemeTemplate {
  id: string;
  /** Human-readable template name, used for image alt text. */
  name: string;
  slots: 1 | 2;
  boxes: MemeTextBox[];
  aspect: number;
  /** Local runtime asset type. Animated templates are compact, muted MP4 loops. */
  format: 'jpg' | 'mp4';
  nudge?: { he: string; en: string };
  tier: 'classic' | 'reaction' | 'wildcard';
}
