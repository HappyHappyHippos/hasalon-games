import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_PORT = process.env.SERVER_PORT ?? '3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Listen on all interfaces so a phone on the same wifi can join.
    host: true,
    proxy: {
      '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true },
      '/healthz': { target: `http://localhost:${SERVER_PORT}` },
      // Voice chat's ICE/TURN config. Served by the game server because it
      // carries credentials that must not be in the client bundle.
      '/ice': { target: `http://localhost:${SERVER_PORT}` },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
