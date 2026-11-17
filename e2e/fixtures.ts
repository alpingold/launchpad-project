/**
 * The browser tests' own `test`: Playwright's, with the browser profile as a project option. Every
 * test runs twice per browser: in a fresh profile, as Playwright's tests normally do, and in a saved
 * profile, as a real visitor's browser is. The fresh profile once hid a store that WebKit keeps for a
 * sandboxed worker in a saved profile only.
 */
import { test as base, type BrowserContext } from "@playwright/test";

export type Profile = "fresh" | "saved";

export const test = base.extend<{
  profile: Profile;
  restart: () => Promise<BrowserContext>;
}>({
  profile: ["fresh", { option: true }],
  context: async ({ profile, browser, browserName, playwright }, use, info) => {
    const context = profile === "fresh" ? await browser.newContext() : await playwright[browserName].launchPersistentContext(info.outputPath("profile"));
    await use(context);
    await context.close();
  },
  /**
   * Closes the browser and opens it again on the same profile: a restart, for a saved profile. A
   * fresh profile starts empty, as a new one would.
   */
  restart: async ({ context, profile, browser, browserName, playwright }, use, info) => {
    let current = context;
    const opened: BrowserContext[] = [];
    await use(async () => {
      await current.close();
      current = profile === "fresh" ? await browser.newContext() : await playwright[browserName].launchPersistentContext(info.outputPath("profile"));
      opened.push(current);
      return current;
    });
    for (const again of opened) await again.close();
  },
});

export { expect } from "@playwright/test";
