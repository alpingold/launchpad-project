import { test, expect, devices } from '@playwright/test';

test('home page explains the site and lists the games', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('BoilerGames');
  await expect(page.getByRole('heading', { name: 'BoilerGames', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reaction Race' })).toBeVisible();
  await expect(page.getByText('1–12 players')).toBeVisible();
});

test('the join box sends you to the join page with the code filled in', async ({ page }) => {
  await page.goto('/');
  const codeBox = page.getByLabel('Room code');
  await codeBox.fill('bc1df'); // lowercase and a digit
  await expect(codeBox).toHaveValue('BCDF'); // uppercased, letters only, max 4
  await page.getByRole('button', { name: 'Join' }).click();

  await expect(page).toHaveURL('/join?code=BCDF');
  await expect(page).toHaveTitle('Join · BoilerGames');
  await expect(page.getByLabel('Room code')).toHaveValue('BCDF');
});

test('joining with an empty code box just opens the join page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page).toHaveURL('/join');
});

test('logged out, the host card asks you to log in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Log in to host' }).click();
  await expect(page).toHaveURL('/login?next=/host');
});

test('unknown addresses show "Page not found" with a way home', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page).toHaveTitle('Page not found · BoilerGames');
  await page.getByRole('link', { name: 'Go to the home page' }).click();
  await expect(page).toHaveURL('/');
});

test('a trailing slash still finds the page', async ({ page }) => {
  await page.goto('/join/');
  await expect(page.getByRole('heading', { name: 'Join a game' })).toBeVisible();
});

test('the home page fits a phone screen without sideways scrolling', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Reaction Race' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});
