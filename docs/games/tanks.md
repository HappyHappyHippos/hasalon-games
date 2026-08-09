# Tank Trouble

Implementation notes for `packages/shared/src/games/tanks/` and
`packages/client/src/games/tanks/`. Read this before changing anything
in either directory.

**The arena is a wall lattice, not a tilemap.** `tanks/types.ts:Maze` is two
`Uint8Array`s of cell *edges*. Every wall is therefore an axis-aligned segment at
a known coordinate, which is what makes shell reflection exact and tank collision
a lookup rather than a broadphase. Almost everything else follows from it.

**Generation cannot fail, by construction** (`tanks/maze.ts`): a randomised-DFS
spanning tree is connected by definition, and the braid pass only *removes*
walls, which cannot disconnect anything. So there is no generate-and-retry loop.
`validateMaze` and `fallbackMaze` exist to prove that in tests and to guard a
live match, not because generation is expected to misbehave. `BRAID_FRACTION` is
the one number that decides whether the arena plays like Tank Trouble or like a
hedge maze — a perfect maze is all dead ends with nowhere to circle.

**Shells march the lattice** (`tanks/ballistics.ts`), they do not integrate. Three
things in that file are load-bearing and all three were found by the tests:

- The crossed axis is **assigned** to the grid line, not integrated onto it.
  `pos + vel * ((line - pos) / vel)` does not land exactly on `line`, and the
  residue accumulates until a shell sits a hair past a wall and walks out of the
  arena.
- The *un*-crossed axis is clamped so it cannot slip past its own next line at a
  corner, for the same reason.
- The crossing test is `t <= remaining`, not `<`. A shell landing exactly on a
  line as the tick runs out would otherwise arrive untested, and the next march —
  which treats "sitting on a line" as meaning the next one is a full cell away —
  skips that wall entirely.

**The maze is never in the snapshot.** It is deterministic from `(matchSeed,
round)`, so the snapshot carries `az`/`aw`/`ah` and the client regenerates and
memoises. A mid-round joiner gets the arena from the first frame they receive.

Tank-vs-tank shoving is the one place prediction is not exact — the predictor
only knows the others as of the last snapshot. `PositionSmoother` absorbs it;
don't add rollback for a shove.
