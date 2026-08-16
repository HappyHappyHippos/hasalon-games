# Broken Telephone

All contribution content is secret until reveal. Broadcast snapshots contain only phase/HUD data during play and the revealed prefix during the album; assignments, immediate predecessors, and drafts use `privateFor`. Hearts are deliberately public during the album.

The seeded assignment ring passes each chain one position per step. Thus every 3–8 player chain gets one contribution from every player. The chosen 2-player format is prompt → drawing.

Drawing deliberately reuses Skribbl's ink document, canvas, toolbar, pointer batching, palette, validation, and touch behavior. Draft ink is recovered once through `privateCatchUpFor`, never broadcast or resent at snapshot cadence.

Every revealed contribution — prompt, guess, or drawing — can receive a public heart from every player except its author. Each heart is one point for the author, and snapshots include the seats behind the hearts so the client can show their avatars immediately. There are no voter points, rating tiers, or top-entry bonuses.

The reveal snapshot grows by one contribution every two seconds. The client renders that prefix as a centred alternating chat and keeps every revealed message heartable until `chainComplete`; likes update scores immediately. The chat scrolls to the newest message while the full conversation remains available to scroll back through. Its scroll gutter is reserved on both sides so appearing scrollbars cannot push the result column off centre.

Telephone owns a fixed-height shell like Skribbl. Its drawing board must preserve the shared canvas's 4:3 ratio in portrait and short landscape, and its custom header must reserve `--chrome-gutter` so the microphone never sits under the fixed options/pause/fullscreen controls. Every phase also reserves all four physical safe-area insets; landscape camera cutouts can be on either side regardless of document direction.

Three landscape rules, each of which was a bug first:

- **The reveal phase stretches; every other phase centres.** `.telephone__phase` is a centred grid, and a centred grid sizes its row to its content — so `.telephone__album`'s `height: 100%` resolved against the height of the chain rather than the height of the screen, `.telephone__chat`'s `flex: 1; min-height: 0` had nothing to shrink against, and the phase's `overflow: hidden` silently cut the conversation off. A finished chain could not be scrolled back through at all, worst in landscape where the least of it fits. `.telephone__phase--reveal` sets `align-items: stretch` to give the album a real height to divide up.
- **Landscape pads its two sides equally, to the larger of the two insets.** A landscape cutout is on one side only; padding each side by its own inset clears the notch and then leans everything centred inside it by half the difference. That is why the reveal column read as off-centre in landscape and fine in portrait.
- **The album heading reserves `--chrome-gutter` on both sides in landscape.** The fixed chrome buttons are viewport-anchored near the top, the landscape header is only 52px tall, and it is removed entirely once the match is over — so they land on the heading. Reserving both sides keeps it clear *and* centred. The chat below is left full width; it starts under the buttons rather than beside them.

**The soft keyboard is an overlay, and moving out from under it is the app's job.** `ui/mobileViewport.ts` asks Chromium for `virtualKeyboard.overlaysContent`, which stops the whole game shell reflowing upward — and means nothing reflows at all, so an input near the bottom ends up beneath the keyboard. `enableKeyboardInsetTracking` publishes the covered height as `--keyboard-inset` (from `virtualKeyboard.boundingRect` on Chromium, from the shrunken `visualViewport` on Safari, whichever is larger), and the composer adds it to the phase's bottom padding. It is `0px` with the keyboard down, so it needs no media query and costs nothing anywhere else. Skribbl's guess bar and the Meme Machine caption fields read the same variable.
