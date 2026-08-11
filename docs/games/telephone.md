# Broken Telephone

All contribution content is secret until reveal. Broadcast snapshots contain only phase/HUD data during play and the revealed prefix during the album; assignments, immediate predecessors, drafts, and ballots use `privateFor`.

The seeded assignment ring passes each chain one position per step. Thus every 3–8 player chain gets one contribution from every player. The chosen 2-player format is prompt → drawing.

Drawing deliberately reuses Skribbl's ink document, canvas, toolbar, pointer batching, palette, validation, and touch behavior. Draft ink is recovered once through `privateCatchUpFor`, never broadcast or resent at snapshot cadence.

Drawing votes reuse Meme Machine's Good/Meh/Bad scoring, author exclusion, disconnect-aware denominator, ballot points, unanimous bonus, and top-entry bonus.
