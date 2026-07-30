import type { CSSProperties, JSX } from 'react';
import type { GameId } from '@mg/shared';
import { CLIENT_GAMES, CLIENT_GAME_IDS } from '../games/registry';
import { sfx } from '../audio';

interface Props {
  selected: GameId;
  canChoose: boolean;
  onSelect: (gameId: GameId) => void;
}

/**
 * The point of the lobby: everyone's in, now pick what you're playing.
 * The host chooses; everyone else watches the choice land.
 */
export function GamePicker({ selected, canChoose, onSelect }: Props): JSX.Element {
  return (
    <div className="picker" role="radiogroup" aria-label="Choose a game">
      {CLIENT_GAME_IDS.map((id, index) => {
        const game = CLIENT_GAMES[id];
        const isSelected = id === selected;
        const BoxArt = game.BoxArt;

        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={!canChoose && !isSelected}
            className={`gamecard${isSelected ? ' gamecard--on' : ''}`}
            style={
              {
                '--accent': game.accent,
                '--tilt': `${index % 2 === 0 ? -1.1 : 1.1}deg`,
              } as CSSProperties
            }
            onClick={() => {
              if (isSelected) return;
              sfx.click();
              onSelect(id);
            }}
          >
            <span className="gamecard__art">
              <BoxArt />
            </span>
            <span className="gamecard__body">
              <span className="gamecard__name">{game.meta.name}</span>
              <span className="gamecard__tagline">{game.meta.tagline}</span>
              <span className="gamecard__players">
                {game.meta.minPlayers}–{game.meta.maxPlayers} players
              </span>
            </span>
            {isSelected && <span className="gamecard__badge">Playing this</span>}
          </button>
        );
      })}
    </div>
  );
}
