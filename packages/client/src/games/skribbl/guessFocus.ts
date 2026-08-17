/**
 * A way for the word banner to hand focus to the guess box.
 *
 * The two live in different branches of the screen — the banner is in the
 * header, the box is at the bottom of the chat column — and threading a ref up
 * and back down through `SkribblScreen` would put a piece of DOM plumbing in
 * the middle of a component that is otherwise all game state. A module-level
 * registration is the same shape as `inkBus` next door, and it is one element,
 * because there is one guess box on screen at a time.
 *
 * The rule that makes this work at all: the focus call has to happen *inside*
 * the user's tap. Every mobile browser refuses to raise the keyboard from a
 * timer or a promise callback, so this is called straight from the click
 * handler and does nothing clever on the way.
 */
let field: HTMLInputElement | null = null;

export function registerGuessField(element: HTMLInputElement | null): void {
  field = element;
}

/** Focus the guess box, if there is one and it is accepting guesses. */
export function focusGuessField(): void {
  if (!field || field.disabled) return;
  field.focus();
}
