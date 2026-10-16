import { test, expect, hostPlayers } from './helpers.js';

// End-to-end lobby tests: real Chromium pages, real client, real server.
// The server runs with 2-second grace periods (see playwright.config.js) instead of 30.

test('players join and everyone sees the same live list', async ({ people }) => {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex');
  const blake = await people.player(host.code, 'Blake');

  await expect(hostPlayers(host.page)).toHaveCount(2);
  await expect(hostPlayers(host.page).nth(0)).toContainText('Alex');
  await expect(hostPlayers(host.page).nth(1)).toContainText('Blake');
  await expect(host.page.getByText('Players (2/12)')).toBeVisible();

  await expect(alex.page.locator('.player-list li')).toHaveText(['Alex (you)', 'Blake']);
  await expect(blake.page.locator('.player-list li')).toHaveText(['Alex', 'Blake (you)']);
});

test('wrong code and duplicate name show the server error on the form', async ({ people }) => {
  const host = await people.host();
  await people.player(host.code, 'Alex');

  const wrong = await people.player('ZZZZ', 'Casey', { expectJoined: false });
  await expect(wrong.page.getByRole('alert')).toHaveText('No room with that code.');

  const copy = await people.player(host.code, 'ALEX', { expectJoined: false });
  await expect(copy.page.getByRole('alert')).toHaveText('Someone in this room already has that name.');
  // Fix the name and try again on the same page.
  await copy.page.getByLabel('Your name').fill('Alex 2');
  await copy.page.getByRole('button', { name: 'Join' }).click();
  await expect(copy.page.getByRole('heading', { name: "You're in!" })).toBeVisible();
});

test('names that look like HTML are shown as plain text', async ({ people }) => {
  const host = await people.host();
  await people.player(host.code, '<b>Hi</b>');
  await expect(hostPlayers(host.page).first()).toContainText('<b>Hi</b>');
  await expect(host.page.locator('.player-list b')).toHaveCount(0); // no real <b> element
});

test('player refresh keeps the same spot', async ({ people }) => {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex');

  await alex.page.reload();
  await expect(alex.page.getByRole('heading', { name: "You're in!" })).toBeVisible();
  await expect(alex.page.getByText(`as Alex`)).toBeVisible();
  await expect(hostPlayers(host.page)).toHaveCount(1);
  await expect(hostPlayers(host.page).first()).not.toContainText('reconnecting');
});

test('host refresh keeps the same room, code and players', async ({ people }) => {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex');

  await host.page.reload();
  await expect(host.page.locator('.room-code')).toHaveText(host.code);
  await expect(hostPlayers(host.page)).toHaveCount(1);
  await expect(alex.page.getByText('Waiting for the host to start a game')).toBeVisible();
});

test('a player whose connection drops shows as reconnecting, then recovers', async ({ people }) => {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex', { controllable: true });

  await alex.network.cut();
  await expect(alex.page.getByText('Connection lost. Reconnecting…')).toBeVisible();
  await expect(hostPlayers(host.page).first()).toContainText('reconnecting');

  // Back within the 2 s grace period: the page reconnects and resumes on its own.
  alex.network.restore();
  await expect(alex.page.getByText('Connection lost. Reconnecting…')).toBeHidden({ timeout: 10_000 });
  await expect(alex.page.getByText('as Alex')).toBeVisible();
  await expect(hostPlayers(host.page).first()).not.toContainText('reconnecting');
});

test('a player who closes their tab is removed after the grace period', async ({ people }) => {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex');

  await alex.page.close();
  await expect(hostPlayers(host.page).first()).toContainText('reconnecting');
  await expect(hostPlayers(host.page)).toHaveCount(0); // after 2 s
});

test('host closing the tab: players wait, then see the room close', async ({ people }) => {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex');

  await host.page.close();
  await expect(alex.page.getByText('The host disconnected')).toBeVisible();
  await expect(alex.page.getByText("The host didn't come back, so the room closed.")).toBeVisible();
});

test('host can kick a player', async ({ people }) => {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex');

  await host.page.getByRole('button', { name: 'Remove Alex' }).click();
  await expect(alex.page.getByText('The host removed you from the room.')).toBeVisible();
  await expect(hostPlayers(host.page)).toHaveCount(0);
});

test('player can leave the room', async ({ people }) => {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex');

  await alex.page.getByRole('button', { name: 'Leave room' }).click();
  await expect(alex.page.getByText('You left the room.')).toBeVisible();
  await expect(hostPlayers(host.page)).toHaveCount(0);
});

test('host "End room" closes it for everyone', async ({ people }) => {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex');

  await host.page.getByRole('button', { name: 'End room' }).click();
  await expect(host.page.getByText('You ended the room.')).toBeVisible();
  await expect(alex.page.getByText('The host ended the room.')).toBeVisible();

  // "Start a new room" gives a fresh code.
  await host.page.getByRole('button', { name: 'Start a new room' }).click();
  await expect(host.page.locator('.room-code')).toHaveText(/^[A-Z]{4}$/);
  await expect(host.page.locator('.room-code')).not.toHaveText(host.code);
});

test('host sees the game picker; Start is disabled until enough players join', async ({ people }) => {
  const host = await people.host();
  await expect(host.page.getByRole('heading', { name: 'Next game: Bumper Blobs' })).toBeVisible();
  await expect(host.page.getByRole('radio', { name: 'Bumper Blobs' })).toBeChecked();
  await expect(host.page.getByText('Needs 2–12 players.')).toBeVisible();
  await expect(host.page.getByRole('button', { name: 'Start game' })).toBeDisabled();

  await people.player(host.code, 'Alex');
  await expect(host.page.getByRole('button', { name: 'Start game' })).toBeDisabled();
  await people.player(host.code, 'Blake');
  await expect(host.page.getByRole('button', { name: 'Start game' })).toBeEnabled();
});
