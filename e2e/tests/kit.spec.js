import { test, expect } from './helpers.js';

// The game kit page (/kit): the guide for writing games, which the AI reads too.

test('the game kit page shows the guide, linked from the home page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'game kit' }).click();
  await expect(page).toHaveURL('/kit');
  await expect(page.getByRole('heading', { name: 'Game kit', level: 1 })).toBeVisible();

  const games = page.getByRole('region', { name: 'How games work' });
  await expect(games.getByRole('heading', { name: 'How a BoilerGames game works' })).toBeVisible();
  await expect(games.getByRole('heading', { name: 'The party SDK' })).toBeVisible();
  await expect(games.locator('pre').first()).toContainText('id="game-info"'); // code examples, as text
  await page.getByRole('link', { name: 'Writing a design' }).click();
  await expect(page).toHaveURL('/kit#designs');
  await expect(page.getByRole('region', { name: 'Writing a design' }).getByRole('heading', { name: 'Edge cases' })).toBeVisible();
});
