import { readFileSync } from 'node:fs';
import { defineConfig, minifySync } from 'vite';
import react from '@vitejs/plugin-react';

// In development, Vite serves the React app on :5173 and forwards API and
// WebSocket traffic to the Express server on :3000. The browser only ever
// talks to one origin, which keeps cookies (M7) and Origin checks simple.
// API_PORT lets the browser tests point at their own server instead of your dev server.
const apiPort = process.env.API_PORT || 3000;

/**
 * The built site carries no comments: they're notes for us, not for visitors. Vite already
 * minifies the app's code; this covers the two things it leaves as written:
 *   - index.html's <!-- --> comments
 *   - the game kit (src/game/frame), which goes into the bundle as text (`?raw`) for the
 *     game's iframe. Its names stay as they are, so an error from a game still reads clearly.
 * Only for the build: in development everything stays as written.
 */
function stripComments() {
  return {
    name: 'boilergames-strip-comments',
    apply: 'build',
    enforce: 'pre',
    transformIndexHtml(html) {
      return html.replace(/[ \t]*<!--[\s\S]*?-->\n?/g, '');
    },
    load(id) {
      const match = /^(.*\/src\/game\/frame\/[^/]+\.(js|css))\?raw$/.exec(id);
      if (!match) return null;
      const [, file, kind] = match;
      const source = readFileSync(file, 'utf8');
      let text;
      if (kind === 'js') {
        const result = minifySync(file, source, { compress: false, mangle: false });
        if (result.errors.length > 0) throw new Error(`Can't minify ${file}: ${result.errors[0].message}`);
        text = result.code;
      } else {
        text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\n/g, '\n');
      }
      return `export default ${JSON.stringify(text)};`;
    },
  };
}

export default defineConfig({
  plugins: [stripComments(), react()],
  server: {
    proxy: {
      '/api': `http://localhost:${apiPort}`,
      '/ws': { target: `ws://localhost:${apiPort}`, ws: true },
    },
  },
});
