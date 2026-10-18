import { test, expect } from './helpers.js';

// The demo phase (plan §31): "(demo)" on every page except during a game.

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
