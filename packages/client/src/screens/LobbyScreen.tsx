import { useState, type JSX } from 'react';
import { colorFor } from '@mg/shared';
import { useStore } from '../store';
import { socket } from '../net/socket';
import { AppearancePicker } from '../ui/AppearancePicker';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { ColorPicker } from '../ui/ColorPicker';
import { GamePicker } from '../ui/GamePicker';
import { CLIENT_GAMES } from '../games/registry';

export function LobbyScreen(): JSX.Element {
  const room = useStore((s) => s.room)!;
  const playerId = useStore((s) => s.playerId);
  const identity = useStore((s) => s.identity);
  const setIdentity = useStore((s) => s.setIdentity);
  const [copied, setCopied] = useState(false);

  const me = room.players.find((p) => p.id === playerId);
  const isHost = me?.isHost ?? false;
  const game = CLIENT_GAMES[room.gameId];
  const SettingsPanel = game.Settings;

  const readyPlayers = room.players.filter((p) => p.ready && p.connected);
  const canStart = readyPlayers.length >= game.meta.minPlayers;
  const overflow = Math.max(0, readyPlayers.length - game.meta.maxPlayers);
  const takenColors = new Set(
    room.players.filter((p) => p.id !== playerId).map((p) => p.colorIndex),
  );

  const copyLink = async (): Promise<void> => {
    const link = `${location.origin}${location.pathname}#/room/${room.code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure origin, permissions) — the code is on
      // screen anyway, so this is only a convenience.
      window.prompt('Copy this link:', link);
    }
  };

  return (
    <main className="lobby">
      <div className="lobby__inner">
        <header className="sticker lobby__head">
          <div>
            <p className="eyebrow">Room code</p>
            <p className="lobby__code">{room.code}</p>
          </div>
          <Button onClick={() => void copyLink()}>{copied ? 'Copied!' : 'Copy invite'}</Button>
        </header>

        <div className="lobby__grid">
          <section className="sticker lobby__people">
            <h2 className="eyebrow">
              Who&apos;s here <span className="muted">({room.players.length}/8)</span>
            </h2>
            <ul className="people">
              {room.players.map((player) => (
                <li
                  key={player.id}
                  className={`person${player.ready ? ' person--ready' : ''}${
                    player.connected ? '' : ' person--away'
                  }`}
                >
                  <Avatar
                    colorIndex={player.colorIndex}
                    hat={player.hat}
                    face={player.face}
                    name={player.name}
                    size={38}
                    away={!player.connected}
                  />
                  <div className="person__text">
                    <span className="person__name">
                      {player.name}
                      {player.id === playerId ? ' (you)' : ''}
                    </span>
                    <span className="person__meta">
                      {player.isHost ? 'host · ' : ''}
                      {!player.connected ? 'away' : player.ready ? 'ready' : 'not ready'}
                    </span>
                  </div>
                  <span
                    className={`person__tick${player.ready ? ' person__tick--on' : ''}`}
                    style={{ background: player.ready ? colorFor(player.colorIndex) : undefined }}
                    aria-hidden="true"
                  >
                    {player.ready ? '✓' : ''}
                  </span>
                </li>
              ))}
            </ul>

            <h2 className="eyebrow">Your colour</h2>
            <ColorPicker
              value={identity.colorIndex}
              taken={takenColors}
              onChange={(colorIndex) => {
                setIdentity({ colorIndex });
                socket.setIdentity({ colorIndex });
              }}
            />

            <h2 className="eyebrow">Your look</h2>
            <AppearancePicker
              colorIndex={identity.colorIndex}
              hat={identity.hat}
              face={identity.face}
              onChange={(patch) => {
                setIdentity(patch);
                socket.setIdentity(patch);
              }}
            />
          </section>

          <section className="lobby__choice">
            <h2 className="eyebrow">
              {isHost ? 'Pick a game' : 'The host is picking'}
            </h2>
            <GamePicker
              selected={room.gameId}
              canChoose={isHost}
              onSelect={(gameId) => socket.setGame(gameId)}
            />

            <div className="sticker lobby__settings">
              <h2 className="eyebrow">{game.meta.name} settings</h2>
              <SettingsPanel
                settings={room.settings}
                isHost={isHost}
                playerCount={room.players.length}
                onChange={(patch) => socket.setSettings(patch)}
              />
              <p className="muted small controls-hint">{game.meta.controls}</p>
            </div>
          </section>
        </div>

        <footer className="sticker lobby__foot">
          <Button
            variant={me?.ready ? 'plain' : 'primary'}
            size="lg"
            tone={me?.ready ? undefined : colorFor(identity.colorIndex)}
            onClick={() => socket.setReady(!me?.ready)}
          >
            {me?.ready ? "Wait, I'm not ready" : "I'm ready"}
          </Button>

          {isHost && (
            <Button
              variant="primary"
              size="lg"
              disabled={!canStart}
              onClick={() => socket.start()}
              title={canStart ? undefined : `Need ${game.meta.minPlayers} ready players`}
            >
              Start {game.meta.name}
            </Button>
          )}

          <Button variant="ghost" onClick={() => socket.leave()}>
            Leave
          </Button>
        </footer>

        <div className="lobby__notes">
          {!canStart && (
            <p className="muted small center">
              {readyPlayers.length} ready — {game.meta.name} needs at least {game.meta.minPlayers}.
            </p>
          )}
          {overflow > 0 && (
            <p className="muted small center">
              {game.meta.name} seats {game.meta.maxPlayers}. {overflow}{' '}
              {overflow === 1 ? 'person watches' : 'people watch'} this match and rotate in next.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
