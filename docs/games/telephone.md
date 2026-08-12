# Broken Telephone

All contribution content is secret until reveal. Broadcast snapshots contain only phase/HUD data during play and the revealed prefix during the album; assignments, immediate predecessors, and drafts use `privateFor`. Hearts are deliberately public during the album.

The seeded assignment ring passes each chain one position per step. Thus every 3–8 player chain gets one contribution from every player. The chosen 2-player format is prompt → drawing.

Drawing deliberately reuses Skribbl's ink document, canvas, toolbar, pointer batching, palette, validation, and touch behavior. Draft ink is recovered once through `privateCatchUpFor`, never broadcast or resent at snapshot cadence.

Every revealed contribution — prompt, guess, or drawing — can receive a public heart from every player except its author. Each heart is one point for the author, and snapshots include the seats behind the hearts so the client can show their avatars immediately. There are no voter points, rating tiers, or top-entry bonuses.

The reveal snapshot grows by one contribution every two seconds. The client renders that prefix as an alternating chat and keeps every revealed message heartable until `chainComplete`; likes update scores immediately. The chat scrolls to the newest message while the full conversation remains available to scroll back through.

Telephone owns a fixed-height shell like Skribbl. Its drawing board must preserve the shared canvas's 4:3 ratio in portrait and short landscape, and its custom header must reserve `--chrome-gutter` so the microphone never sits under the fixed options/pause/fullscreen controls.
