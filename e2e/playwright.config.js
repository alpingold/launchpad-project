import { defineConfig, devices } from '@playwright/test';

// Browser tests start their OWN copy of the server and client on different ports
// (3100 / 5174), so they never touch rooms on your dev servers (3000 / 5173),
// and you can run them while developing.
const SERVER_PORT = 3100;
const CLIENT_PORT = 5174;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Tests share one server but each creates its own room, so they can run in parallel.
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    // On failure, keep a trace (screenshots + DOM + network at each step) to inspect
    // with `npm run report`.
    trace: 'retain-on-failure',
  },
  projects: [
    // A desktop browser for the host screen; player pages use a phone-sized viewport
    // set inside the tests.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'node src/index.js',
      cwd: '../server',
      url: `http://localhost:${SERVER_PORT}/api/health`,
      env: { PORT: String(SERVER_PORT), HOST_GRACE_MS: '2000', PLAYER_GRACE_MS: '2000' },
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${CLIENT_PORT} --strictPort`,
      cwd: '../client',
      url: `http://localhost:${CLIENT_PORT}`,
      env: { API_PORT: String(SERVER_PORT) },
      reuseExistingServer: false,
    },
  ],
});
