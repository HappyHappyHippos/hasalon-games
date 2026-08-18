import type { InkDocument, InkInput } from '../skribbl/ink';
import type { RngState } from './rng';

export type TelephonePhase =
  | 'intro'
  | 'contributing'
  | 'revealText'
  | 'revealDrawing'
  | 'voting'
  | 'result'
  | 'chainComplete'
  | 'matchOver';
export type TelephoneTask = 'prompt' | 'drawing' | 'guess';

export interface TelephoneConfig {
  game: 'telephone';
  writeSeconds: number;
  drawSeconds: number;
  voteSeconds: number;
}

interface TelephoneStepBase {
  authorId: string;
  authorSeat: number;
  likes: Set<string>;
  award: number;
}

export interface TelephoneTextStep extends TelephoneStepBase {
  kind: 'prompt' | 'guess';
  text: string;
}

export interface TelephoneDrawingStep extends TelephoneStepBase {
  kind: 'drawing';
  ink: number[];
}

export type TelephoneStep = TelephoneTextStep | TelephoneDrawingStep;
export interface TelephoneChain { originSeat: number; steps: TelephoneStep[] }

export interface TelephonePlayer {
  id: string;
  seat: number;
  name: string;
  colorIndex: number;
  score: number;
  submitted: boolean;
  connected: boolean;
  textDraft: string;
  ink: InkDocument;
  draftBudget: number;
}

export interface TelephoneState {
  config: TelephoneConfig;
  rng: RngState;
  players: TelephonePlayer[];
  ring: number[];
  chains: TelephoneChain[];
  phase: TelephonePhase;
  phaseTicks: number;
  phaseTotal: number;
  phaseSeq: number;
  tickCount: number;
  contributionIndex: number;
  revealChainIndex: number;
  revealStepIndex: number;
}

export type TelephoneInput =
  | InkInput
  | { k: 'draft'; text: string }
  | { k: 'submitText'; text: string }
  | { k: 'submitDrawing' }
  | { k: 'like'; step: number; on: boolean };

export interface TelephoneSnapshotPlayer { s: number; p: number; sub: 0 | 1; v: 0 | 1 }
export interface TelephoneRevealStep {
  kind: TelephoneTask;
  authorSeat: number;
  text?: string;
  ink?: number[];
  likedBy: number[];
  likes?: number;
  award?: number;
}

export interface TelephoneSnapshot {
  game: 'telephone';
  tick: number;
  phase: TelephonePhase;
  phaseTicks: number;
  phaseTotal: number;
  phaseSeq: number;
  round: number;
  task: TelephoneTask;
  contributionIndex: number;
  contributionCount: number;
  revealChainIndex: number;
  revealChainCount: number;
  revealStepIndex: number;
  revealed: TelephoneRevealStep[];
  likes: number;
  eligible: number;
  players: TelephoneSnapshotPlayer[];
}

export type TelephonePrevious =
  | { kind: 'prompt' | 'guess'; text: string }
  | { kind: 'drawing'; ink: number[] };

export interface TelephonePrivate {
  task: TelephoneTask;
  previous: TelephonePrevious | null;
  draft: string;
  submitted: boolean;
}

export interface TelephonePrivateCatchUp { task: TelephoneTask; draftInk: number[] }
