// The browser tests: `npm run test:e2e` at the root. Each test runs in Chromium, Firefox and WebKit,
// each in a fresh profile and a saved one.
import { defineConfig, devices } from "@playwright/test";
import type { Profile } from "./fixtures.js";

export default defineConfig<{ profile: Profile }>({
  testDir: ".",
  testMatch: "*.spec.ts",
  globalSetup: "./global-setup.ts",
  outputDir: "test-results",
  // One at a time: the servers and their request counts are shared.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  reporter: [["list"]],
  timeout: 60_000,
  // A failed test keeps its trace (every step, console message and network request) and a
  // screenshot, in e2e/test-results/, which CI uploads when a run fails.
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  // Each browser twice: a fresh profile, and a saved one, as a real visitor's browser is (see fixtures.ts).
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "chromium-saved", use: { ...devices["Desktop Chrome"], profile: "saved" } },
    { name: "firefox-saved", use: { ...devices["Desktop Firefox"], profile: "saved" } },
    { name: "webkit-saved", use: { ...devices["Desktop Safari"], profile: "saved" } },
  ],
});
