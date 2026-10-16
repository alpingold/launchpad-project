import { test, expect } from './helpers.js';

// Frame games (plan §13): each game is its own page in a sandboxed iframe. The big screen's
// frame is the referee; phones' frames are controllers; the server only relays events.
// These use the test-only Probe game (e2e/server/probe.html).

const frame = (page) => page.frameLocator('iframe.game-frame');

/** A room with the host and one phone, playing Probe. */
async function startProbe(people, { controllable = false } = {}) {
  const host = await people.host({ game: 'probe' });
  const alex = await people.player(host.code, 'Alex', { controllable });
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(frame(host.page).getByRole('heading', { name: 'Big screen' })).toBeVisible();
  await expect(frame(alex.page).getByRole('heading', { name: 'Phone Alex' })).toBeVisible();
  return { host, alex };
}

test('phones send events, the big screen answers each phone, and the game ends with a winner', async ({ people }) => {
  const { host, alex } = await startProbe(people);

  await frame(alex.page).getByRole('button', { name: 'Ping' }).click();
  await frame(alex.page).getByRole('button', { name: 'Ping' }).click();
  await expect(frame(host.page).getByText('Events: 2')).toBeVisible(); // the referee got both
  await expect(frame(host.page).getByRole('list', { name: 'Log' })).toContainText('Alex: "ping"');
  await expect(frame(alex.page).getByText('Pings: 2')).toBeVisible(); // its state, from the referee
  await expect(frame(alex.page).getByText('Alex pinged')).toBeVisible(); // a message to everyone

  await frame(alex.page).getByRole('button', { name: 'Win' }).click();
  await expect(alex.page.getByText('You won the last game!')).toBeVisible();
  await expect(host.page.getByText('Alex won the last game!')).toBeVisible();
  await expect(host.page.locator('iframe.game-frame')).toHaveCount(0);
});

test('the walls hold: no cookies, storage, network, eval or way into the page, on any screen', async ({ people }) => {
  const { host, alex } = await startProbe(people);
  const expected = ['cookie', 'localStorage', 'sessionStorage', 'parent page', 'fetch', 'outside script', 'eval', 'websocket', 'redirect the page'];
  for (const page of [host.page, alex.page]) {
    const walls = frame(page).getByRole('region', { name: 'Walls' }).getByRole('listitem');
    await expect(walls).toHaveCount(expected.length); // the async tries (fetch, script, websocket) have answered
    // Sorted: the async tries finish in any order.
    expect((await walls.allTextContents()).sort()).toEqual(expected.map((name) => `${name}: blocked`).sort());
  }
  await expect(host.page).toHaveURL('/host?game=probe'); // still on our page
  await expect(alex.page).toHaveURL('/join');
});

test('the big screen hears phones leave and come back', async ({ people }) => {
  const { host, alex } = await startProbe(people, { controllable: true });
  await alex.network.cut();
  await expect(frame(host.page).getByRole('list', { name: 'Log' })).toContainText('left: Alex');
  alex.network.restore();
  await expect(frame(host.page).getByRole('list', { name: 'Log' })).toContainText('back: Alex');
});

test('a phone that reloads mid-game gets the game and its latest state back', async ({ people }) => {
  const { host, alex } = await startProbe(people);
  await frame(alex.page).getByRole('button', { name: 'Ping' }).click();
  await expect(frame(alex.page).getByText('Pings: 1')).toBeVisible();

  await alex.page.reload();
  await expect(frame(alex.page).getByText('Pings: 1')).toBeVisible();
  await frame(alex.page).getByRole('button', { name: 'Ping' }).click();
  await expect(frame(host.page).getByText('Events: 2')).toBeVisible(); // the referee never stopped
});

