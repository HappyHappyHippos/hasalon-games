# Skribbl

Implementation notes for `packages/shared/src/games/skribbl/` and
`packages/client/src/games/skribbl/`. Read this before changing anything
in either directory.

**The word is the whole design constraint.** `SkribblState.word` never leaves the
server. The snapshot carries only `masked` — the pattern with unrevealed letters
replaced — computed server-side, so a guesser is never sent letters they have not
earned. The drawer gets the real word through `privateFor` (see above). There is
deliberately no variant that ships the word plus a count of how much to hide.

Three tests guard that, and they are the ones to keep green: the mask is checked
at every reveal step for every word in both lists; `privateFor` is asserted to
answer the drawer and `null` for everyone else; and an end-to-end test in
`app.test.ts` reads back a guesser's entire received-frame buffer and greps it.

**Ink** is a flat op stream in the snapshot (`OP_BEGIN`/`OP_TO`/`OP_CLEAR` in
`skribbl/constants.ts`), drained as it is sent — so `droppableSnapshots: false`,
same as Achtung's trail. Two paths it cannot use, both learned the hard way:

- **not `mirrorHud`** — that returns early inside its 120 ms throttle, which
  would silently drop most strokes. `socket.ts` hands Skribbl snapshots to
  `games/skribbl/inkBus.ts` *before* the throttle instead.
- **not `SnapshotFeed`** — it keeps one second of history, so a tab backgrounded
  for two seconds would lose that ink permanently. The client accumulates into an
  offscreen canvas that `CanvasStage.begin()` never wipes.

Undo is a clear plus a full replay, because a delta already accumulated on
everyone's surface cannot be un-drawn.

**Guess matching** (`skribbl/guess.ts`) folds Hebrew final letters, strips
niqqud, and — the one that decides whether the Hebrew half feels broken — treats
interior vav and yod as optional, so שלחן and שולחן both count. Which spelling
someone types is habit rather than knowledge, and rejecting either is rejecting a
right answer. Only for words of four or more normalised letters, or the fold
equates שר and שיר.

**Language is a room setting** (`SkribblConfig.lang`), because the server has no
other notion of one — `lang` is client-only everywhere else. The settings panel
patches it once to match the host's UI language.

Word lists are `words.he.ts` / `words.en.ts`, tagged easy/medium/hard, one word
per line so growing them is appending. The three choices are always one per tier.
A test asserts no duplicates within a language — watch for homographs, which is
how ביצה (egg / swamp) and ספר (book / barber) got listed twice.

Known limit: a player joining **mid-round** sees the drawing from the moment they
arrived, because catch-up replays the last snapshot and for a delta format that is
nearly empty. Reconnects are fine — the client keeps its surface across a socket
reopen.
