import { test, expect } from './helpers.js';
import { ADMIN } from '../server/accounts.js';

// The demo phase (plan §31): "(demo)" on every page except during a game, the footer on most
// pages, and the report form it leads to.

test('home says it is a demo; the corner badge is on every page and opens the report form for that page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'BoilerGames (demo)', level: 1 })).toBeVisible();
  await expect(page.getByText("Fair warning: it's a demo")).toBeVisible();
  const badge = page.getByRole('link', { name: '(demo)' });
  await expect(badge).toHaveAttribute('href', '/report');

  await page.goto('/games/punchline');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('href', '/report?from=%2Fgames%2Fpunchline');
});

test('the badge shows in the lobby and steps aside during a game, on the big screen and the phones', async ({ people }) => {
  const host = await people.host({ game: 'probe' });
  const player = await people.player(host.code, 'Alex');
  const badge = (p) => p.getByRole('link', { name: '(demo)' });
  await expect(badge(host.page)).toBeVisible();
  await expect(badge(player.page)).toBeVisible();

  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(host.page.locator('iframe.game-frame')).toBeVisible();
  await expect(badge(host.page)).toBeHidden();
  await expect(badge(player.page)).toBeHidden();
});

test('the footer is on ordinary pages, not the room screens; its link remembers the page', async ({ page }) => {
  await page.goto('/join');
  await expect(page.locator('.site-footer')).toHaveCount(0);
  await page.goto('/games');
  const footer = page.locator('.site-footer');
  await expect(footer).toContainText("BoilerGames is still in an early testing phase and I'd love your feedback!");
  await footer.getByRole('link', { name: 'Report an issue' }).click();
  await expect(page).toHaveURL('/report?from=%2Fgames');
  await expect(page.locator('.site-footer')).toHaveCount(0);
});

test('sending a report: thanks, a 3-second countdown, then home; the admin reads it in the Reports tab', async ({ page, browser }) => {
  const text = `The vote button is stuck on my phone (${Date.now()})`;
  await page.goto('/report?from=%2Fgames%2Fpunchline');
  await expect(page.getByText('About Punchline?')).toBeVisible();
  await expect(page.getByText('the page /games/punchline')).toBeVisible();
  const send = page.getByRole('button', { name: 'Send report' });
  await page.getByLabel('What happened?').fill('broken');
  await expect(send).toBeDisabled(); // under 10 characters
  await page.getByLabel('An idea').check();
  await page.getByLabel('What happened?').fill(text);
  await send.click();

  await expect(page.getByRole('heading', { name: 'Thanks! Your feedback is very, very, very much appreciated!' })).toBeVisible();
  await expect(page.getByText('Redirecting back to the main site in 3…')).toBeVisible();
  await expect(page.getByText('Redirecting back to the main site in 2…')).toBeVisible();
  await expect(page).toHaveURL('/', { timeout: 5000 });

  const admin = await browser.newContext();
  expect((await admin.request.post('/api/login', { data: ADMIN })).status()).toBe(200);
  const adminPage = await admin.newPage();
  await adminPage.goto('/admin');
  await adminPage.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Reports' }).click();
  await expect(adminPage).toHaveURL('/admin?tab=reports');
  const report = adminPage.locator('.site-report', { hasText: text });
  await expect(report).toContainText('Idea');
  await expect(report).toContainText('/games/punchline');
  await expect(report).toContainText('logged out');
  await report.getByRole('button', { name: 'Done' }).click();
  await expect(report.getByRole('button', { name: 'Not done' })).toBeVisible();
  await admin.close();
});
