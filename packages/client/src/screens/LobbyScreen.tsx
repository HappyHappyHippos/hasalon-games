import { useEffect, useState, type JSX } from 'react';
import { colorFor } from '@mg/shared';
import { useStore } from '../store';
import { useT } from '../strings';
import { socket } from '../net/socket';
import { AppearancePicker } from '../ui/AppearancePicker';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { GamePicker } from '../ui/GamePicker';
import { VoiceBar } from '../ui/VoiceBar';
import { useVoice } from '../ui/useVoice';
import { CLIENT_GAMES } from '../games/registry';
import { resetIOSLobbyViewport } from '../ui/mobileViewport';

export function LobbyScreen(): JSX.Element {
  const room = useStore((s) => s.room)!;
  const playerId = useStore((s) => s.playerId);
  const identity = useStore((s) => s.identity);
  const setIdentity = useStore((s) => s.setIdentity);
  const t = useT();
  const speaking = new Set(useVoice().speaking);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Creating/joining can replace HomeScreen while its input is still focused.
    // iOS preserves that input-focus zoom across the route change, leaving the
    // entire lobby enlarged even though it contains no focused field.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return resetIOSLobbyViewport();
  }, []);

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
  // Hidden until somebody's actually played something — an all-zero column
  // before the room's first match is noise, not standings.
  const showTotals = room.players.some((p) => p.totalScore > 0);

  const copyLink = async (): Promise<void> => {
    const link = `${location.origin}${location.pathname}#/room/${room.code}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: document.title,
          text: t.inviteShareText(room.code),
          url: link,
        });
        return;
      } catch (error) {
        // Cancelling the native sheet is a complete action, not a clipboard failure.
        if ((error as DOMException).name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure origin, permissions) — the code is on
      // screen anyway, so this is only a convenience.
      window.prompt(t.copyThisLink, link);
    }
  };

  return (
    <main className="lobby">
      <div className="lobby__inner">
        <header className="sticker lobby__head">
          <div>
            <p className="eyebrow">{t.roomCode}</p>
            <p className="lobby__code" dir="ltr">
              {room.code}
            </p>
          </div>
          <Button onClick={() => void copyLink()}>{copied ? t.copied : t.copyInvite}</Button>
        </header>

        <div className="lobby__grid">
          <section className="sticker lobby__people">
            <h2 className="eyebrow">
              {t.whosHere} <span className="muted">{t.outOf(room.players.length, 8)}</span>
            </h2>
            <ul className="people">
              {room.players.map((player) => (
                <li
                  key={player.id}
                  className={`person${player.ready ? ' person--ready' : ''}${
                    player.connected ? '' : ' person--away'
                  }${speaking.has(player.id) ? ' person--speaking' : ''}${
                    player.id === playerId ? ' person--self' : ''
                  }`}
                >
                  {player.id === playerId ? (
                    <div className="person__avatar">
                      <AppearancePicker
                        colorIndex={identity.colorIndex}
                        hat={identity.hat}
                        face={identity.face}
                        takenColors={takenColors}
                        onChange={(patch) => {
                          setIdentity(patch);
                          socket.setIdentity(patch);
                        }}
                      />
                    </div>
                  ) : (
                    <div className="person__avatar">
                      <Avatar
                        colorIndex={player.colorIndex}
                        hat={player.hat}
                        face={player.face}
                        name={player.name}
                        size={52}
                        away={!player.connected}
                      />
                    </div>
                  )}
                  <div className="person__text">
                    <span className="person__name">
                      {player.name}
                      {player.id === playerId ? t.suffixYou : ''}
                      {player.voice && (
                        <span className="person__mic" aria-hidden="true">
                          🎤
                        </span>
                      )}
                    </span>
                    <span className="person__meta">
                      {player.isHost ? t.metaHost : ''}
                      {!player.connected
                        ? t.metaAway
                        : player.ready
                          ? t.metaReady
                          : t.metaNotReady}
                    </span>
                  </div>
                  <div className="person__badges">
                    {showTotals && (
                      <span className="person__total" title={t.totalScoreTitle}>
                        {t.totalScoreLabel(Math.round(player.totalScore))}
                      </span>
                    )}
                    <span
                      className={`person__tick${player.ready ? ' person__tick--on' : ''}`}
                      style={{ background: player.ready ? colorFor(player.colorIndex) : undefined }}
                      role="img"
                      aria-label={t.personReadyState(player.name, player.ready)}
                    >
                      {player.ready ? '✓' : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <h2 className="eyebrow">{t.voiceHeading}</h2>
            <VoiceBar />

            <div className="sticker lobby__ready">
              <Button
                variant={me?.ready ? 'plain' : 'primary'}
                size="lg"
                full
                tone={me?.ready ? undefined : colorFor(identity.colorIndex)}
                disabled={!me?.connected}
                onClick={() => socket.setReady(!me?.ready)}
              >
                {me?.ready ? t.notReady : t.ready}
              </Button>
              {!canStart && (
                <p className="muted small center" style={{ marginTop: '0.5rem' }}>
                  {t.readyCount(readyPlayers.length, game.meta.minPlayers, t.games[game.meta.id].name)}
                </p>
              )}
            </div>
          </section>

          <section className="lobby__choice">
            <GamePicker
              selected={room.gameId}
              canChoose={isHost}
              onSelect={(gameId) => socket.setGame(gameId)}
            />

            <div className="sticker lobby__settings">
              <h2 className="eyebrow">{t.gameSettings(t.games[game.meta.id].name)}</h2>
              <SettingsPanel
                settings={room.settings}
                isHost={isHost}
                playerCount={room.players.length}
                onChange={(patch) => socket.setSettings(patch)}
              />
            </div>
          </section>
        </div>

        <footer className="sticker lobby__foot">
          {isHost && (
            <Button
              variant="primary"
              size="lg"
              disabled={!canStart}
              onClick={() => socket.start()}
              title={canStart ? undefined : t.needReady(game.meta.minPlayers)}
            >
              {t.startGame(t.games[game.meta.id].name)}
            </Button>
          )}

          <Button variant="ghost" onClick={() => socket.leave()}>
            {t.leave}
          </Button>
        </footer>

        {overflow > 0 && (
          <div className="lobby__notes">
            <p className="muted small center">
              {t.overflow(t.games[game.meta.id].name, game.meta.maxPlayers, overflow)}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
