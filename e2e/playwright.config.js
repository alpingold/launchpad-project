import { defineConfig, devices } from '@playwright/test';

// Browser tests start their OWN copy of the server and client on different ports
// (3100 / 5174), so they never touch rooms on your dev servers (3000 / 5173),
// and you can run them while developing.
// E2E_SERVER_PORT / E2E_CLIENT_PORT move them, so two copies of the tests (e.g. in two git
// worktrees) can run at the same time.
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 3100);
const CLIENT_PORT = Number(process.env.E2E_CLIENT_PORT ?? 5174);

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
      // The real server with a fake AI generator and a test admin account (server/testServer.js).
      command: 'node server/testServer.js',
      url: `http://localhost:${SERVER_PORT}/api/health`,
      env: {
        PORT: String(SERVER_PORT),
        HOST_GRACE_MS: '2000',
        PLAYER_GRACE_MS: '2000',
        // A throwaway in-memory database: test accounts never touch your real database file.
        DB_PATH: ':memory:',
        // Every test host signs up from 127.0.0.1, so lift the per-address sign-up limit.
        AUTH_ATTEMPTS_PER_WINDOW: '100000',
        REPORTS_PER_WINDOW: '100000',
        // AI games on, using the fake generator (no Docker or API key needed).
        GENERATION_ENABLED: '1',
      },
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
