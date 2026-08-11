import { seconds } from '../../engine';
export const MIN_PLAYERS = 2; export const MAX_PLAYERS = 8;
export const DEFAULT_WRITE_SECONDS = 35; export const DEFAULT_DRAW_SECONDS = 75; export const DEFAULT_VOTE_SECONDS = 12;
export const MIN_WRITE_SECONDS = 15; export const MAX_WRITE_SECONDS = 90; export const MIN_DRAW_SECONDS = 20; export const MAX_DRAW_SECONDS = 180; export const MIN_VOTE_SECONDS = 5; export const MAX_VOTE_SECONDS = 45;
export const MAX_TEXT_LENGTH = 80; export const MAX_DRAFTS_PER_SECOND = 6;
export const INTRO_TICKS = seconds(2); export const TEXT_REVEAL_TICKS = seconds(2); export const DRAWING_REVEAL_TICKS = seconds(2); export const RESULT_TICKS = seconds(3.5); export const CHAIN_COMPLETE_TICKS = seconds(7); export const POINTS_PER_LIKE = 1;
