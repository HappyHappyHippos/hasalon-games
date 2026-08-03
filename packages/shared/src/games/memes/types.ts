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

export type MemesInput =
  | { k: 'draft'; a: string; b?: string }
  | { k: 'submit'; a: string; b?: string }
  | { k: 'vote'; v: MemesVote }
  | { k: 'react'; r: number };

export interface MemesEntry {
  authorId: string;
  authorSeat: number;
  templateId: string;
  texts: string[];
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
  submitted: boolean;
  draftBudget: number;
  /** Server-only lifecycle fact, supplied through GameInstance.setConnected. */
  connected: boolean;
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
}

export interface MemesStageEntry {
  templateId: string;
  texts: string[];
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
}

export interface MemesPrivate {
  templateId: string;
  slots: number;
  nudge: string;
  draft: string[];
  submitted: boolean;
  myVote: MemesVote | null;
  isAuthor: boolean;
}

export interface MemeTextBox {
  x: number;
  y: number;
  w: number;
  h: number;
  style: 'impact' | 'panel';
  align: 'center' | 'start';
}

export interface MemeTemplate {
  id: string;
  /** Human-readable template name, used for image alt text. */
  name: string;
  slots: 1 | 2;
  boxes: MemeTextBox[];
  aspect: number;
  nudge?: { he: string; en: string };
  tier: 'classic' | 'reaction' | 'wildcard';
}