test('the host can stop a game; a big screen that reloads before its game saved stops it', async ({ people }) => {
  const { host, alex } = await startProbe(people);
  await host.page.getByRole('button', { name: 'Stop game' }).click();
  await expect(alex.page.getByRole('heading', { name: "You're in!" })).toBeVisible();
  await expect(alex.page.getByText('The host stopped the game.')).toBeVisible();

  // The room is still for Probe: start it again.
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(frame(alex.page).getByRole('heading', { name: 'Phone Alex' })).toBeVisible();
  await host.page.reload(); // Probe saves after each event, and there hasn't been one
  await expect(host.page.getByText('The big screen reloaded, so the game was stopped.')).toBeVisible();
  await expect(alex.page.getByText('The big screen reloaded, so the game was stopped.')).toBeVisible();
});

test('a big screen that reloads mid-game picks up from its last save', async ({ people }) => {
  const { host, alex } = await startProbe(people);
  await frame(alex.page).getByRole('button', { name: 'Ping' }).click();
  await frame(alex.page).getByRole('button', { name: 'Ping' }).click();
  await expect(frame(host.page).getByText('Events: 2')).toBeVisible();

  await host.page.reload();
  await expect(frame(host.page).getByRole('list', { name: 'Log' })).toContainText('restored');
  await expect(frame(host.page).getByText('Events: 2')).toBeVisible();
  await frame(alex.page).getByRole('button', { name: 'Ping' }).click();
  await expect(frame(host.page).getByText('Events: 3')).toBeVisible();
  await expect(frame(alex.page).getByText('Pings: 3')).toBeVisible(); // its own count came back too
});

test('a game that hangs the big screen is stopped by the server watchdog', async ({ people }) => {
  const { alex } = await startProbe(people);
  await frame(alex.page).getByRole('button', { name: 'Hang the big screen' }).click();
  // The big screen's whole tab is frozen now; the test server's watchdog is 5 s.
  await expect(alex.page.getByText('The game stopped responding, so it was stopped.')).toBeVisible({ timeout: 15_000 });
  await expect(alex.page.getByRole('heading', { name: "You're in!" })).toBeVisible();
});

test('a game that loads another page into its frame is removed', async ({ people }) => {
  const { host, alex } = await startProbe(people);
  // On a phone: closed on that phone only.
  await frame(alex.page).getByRole('button', { name: 'Leave the frame', exact: true }).click();
  await expect(alex.page.getByText('This game tried to load another page, so it was closed on this phone.')).toBeVisible();
  await expect(alex.page.locator('iframe.game-frame')).toHaveCount(0);
  await expect(frame(host.page).getByRole('heading', { name: 'Big screen' })).toBeVisible(); // still running

  // On the big screen: the game stops for everyone.
  await alex.page.reload();
  await frame(alex.page).getByRole('button', { name: 'Big screen: leave the frame' }).click();
  await expect(host.page.getByText('The game tried to load another page, so it was stopped.')).toBeVisible();
  await expect(alex.page.getByText('The game tried to load another page, so it was stopped.')).toBeVisible();
});

test('a phone that floods is slowed down, and its connection survives', async ({ people }) => {
  const { host, alex } = await startProbe(people);
  await frame(alex.page).getByRole('button', { name: 'Flood' }).click(); // 100 events at once
  const count = frame(host.page).locator('#count');
  await expect(count).toHaveText(/Events: \d+/);
  await alex.page.waitForTimeout(500);
  const got = Number((await count.textContent()).split(': ')[1]);
  expect(got).toBeGreaterThanOrEqual(35); // about one burst's worth got through...
  expect(got).toBeLessThanOrEqual(45); // ...and the rest were refused on the phone, not at the server
  // The big screen answered every one in a few batched messages; the phone has the latest count.
  await expect(frame(alex.page).locator('#count')).toHaveText(`Pings: ${got}`);
  await alex.page.waitForTimeout(1500); // the allowance refills
  await frame(alex.page).getByRole('button', { name: 'Ping' }).click();
  await expect(count).toHaveText(`Events: ${got + 1}`);
});
