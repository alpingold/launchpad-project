import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, Vite serves the React app on :5173 and forwards API and
// WebSocket traffic to the Express server on :3000. The browser only ever
// talks to one origin, which keeps cookies (M7) and Origin checks simple.
// API_PORT lets the browser tests point at their own server instead of your dev server.
const apiPort = process.env.API_PORT || 3000;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://localhost:${apiPort}`,
      '/ws': { target: `ws://localhost:${apiPort}`, ws: true },
    },
  },
});
