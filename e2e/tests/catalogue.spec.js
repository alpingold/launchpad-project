import { test, expect, devices } from '@playwright/test';
import { test as roomTest, uniqueUsername } from './helpers.js';

// The game catalogue (plan §14): the public /games page and the host lobby's picker.

test('/games shows every game with its picture, players, length and tags', async ({ page }) => {
  await page.goto('/games');
  await expect(page).toHaveTitle('Games · BoilerGames');
  const blobs = page.locator('.game-card', { has: page.locator('a.game-card-title[href="/games/bumper-blobs"]') });
  await expect(blobs).toContainText('2–12 players · 2–5 min');
  await expect(blobs.locator('.game-tags')).toHaveText('action');
  // Official games have a screenshot; the test-only Probe has none, so it gets a letter tile.
  await expect(blobs.locator('img.game-thumb')).toHaveJSProperty('complete', true);
  expect(await blobs.locator('img.game-thumb').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.game-card', { hasText: 'Probe' }).locator('.game-thumb-tile')).toHaveText('P');
});

test('/games: search, tags and the player count narrow the list; Clear filters brings it back', async ({ page }) => {
  await page.goto('/games');
  const cards = page.locator('.game-card');
  await expect(cards.filter({ has: page.locator('a.game-card-title[href="/games/bumper-blobs"]') })).toBeVisible(); // loaded
  const total = await cards.count();
  expect(total).toBeGreaterThan(3);

  await page.getByRole('searchbox', { name: 'Search games' }).fill('treasure');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Treasure Hunt');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(cards).toHaveCount(total);

  await page.getByRole('button', { name: 'board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'board', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Only board games: Treasure Hunt stays (and any official board game), Bumper Blobs goes.
  await expect(cards.filter({ hasText: 'Treasure Hunt' })).toHaveCount(1);
  await expect(cards.filter({ has: page.locator('a.game-card-title[href="/games/bumper-blobs"]') })).toHaveCount(0);
  expect(await cards.count()).toBeLessThan(total);
  await page.getByRole('button', { name: 'board', exact: true }).click();

  await page.getByRole('combobox', { name: 'Players' }).selectOption('7');
  await expect(cards.filter({ hasText: 'Treasure Hunt' })).toHaveCount(0); // 1–6 players
  await expect(cards.filter({ has: page.locator('a.game-card-title[href="/games/bumper-blobs"]') })).toHaveCount(1); // 2–12

  await page.getByRole('combobox', { name: 'Players' }).selectOption('');
  await page.getByRole('combobox', { name: 'Sort' }).selectOption('name');
  const names = await cards.locator('h3').allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
});

test('"Host this game": logged out it goes through the login, then the lobby has that game chosen', async ({ page }) => {
  await page.goto('/games');
  await page.getByRole('link', { name: 'Host Bumper Blobs' }).click();
  await expect(page).toHaveURL('/login?next=%2Fhost%3Fgame%3Dbumper-blobs');

  // (Logging in there and coming back to `next` is tested in auth.spec.js.) Logged in:
  const res = await page.context().request.post('/api/signup', { data: { username: uniqueUsername(), password: 'test-password-123' } });
  expect(res.status()).toBe(201);
  await page.goto('/games');
  await page.getByRole('link', { name: 'Host Bumper Blobs' }).click();
  await expect(page).toHaveURL('/host?game=bumper-blobs');
  await expect(page.getByRole('heading', { name: 'Next game: Bumper Blobs' })).toBeVisible();
});

roomTest('the lobby shows only its game; Change game warns, ends the room, and opens the catalogue', async ({ people }) => {
  const host = await people.host({ game: 'treasure-hunt' });
  const alex = await people.player(host.code, 'Alex');
  await expect(host.page.getByRole('heading', { name: 'Next game: Treasure Hunt' })).toBeVisible();
  await expect(host.page.locator('.game-card')).toHaveCount(0); // no catalogue in the lobby
  await expect(host.page.getByRole('button', { name: 'Start game' })).toBeEnabled();

  const asked = new Promise((resolve) => host.page.once('dialog', (d) => resolve(d.message())));
  await host.page.getByRole('button', { name: 'Change game' }).click(); // (people's pages accept dialogs)
  expect(await asked).toBe('Change the game? This ends this room. Everyone will have to join the new room with its new code.');
  await expect(host.page).toHaveURL('/games');
  await expect(alex.page.getByText('The host ended the room.')).toBeVisible();
});

roomTest("/host without a game goes to the catalogue; a game you can't see isn't hosted", async ({ people }) => {
  const host = await people.host();
  await host.page.goto('/host');
  await expect(host.page).toHaveURL('/games');
  await host.page.goto('/host?game=no-such-game');
  await expect(host.page.getByRole('heading', { name: "That game isn't available" })).toBeVisible();
  await expect(host.page.locator('.room-code')).toHaveCount(0);
});

test('/games fits a phone screen without sideways scrolling', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  await page.goto('/games');
  await expect(page.locator('.game-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});
