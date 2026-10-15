import { test, expect } from './helpers.js';

// Frame games (plan §13): each game is its own page in a sandboxed iframe. The big screen's
// frame is the referee; phones' frames are controllers; the server only relays events.
// These use the test-only Probe game (e2e/server/probe.html).

const frame = (page) => page.frameLocator('iframe.game-frame');

/** A room with the host and one phone, playing Probe. */
async function startProbe(people, { controllable = false } = {}) {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex', { controllable });
  await host.page.getByRole('combobox', { name: 'Game' }).selectOption('probe');
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
  await expect(host.page).toHaveURL('/host'); // still on our page
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

test('the host can stop a game, and a big-screen reload stops it too (F0)', async ({ people }) => {
  const { host, alex } = await startProbe(people);
  await host.page.getByRole('button', { name: 'Stop game' }).click();
  await expect(alex.page.getByRole('heading', { name: "You're in!" })).toBeVisible();
  await expect(host.page.getByRole('button', { name: 'Start game' })).toBeVisible();

  await host.page.getByRole('combobox', { name: 'Game' }).selectOption('probe'); // the picker starts over
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(frame(alex.page).getByRole('heading', { name: 'Phone Alex' })).toBeVisible();
  await host.page.reload();
  await expect(host.page.getByText('This page reloaded during a game, so the game was stopped.')).toBeVisible();
  await expect(alex.page.getByRole('heading', { name: "You're in!" })).toBeVisible();
});
