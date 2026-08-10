import { type CSSProperties, type JSX } from 'react';
import {
  MAX_SERIES_ROUNDS,
  MIN_SERIES_ROUNDS,
  eligibleGames,
  type GameId,
  type SeriesPace,
  type SeriesSetup as Setup,
} from '@mg/shared';
import { CLIENT_GAMES, CLIENT_GAME_IDS } from '../games/registry';
import { sfx } from '../audio';
import { socket } from '../net/socket';
import { useT } from '../strings';
import { NumberStepper } from './NumberStepper';
import { Segmented } from './Segmented';
import { Toggle } from './Toggle';

/**
 * The roulette panel in the lobby: on/off, how many games, how long each runs,
 * and which ones are in the hat.
 *
 * The hat is its own widget rather than `GamePicker` in another costume. That
 * component is a radiogroup — one selection, always exactly one — and this is a
 * set of independent checkboxes. Sharing the `.gamecard` look while keeping the
 * semantics honest is cheaper than one component that has to be told which kind
 * of thing it is today.
 *
 * Eligibility is computed here from the same `eligibleGames` the server draws
 * with, so a game the room has outgrown is visibly locked rather than silently
 * absent from the lineup.
 */

const PACES: SeriesPace[] = ['quick', 'normal', 'long'];

interface Props {
  setup: Setup;
  isHost: boolean;
  /** Connected player count in the room. */
  playerCount: number;
}

export function SeriesSetup({ setup, isHost, playerCount }: Props): JSX.Element {
  const t = useT();
  const eligible = eligibleGames(setup.pool, playerCount);

  // Never offer more legs than there are games to fill them. The server clamps
  // too — someone can always join between this render and the draw — but a
  // stepper that stops where the lineup stops is the honest version.
  const maxRounds = Math.max(MIN_SERIES_ROUNDS, Math.min(MAX_SERIES_ROUNDS, eligible.length));

  const patch = (next: Partial<Setup>): void => socket.setSeriesSetup(next);

  const togglePool = (id: GameId): void => {
    const on = setup.pool.includes(id);
    sfx.click();
    patch({ pool: on ? setup.pool.filter((x) => x !== id) : [...setup.pool, id] });
  };

  return (
    <div className="sticker roulette-setup">
      <Toggle
        label={t.rouletteMode}
        checked={setup.enabled}
        disabled={!isHost}
        onChange={(enabled) => patch({ enabled })}
      />

      {setup.enabled && (
        <>
          <p className="muted roulette-setup__blurb">{t.rouletteBlurb}</p>

          <NumberStepper
            label={t.rouletteRounds}
            value={Math.min(setup.rounds, maxRounds)}
            min={MIN_SERIES_ROUNDS}
            max={maxRounds}
            disabled={!isHost}
            onChange={(rounds) => patch({ rounds })}
          />
          <p className="muted roulette-setup__hint">
            {t.legsFromPool(setup.rounds, eligible.length)}
          </p>

          <Segmented
            label={t.roulettePace}
            value={setup.pace}
            options={PACES.map((pace, i) => ({ value: pace, label: t.paceNames[i]! }))}
            disabled={!isHost}
            onChange={(pace) => patch({ pace })}
          />

          <h3 className="eyebrow">{t.roulettePool}</h3>
          <div className="pool" role="group" aria-label={t.roulettePool}>
            {CLIENT_GAME_IDS.map((id) => {
              const game = CLIENT_GAMES[id];
              const on = setup.pool.includes(id);
              const fits = playerCount >= game.meta.minPlayers && playerCount <= game.meta.maxPlayers;
              const BoxArt = game.BoxArt;

              return (
                <button
                  key={id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={t.poolCardState(t.games[id].name, on)}
                  disabled={!isHost || !fits}
                  className={`poolcard${on ? ' poolcard--on' : ''}${fits ? '' : ' poolcard--locked'}`}
                  style={{ '--accent': game.accent } as CSSProperties}
                  onClick={() => togglePool(id)}
                >
                  <span className="poolcard__art">
                    <BoxArt />
                  </span>
                  <span className="poolcard__name">{t.games[id].name}</span>
                  {!fits && (
                    <span className="poolcard__why">
                      {playerCount > game.meta.maxPlayers
                        ? t.needsAtMost(game.meta.maxPlayers)
                        : t.needsAtLeast(game.meta.minPlayers)}
                    </span>
                  )}
                  {fits && on && <span className="poolcard__tick" aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
