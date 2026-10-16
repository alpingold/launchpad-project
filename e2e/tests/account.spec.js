import { test, expect } from './helpers.js';

// Bring your own key (plan §15): any account saves its GenAI Studio key on /account, then
// makes its own games on /create. The test server fakes the key check ("sk-good…" works)
// and the generator.
test.setTimeout(60_000);
const GENERATED = { timeout: 20_000 }; // other tests' jobs may be in the queue first
const GOOD_KEY = 'sk-good-0123456789abcdef0123';

test('logged out, /account and /create send you to the login page', async ({ page }) => {
  await page.goto('/account');
  await expect(page).toHaveURL('/login?next=/account');
  await page.goto('/create');
  await expect(page).toHaveURL('/login?next=/create');
});

test('save a key (a wrong one is refused), see only its end; the guide shows the 3 steps', async ({ people }) => {
  const { page } = await people.host();
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();

  // The guide: three steps, each with its picture.
  const steps = page.locator('.key-guide li');
  await expect(steps).toHaveCount(3);
  await expect(steps.first()).toContainText('genai.rcac.purdue.edu');
  for (const img of await page.locator('.key-guide img').all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
  }

  const box = page.getByLabel('API key', { exact: true });
  await expect(box).toHaveAttribute('type', 'password');
  await box.fill('sk-wrong-0123456789abcdef0123');
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByRole('alert')).toHaveText('GenAI Studio says this key is not valid. Make a new one and try again.');

  await box.fill(GOOD_KEY);
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByText('A key ending in …0123 is saved.')).toBeVisible();
  await expect(page.getByLabel('Replace it with a new key')).toHaveValue('', { timeout: 1000 }); // not kept on the page
  expect(await page.content()).not.toContain('0123456789abcdef'); // the key is nowhere on the page

  await page.reload();
  await expect(page.getByText('A key ending in …0123 is saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove it' }).click();
  await expect(page.getByText('Removed.')).toBeVisible();
  await expect(page.getByLabel('API key', { exact: true })).toBeVisible();
});

test('/create: without a key it asks for one; with a key, one game at a time, and no publishing', async ({ people }) => {
  const { page, context } = await people.host();
  await page.goto('/create');
  await expect(page.getByRole('heading', { name: 'Make a game', level: 1 })).toBeVisible();
  await expect(page.getByText(/first save your Purdue GenAI Studio API key/)).toBeVisible();
  await expect(page.getByLabel('Game idea')).toBeDisabled();

  const saved = await context.request.put('/api/account/genai-key', { data: { key: GOOD_KEY } });
  expect(saved.status()).toBe(200);
  await page.reload();
  const idea = `Everyone votes, the most popular answer scores (${test.info().testId}-${Date.now()})`;
  await page.getByLabel('Game idea').fill(idea);
  await page.getByRole('button', { name: 'Write the design' }).click();

  // A second game while the first is being made: refused.
  await page.getByLabel('Game idea').fill(`${idea}, again`);
  await page.getByRole('button', { name: 'Write the design' }).click();
  await expect(page.getByText('You already have a game being made. Wait for it to finish, then start the next one.')).toBeVisible();

  // Build, then playtest: only the owner can start it, and only an admin can publish.
  const detail = page.locator('.gen-detail');
  const v1 = detail.getByRole('article', { name: 'Version 1' });
  await expect(v1.getByRole('button', { name: 'Build it' })).toBeVisible(GENERATED);
  await v1.getByRole('button', { name: 'Build it' }).click();
  await expect(detail.getByText('Ready for review')).toBeVisible(GENERATED);
  await detail.getByRole('button', { name: 'Playtest v1' }).click();
  await expect(detail.getByText(/ask the site admin if it can be published/)).toBeVisible();
  await expect(detail.getByRole('button', { name: /Publish/ })).toHaveCount(0);

  // The game is listed for its owner (the lobby uses the same list), marked as theirs alone.
  await page.goto('/games');
  await expect(page.locator('.game-card', { hasText: 'Robot Majority' }).filter({ hasText: 'only you' })).toHaveCount(1);
});
