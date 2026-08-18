# Broken Telephone

All contribution content is secret until reveal. Broadcast snapshots contain only phase/HUD data during play and the revealed prefix during the album; assignments, immediate predecessors, and drafts use `privateFor`. Hearts are deliberately public during the album.

The seeded assignment ring passes each chain one position per step. Thus every 3–8 player chain gets one contribution from every player. The chosen 2-player format is prompt → drawing.

Drawing deliberately reuses Skribbl's ink document, canvas, toolbar, pointer batching, palette, validation, and touch behavior. Draft ink is recovered once through `privateCatchUpFor`, never broadcast or resent at snapshot cadence.

Every revealed contribution — prompt, guess, or drawing — can receive a public heart from every player except its author. Each heart is one point for the author, and snapshots include the seats behind the hearts so the client can show their avatars immediately. There are no voter points, rating tiers, or top-entry bonuses.

## The board is the screen

The drawing phase draws **nothing above or below the sheet**. The board fills the
phase edge to edge — a bar at the top and a bar at the bottom is how a phone ends
up with a third of its screen to draw on — and the clock, the prompt, the tools,
the zoom buttons and the done button all float over it. The paper colour is also
the letterbox colour, so the shared 4:3 document (which cannot change: every
player has to be looking at the same coordinates) reads as edge-to-edge paper
rather than a postcard on a table. In portrait the drawable strip sits in the
middle of the sheet and the floating controls land on the margins, clear of it.

Four things about that arrangement are load-bearing:

- **Controls inside the drawing surface have to opt out of the pen.** They are
  children of the element `attachDrawInput` listens on, so a tap on Undo would
  otherwise leave a dot under the button that undid it. They carry
  `data-draw-ignore` and `input.ts:isDrawIgnored` checks the target. React's
  `stopPropagation` cannot do this job — React delegates at the root, so the
  native listener has already run by the time a synthetic handler could stop it.
- **The second finger cancels the stroke the first one started.** A pinch begins
  as an ordinary `pointerdown`, so there is already a line on the sheet by the
  time the second finger lands; `viewInput.ts` undoes it, over the wire as well
  as locally, because ink is cumulative and nothing can un-send it.
- **Drawing stays suspended until every finger is off the glass**, not until the
  pinch drops below two. Resuming a stroke from wherever the remaining finger
  happens to be draws a line straight across the drawing.
- **The full-bleed padding rule is written `.telephone--draw .telephone__phase--draw`.**
  The phone and landscape blocks re-pad `.telephone__phase` at equal
  specificity later in the file and would win on source order, which is exactly
  how the edge-to-edge board once ended up with an 8px frame around it.

Zoom lives in `game/canvasView.ts` (pure view arithmetic, tested) applied by
`CanvasStage.begin`. At `zoom: 1` it computes byte-identical numbers to the
letterbox every game has always had, so a game that never touches `stage.view`
cannot tell it exists.

## Drawings are shown cropped to their ink

Every drawing in this game is looked at second-hand, and almost none of them
fill the sheet. `skribbl/inkBounds.ts` walks the op stream for the rectangle the
ink actually occupies; the preview frames that rectangle and takes its *shape*
from it (`inkAspect`), so a wide doodle gets a wide bubble instead of a 4:3 box
with white bands. Bounds are read from the ops rather than the pixels because
the ops are already in hand, a nine-message chain of `getImageData` calls is
not free, and the ops are right before the canvas has painted anything — which
is exactly when a preview first mounts. A clear resets the bounds (undo is sent
as a clear plus every surviving stroke), and a fill with no strokes gets the
whole sheet, since a flood fill only records where it started.

## The album

The reveal snapshot grows by one contribution every two seconds. The client renders that prefix as a centred alternating chat and keeps every revealed message heartable until `chainComplete`; likes update scores immediately. Its scroll gutter is reserved on both sides so appearing scrollbars cannot push the result column off centre.

**It follows the tail only while the chain is still growing, and stops the
moment somebody scrolls up.** Both halves were bugs: yanking a reader back to
the bottom every time a heart landed made a finished chain impossible to look
back through, which is the whole point of the phase.

At `matchOver` the album is *behind* the champion card. That card takes an
`extra` slot (see `MatchOverlays.tsx`) holding a button that steps it aside, and
a fixed "back to the results" button brings it back. Meme Machine's end-of-match
gallery had the identical problem and uses the identical mechanism.

Telephone owns a fixed-height shell like Skribbl. Its custom header must reserve `--chrome-gutter` so the microphone never sits under the fixed options/pause/fullscreen controls. Every phase also reserves all four physical safe-area insets; landscape camera cutouts can be on either side regardless of document direction.

Layout rules, each of which was a bug first:

- **Nothing centres with `place-items: center` in a scroller.** A centred track shorter than its content overflows in *both* directions, and the half above the start edge cannot be scrolled to — it is simply clipped. `.telephone__phase` is one `1fr` row instead: full height when the content fits (so the composer's `min-height: 100%` has something definite to resolve against and can centre itself), growing to the content when it does not (so the overflow lands below the start edge where the scroller can reach it). A content-sized row makes that `100%` circular and it silently collapses to `auto`, which is what pinned the write phase to the top of the screen.
- **Landscape pads its two sides equally, to the larger of the two insets.** A landscape cutout is on one side only; padding each side by its own inset clears the notch and then leans everything centred inside it by half the difference. That is why the reveal column read as off-centre in landscape and fine in portrait.
- **The album heading reserves `--chrome-gutter` on both sides in landscape.** The fixed chrome buttons are viewport-anchored near the top, the landscape header is only 50px tall, and it is removed entirely once the match is over — so they land on the heading. Reserving both sides keeps it clear *and* centred. The chat below is left full width; it starts under the buttons rather than beside them.
- **A floating element centres with `inset-inline: 0` and `margin-inline: auto`.** `inset-inline-start: 50%` with a `translateX(-50%)` mixes a logical inset with a physical transform: the two agree in English and cancel out wrong in Hebrew, which put the prompt banner half off the screen.

## The soft keyboard

**It is an overlay, and moving out from under it is the app's job.** `ui/mobileViewport.ts` asks Chromium for `virtualKeyboard.overlaysContent`, which stops the whole game shell reflowing upward.

`enableKeyboardInsetTracking` publishes **how much of the app shell the keyboard
covers** — not how tall the keyboard is, and that distinction is the bug this
used to have. `.app` is sized from the visual viewport, so on any browser that
*shrinks* that viewport for the keyboard (Safari, and Chromium without the
overlay) the shell has already moved out of the way by itself; publishing the
full keyboard height there made every composer reserve a second keyboard's worth
of padding inside an already-correct shell and shoved the field being typed into
off the top. So the tracker measures where the shell ends, measures where the
keyboard begins, and publishes the overlap: the whole keyboard on Chromium with
`overlaysContent`, and zero on iOS. One formula, no `isIOSDevice()` branch.

Reserving the space is only half of it. `keepFocusedFieldVisible` is the other
half: on focus, and again whenever the keyboard geometry settles while a field
is still focused, it scrolls the focused field back into view. Chromium with
`overlaysContent` deliberately does nothing on its own — it has been told the
app handles it.

Skribbl's guess bar and the Meme Machine caption fields read the same variable. Skribbl's word banner is also a button for a guesser: tapping the blanks focuses the guess box, which is the only way a mobile browser will raise the keyboard (the focus call has to happen inside the tap).
