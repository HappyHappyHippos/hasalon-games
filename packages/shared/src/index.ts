/**
 * The room-level surface: everything that is true regardless of which game is
 * being played. Game internals live behind their own entry points
 * (`@mg/shared/achtung`, `@mg/shared/gunmayhem`, …, one per game in
 * `package.json`'s `exports`) because all six export plenty of same-named
 * things — `createState`, `stepTick`, `ARENA_WIDTH` — and flattening them into
 * one namespace would silently drop the collisions.
 */
export * from './engine';
export * from './players';
export * from './appearance';
export * from './protocol';
export * from './roomTypes';
export * from './gameModule';
export * from './registry';
export * from './scoring';
export * from './series';
