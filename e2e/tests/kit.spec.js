import { test, expect } from '@playwright/test';

// The public game kit page (plan §12, K4): every block, live.

test('the kit page shows every block group, and blocks work as previews', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'game kit' }).click();
  await expect(page).toHaveURL('/kit');
  await expect(page).toHaveTitle('Game kit · BoilerGames');
  for (const group of ['Layout', 'Display', 'Input', 'Widgets']) {
    await expect(page.getByRole('link', { name: group, exact: true })).toBeVisible();
  }
  // Group notes come from the server too (the same text the AI reads).
  await expect(page.locator('#widget')).toContainText('A widget starts over whenever that phone gets a new screen');

  // A display block: the scoreboard example shows the demo players' names.
  const scoreboard = page.locator('#block-scoreboard');
  await expect(scoreboard.locator('.scoreboard li')).toHaveText(['Alex (you)3', 'Blake1']);

  // An input block: typing and sending shows what the game would receive.
  const textInput = page.locator('#block-textInput');
  await textInput.getByLabel(/worst pizza topping/).fill('  pineapple  ');
  await textInput.getByRole('button', { name: 'Send' }).click();
  await expect(textInput.getByRole('status')).toContainText('action {"answer":true,"round":1}, input "  pineapple  "');
  // Restart puts the block back as it was.
  await textInput.getByRole('button', { name: 'Restart' }).click();
  await expect(textInput.getByLabel(/worst pizza topping/)).toHaveValue('');

  // A widget: the reaction example goes to GO a moment after the page loads.
  const reaction = page.locator('#block-reaction');
  await reaction.getByRole('button', { name: 'TAP!' }).click({ timeout: 5000 });
  await expect(reaction.getByRole('status')).toContainText(/\{"ms":\d+\}/);

  // Each block lists its fields and has a copyable example.
  const slider = page.locator('#block-slider');
  await expect(slider.getByText('step', { exact: true })).toBeVisible();
  await slider.getByText('Example JSON').click();
  await expect(slider.locator('.kit-json')).toContainText('"type": "slider"');
});
