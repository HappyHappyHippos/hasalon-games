# Gravity Guy

Implementation notes for `packages/shared/src/games/gravity/` and
`packages/client/src/games/gravity/`. Read this before changing anything
in either directory.

**Everyone runs right at the same speed**, and `speedAt(distance, pace)` is a
pure function of distance rather than of anyone's input. That single decision
buys a shared camera, nobody off screen, no falling behind, and a client that can
extrapolate x exactly. Don't make run speed per-player.

Vertical motion depends only on your own body, your own button and static
geometry, so prediction is genuinely exact here — expect corrections to be
invisible, and treat a visible one as a bug.

`GRAVITY` is deliberately enormous (a full-height crossing takes ~0.29 s). At
gentle gravity a flip is a swan dive, every gap has to be telegraphed most of a
screen ahead, and the game stops being about reflexes.

**Chunks are ASCII art** (`gravity/chunks.ts`) on a 7×8 tile grid, so editing the
level design is editing the picture. One invariant makes assembly safe and
`validateChunk` enforces it: *the first and last column of every chunk are a solid
ceiling and floor with clear air between*. That is the whole seam rule — any
chunk may follow any other, and pairwise entry/exit matching buys nothing.
Inside a chunk, a floor gap and a ceiling gap never overlap and always have a
both-solid column between them.

`track.test.ts` runs a greedy bot — one tick of lookahead on both futures, no
knowledge of the layout — over every seed and pace. If that bot cannot finish, a
person cannot either, and a new chunk that breaks is caught immediately.
