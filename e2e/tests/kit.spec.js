import { test, expect } from './helpers.js';

// The game kit page (/kit): a short overview, with the full guides the AI reads folded below.

test('the game kit page shows the overview and the full guides, linked from every page as Docs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Docs' }).click();
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

test('the prompt kit (plan §57): Copy the prompt puts the whole prompt on the clipboard; Download saves it', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  await page.goto('/kit');
  await page.getByRole('button', { name: 'Copy the prompt' }).click();
  await expect(page.getByRole('status')).toHaveText(/Copied\. Paste it into a new chat/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^I want you to make a party game for BoilerGames/);
  expect(copied).toContain('# My game idea');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download it' }).click()]);
  expect(download.suggestedFilename()).toBe('boilergames-prompt.txt');
  await context.close();
});
