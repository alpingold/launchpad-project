import { test as base, expect, devices } from '@playwright/test';

/**
 * A `test` with two helpers for opening people in a room.
 *
 * Every person gets their own browser *context*: separate cookies and sessionStorage,
 * like a separate device. All contexts are closed automatically when the test ends.
 */
export const test = base.extend({
  people: async ({ browser }, use) => {
    const contexts = [];

    async function newPage(options) {
      const context = await browser.newContext(options);
      contexts.push(context);
      const page = await context.newPage();
      // Our pages use window.confirm() for "End room", "Leave room" and kick: click OK.
      page.on('dialog', (dialog) => dialog.accept());
      return { context, page };
    }

    const people = {
      /**
       * Opens the host screen and waits for a room code.
       * With `gameOptions`, every host:start_game this page sends gets those options added
       * (e.g. { rounds: 1 } for a short game), without any test-only code in the app.
       */
      async host({ gameOptions } = {}) {
        const { context, page } = await newPage();
        if (gameOptions) await addGameOptions(page, gameOptions);
        // Hosting needs an account. context.request shares this browser context's cookies,
        // so signing up here logs the page in too.
        const res = await context.request.post('/api/signup', {
          data: { username: uniqueUsername(), password: 'test-password-123' },
        });
        expect(res.status()).toBe(201);
        await page.goto('/host');
        const codeEl = page.locator('.room-code');
        await expect(codeEl).toHaveText(/^[A-Z]{4}$/);
        return { context, page, code: await codeEl.textContent() };
      },

      /**
       * Opens the join page on a phone-sized screen and joins `code` as `name`.
       * With `controllable: true`, also returns `network` to cut, restore, hold or release its connection.
       */
      async player(code, name, { expectJoined = true, controllable = false } = {}) {
        const { context, page } = await newPage({ ...devices['Pixel 7'] });
        const network = controllable ? await controlWebSockets(page) : null;
        await page.goto('/join');
        await page.getByLabel('Room code').fill(code);
        await page.getByLabel('Your name').fill(name);
        await page.getByRole('button', { name: 'Join' }).click();
        if (expectJoined) await expect(page.getByRole('heading', { name: "You're in!" })).toBeVisible();
        return { context, page, network };
      },
    };

    await use(people);
    for (const context of contexts) await context.close();
  },
});

export { expect };

let usernameCounter = 0;
/** A username no other test (or parallel worker) has used. */
export function uniqueUsername() {
  usernameCounter++;
  return `h${process.pid % 100000}_${usernameCounter}`;
}

/**
 * Puts the page's WebSocket connections through Playwright so a test can simulate the
 * network dropping. (context.setOffline doesn't do this: Chromium's offline mode blocks new
 * requests but leaves an already-open WebSocket alone.)
 *
 * cut():     closes the current connection on both ends, and refuses new ones
 * restore(): lets new connections through again, so the page's auto-reconnect succeeds
 * hold():    keeps the server's messages from reaching the page (they wait in a queue)
 * release(): delivers the held messages, in order, and stops holding
 */
async function controlWebSockets(page) {
  const live = [];
  let blocked = false;
  let holding = false;
  const held = [];
  await page.routeWebSocket(/\/ws$/, (ws) => {
    if (blocked) {
      ws.close();
      return;
    }
    const server = ws.connectToServer(); // page → server messages pass through unchanged
    server.onMessage((message) => (holding ? held.push({ ws, message }) : ws.send(message)));
    live.push({ ws, server });
  });
  return {
    hold() {
      holding = true;
    },
    release() {
      holding = false;
      for (const { ws, message } of held.splice(0)) ws.send(message);
    },
    async cut() {
      blocked = true;
      for (const { ws, server } of live.splice(0)) {
        await server.close();
        await ws.close();
      }
    },
    restore() {
      blocked = false;
    },
  };
}

/** Rewrites outgoing host:start_game messages to include `options`. */
async function addGameOptions(page, options) {
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer(); // server → page messages pass through untouched
    ws.onMessage((message) => {
      const msg = JSON.parse(message);
      if (msg.type === 'host:start_game') msg.options = { ...msg.options, ...options };
      server.send(JSON.stringify(msg));
    });
  });
}

/** The host screen's player list items. */
export function hostPlayers(hostPage) {
  return hostPage.locator('.player-list li');
}
