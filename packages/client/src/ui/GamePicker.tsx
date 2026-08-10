import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent } from 'react';
import type { GameId } from '@mg/shared';
import { CLIENT_GAMES, CLIENT_GAME_IDS } from '../games/registry';
import { useT } from '../strings';
import { sfx } from '../audio';

interface Props {
  selected: GameId;
  canChoose: boolean;
  onSelect: (gameId: GameId) => void;
}

const COUNT = CLIENT_GAME_IDS.length;

/**
 * Where a card sits as a function of how many steps it is from the centre.
 * Index 0 is the centre; the last row is "off the edge", which is where
 * everything further than the visible fan is parked so it fades in rather
 * than popping. Values in between are interpolated, so a half-finished drag
 * puts every card half-way to its next slot — that is what makes the swipe
 * feel attached to the finger instead of snapping at a threshold.
 *
 * `x` is a percentage of the card's own width and `y` of its height; `tilt` is
 * degrees away from the centre, so the row fans out like a hand of cards.
 *
 * `y` is what bends the row into an arc instead of a straight line — each step
 * out from the centre also drops, so the fan curves down and away. It stays
 * under the scale-down at every slot, so nothing reaches lower than the centre
 * card and the track needs no extra room for it.
 */
const SLOTS = [
  { x: 0, y: 0, scale: 1, tilt: 0, opacity: 1 },
  { x: 72, y: 7, scale: 0.72, tilt: 9, opacity: 0.55 },
  { x: 118, y: 16, scale: 0.55, tilt: 15, opacity: 0.22 },
  { x: 140, y: 21, scale: 0.5, tilt: 17, opacity: 0 },
];

/** Shortest signed distance between two indices around the ring. */
function wrapOffset(delta: number): number {
  return ((delta + COUNT * 1.5) % COUNT) - COUNT / 2;
}

function wrapIndex(index: number): number {
  return ((index % COUNT) + COUNT) % COUNT;
}

/**
 * Writes one card's position straight to the DOM. Called for every card on
 * every pointermove, so it must not go through React — thirty state updates a
 * second to move six transforms is exactly the trade `Thumbstick.tsx` avoids
 * by driving its live position through the element instead.
 */
function place(el: HTMLElement, p: number): void {
  const distance = Math.min(Math.abs(p), COUNT / 2);
  const slot = Math.min(Math.floor(distance), SLOTS.length - 2);
  const frac = distance - slot;
  const from = SLOTS[slot]!;
  const to = SLOTS[slot + 1]!;
  const lerp = (a: number, b: number): number => a + (b - a) * frac;
  const dir = p < 0 ? -1 : 1;

  el.style.transform =
    `translate3d(${dir * lerp(from.x, to.x)}%, ${lerp(from.y, to.y)}%, 0)` +
    ` rotate(${dir * lerp(from.tilt, to.tilt)}deg)` +
    ` scale(${lerp(from.scale, to.scale)})`;
  el.style.opacity = String(lerp(from.opacity, to.opacity));
  el.style.zIndex = String(10 - Math.round(distance));
  // Anything past the first pair of neighbours is decoration; it must not
  // swallow a tap aimed at the card in front of it.
  el.style.pointerEvents = distance > 2.2 ? 'none' : 'auto';
  // Title/tagline belong to whatever is centred. They go before the card
  // does, so a neighbour reads as art rather than as unreadable small print.
  el.style.setProperty('--body-op', String(Math.max(0, 1 - distance / 0.7)));
}

/** Below this a pointer gesture is a tap on a card, not a swipe of the row. */
const DRAG_SLOP = 6;
/** px/ms. A flick this fast advances a card even if it barely moved. */
const FLICK_SPEED = 0.5;

/**
 * The point of the lobby: everyone's in, now pick what you're playing.
 * The host chooses; everyone else watches the choice land.
 *
 * A carousel rather than a grid — one game big in the middle, its neighbours
 * small and slanted behind it — because on a phone the grid was a tall stack
 * you had to scroll past. Anyone may swipe to browse; only the host's swipe
 * changes the room, and a non-host snaps back to the host's pick whenever it
 * moves (the `selected` effect below). The server is the real gate
 * (`requireHost` in server/src/app.ts), so `canChoose` is only ever advisory.
 */
