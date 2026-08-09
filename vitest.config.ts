import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `.test.tsx` too, so a component test is not silently skipped if one is
    // ever added. There are none today — the repo's position is to extract
    // logic into pure functions and test those in plain node.
    include: ['packages/**/*.test.{ts,tsx}'],
    environment: 'node',
    /**
     * 60s, not the 20s this used to be.
     *
     * Two tests are CPU-bound property sweeps rather than I/O: `trap.test.ts`
     * walks every walkable position on every Gun Mayhem stage, and
     * `track.test.ts` runs a greedy bot over every Gravity Guy seed and pace.
     * Both take 8-13s on an idle machine — comfortably inside 20s until you run
     * a subset, at which point vitest gives each file more workers per core,
     * they slow down, and they cross the limit. The result was that the *fast*
     * lane failed more often than the full one, for reasons having nothing to
     * do with the change under test.
     *
     * The server integration test (`app.test.ts`) drives a real server over a
     * real socket and is the other reason this is not small.
     */
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
