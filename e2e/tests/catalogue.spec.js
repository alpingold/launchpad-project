import { test, expect, devices } from '@playwright/test';
import { test as roomTest, uniqueUsername } from './helpers.js';

// The game catalogue (plan §14): the public /games page and the host lobby's picker.

test('/games shows every game with its picture, players, length and tags', async ({ page }) => {
  await page.goto('/games');
  await expect(page).toHaveTitle('Games · BoilerGames');
  const tower = page.locator('.game-card', { hasText: 'Tower Dash' });
  await expect(tower).toContainText('1–8 players · 1–3 min');
  await expect(tower.locator('.game-tags')).toHaveText(/platformer\s*racing/);
  // Official games have a screenshot; the test-only Probe has none, so it gets a letter tile.
  await expect(tower.locator('img.game-thumb')).toHaveJSProperty('complete', true);
  expect(await tower.locator('img.game-thumb').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.game-card', { hasText: 'Probe' }).locator('.game-thumb-tile')).toHaveText('P');
});

test('/games: search, tags and the player count narrow the list; Clear filters brings it back', async ({ page }) => {
  await page.goto('/games');
  const cards = page.locator('.game-card');
  await expect(cards.filter({ hasText: 'Tower Dash' })).toBeVisible(); // loaded
  const total = await cards.count();
  expect(total).toBeGreaterThan(3);

  await page.getByRole('searchbox', { name: 'Search games' }).fill('dungeon');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Dungeon Party');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(cards).toHaveCount(total);

  await page.getByRole('button', { name: 'platformer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'platformer', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Tower Dash');
  await page.getByRole('button', { name: 'platformer', exact: true }).click();

  await page.getByRole('combobox', { name: 'Players' }).selectOption('7');
  await expect(cards.filter({ hasText: 'Dungeon Party' })).toHaveCount(0); // 1–6 players
  await expect(cards.filter({ hasText: 'Tower Dash' })).toHaveCount(1); // 1–8

  await page.getByRole('combobox', { name: 'Players' }).selectOption('');
  await page.getByRole('combobox', { name: 'Sort' }).selectOption('name');
  const names = await cards.locator('h3').allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
});

test('"Host this game": logged out it goes through the login, then the lobby has that game chosen', async ({ page }) => {
  await page.goto('/games');
  await page.getByRole('link', { name: 'Host Tower Dash' }).click();
  await expect(page).toHaveURL('/login?next=%2Fhost%3Fgame%3Dtower-dash');

  // (Logging in there and coming back to `next` is tested in auth.spec.js.) Logged in:
  const res = await page.context().request.post('/api/signup', { data: { username: uniqueUsername(), password: 'test-password-123' } });
  expect(res.status()).toBe(201);
  await page.goto('/games');
  await page.getByRole('link', { name: 'Host Tower Dash' }).click();
  await expect(page).toHaveURL('/host?game=tower-dash');
  await expect(page.getByRole('heading', { name: 'Next game: Tower Dash' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Tower Dash' })).toBeChecked();
});

roomTest('in the lobby, clicking a card chooses it; games that do not fit the room are dimmed', async ({ people }) => {
  const host = await people.host();
  await people.player(host.code, 'Alex');
  await host.page.locator('.game-card', { hasText: 'Dungeon Party' }).click();
  await expect(host.page.getByRole('heading', { name: 'Next game: Dungeon Party' })).toBeVisible();
  await expect(host.page.getByRole('button', { name: 'Start game' })).toBeEnabled();
  // Bumper Blobs needs 2: dimmed, and choosing it disables Start.
  const blobs = host.page.locator('.game-card', { hasText: 'Bumper Blobs' });
  await expect(blobs).toHaveClass(/game-card-misfit/);
  await host.page.getByRole('radio', { name: 'Bumper Blobs' }).check();
  await expect(host.page.getByText('Needs 2–12 players.')).toBeVisible();
  await expect(host.page.getByRole('button', { name: 'Start game' })).toBeDisabled();
  // The room's size is offered as a filter.
  await expect(host.page.getByRole('combobox', { name: 'Players' }).locator('option', { hasText: '1 player (this room)' })).toHaveCount(1);
});

test('/games fits a phone screen without sideways scrolling', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  await page.goto('/games');
  await expect(page.locator('.game-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});
