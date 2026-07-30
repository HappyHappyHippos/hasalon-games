import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    environment: 'node',
    // The integration test drives a real server over a real socket.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
