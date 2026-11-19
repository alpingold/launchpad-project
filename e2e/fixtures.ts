/**
 * The browser tests' own `test`: Playwright's, with the browser profile as a project option. Every
 * test runs twice per browser: in a fresh profile, as Playwright's tests normally do, and in a saved
 * profile, as a real visitor's browser is. The fresh profile once hid a store that WebKit keeps for a
 * sandboxed worker in a saved profile only.
 */
import { test as base, type BrowserContext, type BrowserContextOptions } from "@playwright/test";
import { sentMail } from "./mail.js";
import { APP } from "./origins.js";

export type Profile = "fresh" | "saved";

/** An account signed in once and shared by the tests that need one (the `signedIn` fixture). */
export interface SignedIn {
  readonly email: string;
  readonly name: string;
  /** Its session cookie: a test puts it in its own browser with `context.addCookies`. */
  readonly cookies: Awaited<ReturnType<BrowserContext["cookies"]>>;
}

export const test = base.extend<
  {
    profile: Profile;
    restart: () => Promise<BrowserContext>;
    another: (name: string, options?: BrowserContextOptions) => Promise<BrowserContext>;
  },
  { signedIn: SignedIn }
>({
  /**
   * One account per browser project, signed in once and reused by every test that only needs to be
   * signed in. One network address may ask for 50 sign-in emails an hour, and the tests of signing in
   * itself already use many, so a test that isn't about signing in shouldn't spend one.
   *
   * Signed in through a real page, in a browser of its own that is closed afterwards: the browser
   * finds the test server whichever address "localhost" is on the machine.
   */
  signedIn: [
    async ({ browser }, use, info) => {
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const email = `shared.${info.project.name.replace(/[^a-z0-9]/g, "")}.${id}@purdue.edu`;
      const name = `S ${id}`;
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(APP);
      const post = (path: string, body: unknown) =>
        page.evaluate(
          async ([to, sent]) => (await fetch(to, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sent) })).status,
          [path, body] as const,
        );
      if ((await post("/api/sign-in", { email })) !== 200) throw new Error("the shared account's sign-in email was refused");
      const link = /http:\S+/.exec((await sentMail()).filter((message) => message.to === email).at(-1)?.text ?? "")?.[0] ?? "";
      const token = new URL(link).hash.slice(1);
      if ((await post("/api/sign-in/confirm", { token })) !== 200) throw new Error("the shared account's link didn't sign it in");
      if ((await post("/api/me/display-name", { displayName: name })) !== 200) throw new Error("the shared account's display name was refused");
      const cookies = await context.cookies();
      await context.close();
      await use({ email, name, cookies });
    },
    { scope: "worker" },
  ],
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
  /**
   * Another browser, in the same kind of profile: a phone next to the Screen. Each name gets its
   * own profile folder, so each phone is a separate device.
   */
  another: async ({ profile, browser, browserName, playwright }, use, info) => {
    const opened: BrowserContext[] = [];
    await use(async (name, options = {}) => {
      const context = profile === "fresh" ? await browser.newContext(options) : await playwright[browserName].launchPersistentContext(info.outputPath(`profile-${name}`), options);
      opened.push(context);
      return context;
    });
    for (const context of opened) await context.close();
  },
});

export { expect } from "@playwright/test";
