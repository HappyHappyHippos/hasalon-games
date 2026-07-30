import type { ComponentType, JSX } from 'react';
import { GAMES, type GameConfig, type GameId, type GameMeta, type RoomView } from '@mg/shared';
import { AchtungBoxArt } from './achtung/BoxArt';
import { AchtungScreen } from './achtung/AchtungScreen';
import { AchtungSettings } from './achtung/Settings';
import { GunMayhemBoxArt } from './gunmayhem/BoxArt';
import { GunMayhemScreen } from './gunmayhem/GunMayhemScreen';
import { GunMayhemSettings } from './gunmayhem/Settings';

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
};

/** Display order in the lobby. */
export const CLIENT_GAME_IDS: GameId[] = ['gunmayhem', 'achtung'];

export function renderGameScreen(room: RoomView, mySeat: number): JSX.Element {
  const game = CLIENT_GAMES[room.gameId];
  const Screen = game.Screen;
  return <Screen room={room} mySeat={mySeat} />;
}
