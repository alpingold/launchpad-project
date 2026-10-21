import { test, expect } from './helpers.js';

// Is Purdue GenAI Studio up (plan §53)? The game pages say so; down, a notice before anyone tries.
// The server's answer is stood in for here, so the test never asks Purdue.
const answer = (page, body) => page.route('**/api/genai-status', (route) => route.fulfill({ json: body }));

test('the games page and the game maker say whether the AI game maker is up', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await answer(page, { enabled: true, up: true, checkedAt: 1, since: 1 });
  await page.goto('/games');
  await expect(page.getByRole('status').filter({ hasText: 'The AI game maker is online.' })).toBeVisible();

  await page.unroute('**/api/genai-status');
  await answer(page, { enabled: true, up: false, checkedAt: 1, since: 1 });
  await page.goto('/create');
  await expect(page.getByText('The AI game maker is down right now:')).toBeVisible();
  await expect(page.getByText(/playing games works as usual/)).toBeVisible();

  // A server that doesn't make games, or hasn't checked yet: nothing.
  await page.unroute('**/api/genai-status');
  await answer(page, { enabled: true, up: null, checkedAt: null, since: null });
  await page.goto('/games');
  await expect(page.locator('h1')).toHaveText('Games');
  await expect(page.locator('.genai-status')).toHaveCount(0);
});