export function GamePicker({ selected, canChoose, onSelect }: Props): JSX.Element {
  const t = useT();
  const [center, setCenter] = useState(() => Math.max(0, CLIENT_GAME_IDS.indexOf(selected)));

  const trackRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    lastX: number;
    lastT: number;
    speed: number;
    active: boolean;
  } | null>(null);
  // Set while a swipe is in flight so the click it ends with doesn't also
  // count as a tap on whichever card happened to be under the finger.
  const swiped = useRef(false);
  const refocus = useRef(false);

  // Follow the room. For a non-host this is the whole story; for the host it
  // is what snaps the row back if the server refuses the change.
  useEffect(() => {
    const index = CLIENT_GAME_IDS.indexOf(selected);
    if (index >= 0) setCenter(index);
  }, [selected]);

  const layout = useCallback((position: number) => {
    for (let i = 0; i < COUNT; i++) {
      const el = cardRefs.current[i];
      if (el) place(el, wrapOffset(i - position));
    }
  }, []);

  // Runs after every render too, not just when `center` changes: React owns
  // the `style` prop and would otherwise drop the transforms written above.
  useLayoutEffect(() => {
    layout(center);
    if (refocus.current) {
      refocus.current = false;
      cardRefs.current[center]?.focus();
    }
  });

  const commit = useCallback(
    (index: number) => {
      const next = wrapIndex(index);
      const id = CLIENT_GAME_IDS[next]!;
      if (next !== center) {
        setCenter(next);
        sfx.click();
      }
      if (canChoose && id !== selected) onSelect(id);
    },
    [canChoose, center, onSelect, selected],
  );

  const cardWidth = (): number => cardRefs.current[center]?.offsetWidth || 260;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    swiped.current = false;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      lastT: event.timeStamp,
      speed: 0,
      active: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;

    const dx = event.clientX - state.startX;
    if (!state.active) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      // Capture only once this is definitely a horizontal swipe. Vertical
      // stays with the browser: `.picker` is `touch-action: pan-y`, so the
      // page still scrolls under the carousel and we get a pointercancel.
      state.active = true;
      swiped.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      trackRef.current?.classList.add('picker__track--dragging');
    }

    const dt = event.timeStamp - state.lastT;
    if (dt > 0) state.speed = (event.clientX - state.lastX) / dt;
    state.lastX = event.clientX;
    state.lastT = event.timeStamp;

    layout(center - dx / cardWidth());
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!state.active) return;

    trackRef.current?.classList.remove('picker__track--dragging');
    const moved = -(state.lastX - state.startX) / cardWidth();
    const target =
      Math.abs(state.speed) > FLICK_SPEED
        ? center + (state.speed < 0 ? 1 : -1)
        : center + Math.round(moved);

    if (wrapIndex(target) === center) layout(center);
    commit(target);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!state.active) return;
    trackRef.current?.classList.remove('picker__track--dragging');
    layout(center);
  };

  const step = (delta: number): void => {
    refocus.current = trackRef.current?.contains(document.activeElement) ?? false;
    commit(center + delta);
  };

  return (
    <div className="picker">
      <div
        ref={trackRef}
        className="picker__track"
        role="radiogroup"
        aria-label={t.chooseAGame}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={onPointerCancel}
        onKeyDown={(event) => {
          const keys: Record<string, number | undefined> = {
            ArrowRight: center + 1,
            ArrowLeft: center - 1,
            Home: 0,
            End: COUNT - 1,
          };
          const target = keys[event.key];
          if (target === undefined) return;
          event.preventDefault();
          refocus.current = true;
          commit(target);
        }}
      >
        {CLIENT_GAME_IDS.map((id, index) => {
          const game = CLIENT_GAMES[id];
          const isSelected = id === selected;
          const BoxArt = game.BoxArt;

          return (
            <button
              key={id}
              ref={(el) => {
                cardRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={index === center ? 0 : -1}
              className={`gamecard${isSelected ? ' gamecard--on' : ''}`}
              style={{ '--accent': game.accent } as CSSProperties}
              onClick={() => {
                // A swipe ends in a click on whatever card was under the
                // finger. Consume the flag rather than only clearing it on
                // the next pointerdown, so a swipe that ends over nothing
                // can't leave it set and eat the tap after it.
                const afterSwipe = swiped.current;
                swiped.current = false;
                if (afterSwipe || index === center) return;
                commit(index);
              }}
            >
              <span className="gamecard__art">
                <BoxArt />
              </span>
              <span className="gamecard__body">
                <span className="gamecard__name">{t.games[id].name}</span>
                <span className="gamecard__tagline">{t.games[id].tagline}</span>
                <span className="gamecard__players">
                  {t.playersRange(game.meta.minPlayers, game.meta.maxPlayers)}
                </span>
              </span>
              {isSelected && <span className="gamecard__badge">{t.playingThis}</span>}
            </button>
          );
        })}
      </div>

      <div className="picker__nav">
        <button
          type="button"
          className="picker__arrow"
          aria-label={t.prevGame}
          onClick={() => step(-1)}
        >
          <Chevron dir="prev" />
        </button>

        <div className="picker__dots">
          {CLIENT_GAME_IDS.map((id, index) => (
            <button
              key={id}
              type="button"
              className={`picker__dot${index === center ? ' picker__dot--on' : ''}`}
              aria-label={t.games[id].name}
              onClick={() => {
                refocus.current = false;
                commit(index);
              }}
            />
          ))}
        </div>

        <button
          type="button"
          className="picker__arrow"
          aria-label={t.nextGame}
          onClick={() => step(1)}
        >
          <Chevron dir="next" />
        </button>
      </div>
    </div>
  );
}

/** Physical direction, not logical: the row itself never mirrors under RTL. */
function Chevron({ dir }: { dir: 'prev' | 'next' }): JSX.Element {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points={dir === 'prev' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
    </svg>
  );
}
