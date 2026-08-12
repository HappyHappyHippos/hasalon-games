/**
 * The client half of the game seam.
 *
 * `@mg/shared`'s `GAMES` says what a game *is* — rules, config, simulation.
 * This says what it *looks like*: the screen to mount while it is running, the
 * settings panel the host sees in the lobby, the box art on the picker, and the
 * accent colour. Nothing outside this file needs to know which games exist;
 * `renderGameScreen` takes a room and returns the right screen.
 *
 * `CLIENT_GAMES` is keyed by `GameId`, so adding a game to the shared registry
 * without adding it here is a compile error rather than a blank screen.
 */
import type { ComponentType, JSX } from 'react';
import { GAMES, type GameConfig, type GameId, type GameMeta, type RoomView } from '@mg/shared';
import { AchtungBoxArt } from './achtung/BoxArt';
import { SkribblBoxArt } from './skribbl/BoxArt';
import { SkribblScreen } from './skribbl/SkribblScreen';
import { SkribblSettings } from './skribbl/Settings';
import { AchtungScreen } from './achtung/AchtungScreen';
import { AchtungSettings } from './achtung/Settings';
import { GunMayhemBoxArt } from './gunmayhem/BoxArt';
import { GunMayhemScreen } from './gunmayhem/GunMayhemScreen';
import { GunMayhemSettings } from './gunmayhem/Settings';
import { MemesBoxArt } from './memes/BoxArt';
import { MemesScreen } from './memes/MemesScreen';
import { MemesSettings } from './memes/Settings';
import { TanksBoxArt } from './tanks/BoxArt';
import { TanksScreen } from './tanks/TanksScreen';
import { TanksSettings } from './tanks/Settings';
import { WormsBoxArt } from './worms/BoxArt';
import { WormsScreen } from './worms/WormsScreen';
import { WormsSettings } from './worms/Settings';
import { GravityBoxArt } from './gravity/BoxArt';
import { GravityScreen } from './gravity/GravityScreen';
import { GravitySettings } from './gravity/Settings';
import { TelephoneBoxArt } from './telephone/BoxArt';
import { TelephoneScreen } from './telephone/TelephoneScreen';
import { TelephoneSettings } from './telephone/Settings';

export interface SettingsProps {
  settings: GameConfig;
  isHost: boolean;
  playerCount: number;
  onChange: (patch: Record<string, unknown>) => void;
}

export interface ClientGame {
  meta: GameMeta;
  /** Card art for the lobby picker. */
  BoxArt: ComponentType;
  /** The in-match screen. */
  Screen: ComponentType<{ room: RoomView; mySeat: number }>;
  /** Host-editable options for this game. */
  Settings: ComponentType<SettingsProps>;
  /** Accent used for the card and the selected state. */
  accent: string;
}

/**
 * The client half of the game registry. Adding a game means one entry here and
 * one module in `@mg/shared` — the lobby, the room and the protocol are
 * already game-agnostic.
 */
export const CLIENT_GAMES: Record<GameId, ClientGame> = {
  gunmayhem: {
    meta: GAMES.gunmayhem.meta,
    BoxArt: GunMayhemBoxArt,
    Screen: GunMayhemScreen,
    Settings: GunMayhemSettings,
    accent: 'var(--red)',
  },
  achtung: {
    meta: GAMES.achtung.meta,
    BoxArt: AchtungBoxArt,
    Screen: AchtungScreen,
    Settings: AchtungSettings,
    accent: 'var(--teal)',
  },
  skribbl: {
    meta: GAMES.skribbl.meta,
    BoxArt: SkribblBoxArt,
    Screen: SkribblScreen,
    Settings: SkribblSettings,
    accent: 'var(--violet)',
  },
  memes: {
    meta: GAMES.memes.meta,
    BoxArt: MemesBoxArt,
    Screen: MemesScreen,
    Settings: MemesSettings,
    accent: 'var(--orange)',
  },
  tanks: {
    meta: GAMES.tanks.meta,
    BoxArt: TanksBoxArt,
    Screen: TanksScreen,
    Settings: TanksSettings,
    accent: 'var(--green)',
  },
  gravity: {
    meta: GAMES.gravity.meta,
    BoxArt: GravityBoxArt,
    Screen: GravityScreen,
    Settings: GravitySettings,
    accent: 'var(--yellow)',
  },
  telephone: {
    meta: GAMES.telephone.meta,
    BoxArt: TelephoneBoxArt,
    Screen: TelephoneScreen,
    Settings: TelephoneSettings,
    accent: 'var(--violet)',
  },
  worms: {
    meta: GAMES.worms.meta,
    BoxArt: WormsBoxArt,
    Screen: WormsScreen,
    Settings: WormsSettings,
    accent: 'var(--orange)',
  },
};

/**
 * Display order in the lobby's game picker — the only one. `GAMES` in
 * `@mg/shared` is keyed by id and carries no order; reorder here.
 */
export const CLIENT_GAME_IDS: GameId[] = [
  'gunmayhem',
  'worms',
  'tanks',
  'achtung',
  'gravity',
  'skribbl',
  'telephone',
  'memes',
];

export function renderGameScreen(room: RoomView, mySeat: number): JSX.Element {
  const game = CLIENT_GAMES[room.gameId];
  const Screen = game.Screen;
  return <Screen room={room} mySeat={mySeat} />;
}
