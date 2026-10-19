import { test as base, expect, devices } from '@playwright/test';
import { test } from './helpers.js';

// The front page (plan §42): making a game with AI first, the room code box beside it, then
// the three most-voted games, games players made, and how a game night works.

base('home page leads with making a game, then lists the games', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle("BoilerGames · Party games for one big screen and everyone's phones");
  await expect(page.getByRole('heading', { name: 'Describe a party game. The AI builds it.', level: 1 })).toBeVisible();
  await expect(page.getByRole('list', { name: 'How a game gets made' }).getByRole('listitem')).toHaveCount(4);
  await expect(page.getByRole('heading', { name: 'How a game night works' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Made by players, with AI' })).toBeVisible();
  await expect(page.locator('.game-card').first()).toContainText(/\d+–\d+ players/);
  await page.getByRole('link', { name: /See all \d+ games/ }).click();
  await expect(page).toHaveURL('/games');
});

base('the idea box opens /create with the idea, and keeps it through signing up', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Find the spy' }).click();
  await expect(page.getByLabel('Your game idea')).toHaveValue(/the spy sees nothing/);
  await page.getByLabel('Your game idea').fill('Everyone hums a song; the others guess it.');
  await page.getByRole('button', { name: 'Make this game' }).click();
  await expect(page).toHaveURL('/create?idea=Everyone%20hums%20a%20song%3B%20the%20others%20guess%20it.');
  // Logged out: signing up comes back to /create with the idea still there.
  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
    'href',
    `/login?mode=signup&next=${encodeURIComponent('/create?idea=Everyone%20hums%20a%20song%3B%20the%20others%20guess%20it.')}`,
  );
});

test('the games row shows the three most-voted games', async ({ people }) => {
  // Two votes for Claim Jumpers: ahead of anything another test votes on meanwhile (one vote).
  const voters = [await people.host(), await people.host()];
  for (const { page } of voters) {
    await page.goto('/games/claim-jumpers');
    await page.getByRole('button', { name: /I like it/ }).click();
    await expect(page.getByRole('button', { name: /I like it/ })).toHaveAttribute('aria-pressed', 'true');
  }
  const { page } = voters[0];
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Most-voted games' })).toBeVisible();
  const row = page.getByRole('region', { name: 'Most-voted games' });
  await expect(row.locator('.game-card')).toHaveCount(3);
  await expect(row.locator('.game-card').first()).toContainText('Claim Jumpers');
  for (const { page: p } of voters) {
    await p.goto('/games/claim-jumpers');
    await p.getByRole('button', { name: /I like it/ }).click(); // take it back
    await expect(p.getByRole('button', { name: /I like it/ })).toHaveAttribute('aria-pressed', 'false');
  }
});

base('the join box sends you to the join page with the code filled in', async ({ page }) => {
  await page.goto('/');
  const codeBox = page.getByLabel('Room code');
  await codeBox.fill('bc1df'); // lowercase and a digit
  await expect(codeBox).toHaveValue('BCDF'); // uppercased, letters only, max 4
  await page.getByRole('button', { name: 'Join' }).click();

  await expect(page).toHaveURL('/join?code=BCDF');
  await expect(page).toHaveTitle('Join · BoilerGames');
  await expect(page.getByLabel('Room code')).toHaveValue('BCDF');
});

base('joining with an empty code box just opens the join page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page).toHaveURL('/join');
});

base('logged out, the host card asks you to log in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Log in to host' }).click();
  await expect(page).toHaveURL('/login?next=/games'); // pick a game first (plan §17)
});

base('unknown addresses show "Page not found" with a way home', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page).toHaveTitle('Page not found · BoilerGames');
  await page.getByRole('link', { name: 'Go to the home page' }).click();
  await expect(page).toHaveURL('/');
});

base('every page but the home page has a link back home', async ({ page }) => {
  for (const path of ['/join', '/login', '/no-such-page']) {
    await page.goto(path);
    await page.getByRole('link', { name: 'BoilerGames', exact: true }).click();
    await expect(page).toHaveURL('/');
  }
  await expect(page.getByRole('link', { name: 'BoilerGames', exact: true })).toHaveCount(0);
});

base('a trailing slash still finds the page', async ({ page }) => {
  await page.goto('/join/');
  await expect(page.getByRole('heading', { name: 'Join a game' })).toBeVisible();
});

base('the home page fits a phone screen without sideways scrolling', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('.game-card').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});
