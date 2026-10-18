import { test, expect } from './helpers.js';

// The game kit page (/kit): a short overview, with the full guides the AI reads folded below.

test('the game kit page shows the overview and the full guides, linked from the home page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'game kit' }).click();
  await expect(page).toHaveURL('/kit');
  await expect(page.getByRole('heading', { name: 'Game kit', level: 1 })).toBeVisible();

  await expect(page.getByRole('region', { name: 'One file, two roles' }).locator('pre')).toContainText('id="game-info"'); // code, as text
  await expect(page.getByRole('region', { name: 'The party SDK' })).toContainText('party.setState');

  // The full guides start folded; opening one shows the AI's text.
  const design = page.getByText('Writing a design', { exact: true });
  await expect(page.getByRole('heading', { name: 'Edge cases' })).toBeHidden();
  await design.click();
  await expect(page.getByRole('heading', { name: 'Edge cases' })).toBeVisible();
  await page.getByText('How games work', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The party SDK', exact: true }).last()).toBeVisible();
});
