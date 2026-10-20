import { test, expect } from './helpers.js';

// Bring your own key (plan §15): any account saves its GenAI Studio key on /account, then
// makes its own games on /create. The test server fakes the key check ("sk-good…" works)
// and the generator.
test.setTimeout(60_000);
const GENERATED = { timeout: 20_000 }; // other tests' jobs may be in the queue first
const GOOD_KEY = 'sk-good-0123456789abcdef0123';

test('logged out: /account sends you to the login page; /create says to make an account first', async ({ page }) => {
  await page.goto('/account');
  await expect(page).toHaveURL('/login?next=/account');
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Make a game' }).click();
  await expect(page).toHaveURL('/create');
  await expect(page.getByText(/you need a free account, and then your own Purdue GenAI Studio API key/)).toBeVisible();
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create a host account' })).toBeVisible();
  await expect(page).toHaveURL('/login?mode=signup&next=/create');
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

test('/create: without a key it asks for one; with a key, one game at a time, and its maker can publish it', async ({ people }) => {
  const { page, context } = await people.host();
  await page.goto('/create');
  await expect(page.getByRole('heading', { name: 'Make a game', level: 1 })).toBeVisible();
  await expect(page.getByText('Add your API key first.')).toBeVisible();
  await expect(page.getByLabel('Game idea')).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Add your API key' })).toHaveAttribute('href', '/account');

  const saved = await context.request.put('/api/account/genai-key', { data: { key: GOOD_KEY } });
  expect(saved.status()).toBe(200);
  await page.reload();
  const idea = `Everyone votes, the most popular answer scores (${test.info().testId}-${Date.now()})`;
  await page.getByLabel('Game idea').fill(idea);
  await page.getByRole('button', { name: 'Write the design' }).click();
  // Each game has its own page, with the four steps as a track (plan §19).
  await expect(page).toHaveURL(/^[^?]*\/create\/g-[a-z0-9]{8}$/);
  const gamePage = page.url();
  const gameId = new URL(gamePage).pathname.split('/').at(-1);
  const track = page.getByRole('list', { name: /^Step \d of 4/ });

  // A second game while the first is being made: refused.
  await page.goto('/create');
  await page.getByLabel('Game idea').fill(`${idea}, again`);
  await page.getByRole('button', { name: 'Write the design' }).click();
  await expect(page.getByText('You already have a game being made. Wait for it to finish, then start the next one.')).toBeVisible();

  // The list links to the game's page.
  await page.locator(`a[href="/create/${gameId}"]`).click();
  await expect(page).toHaveURL(gamePage);

  // Read the design, build it, then play: only the owner can start it, until they publish it (plan §49).
  await expect(page.getByRole('button', { name: 'Build it' })).toBeVisible(GENERATED);
  await expect(track).toHaveAccessibleName('Step 2 of 4: Design');
  await page.getByRole('button', { name: 'Build it' }).click();
  await expect(page.getByRole('heading', { name: 'Your game is ready' })).toBeVisible(GENERATED);
  await expect(track).toHaveAccessibleName('Step 4 of 4: Play');
  await expect(page.getByRole('heading', { name: 'Robot Majority', level: 1 })).toBeVisible();
  await expect(page.getByText(/publish it: every host can start it then/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish for everyone' })).toBeVisible();
  // The code is there, folded away.
  await page.getByText('For the curious').click();
  await page.getByText(/^The code \(\d+ lines\)$/).click();
  await expect(page.locator('.gen-code:visible')).toContainText('Robot Majority'); // (each build attempt's code stays folded)
  await page.getByRole('button', { name: 'Play it now' }).click();
  await expect(page).toHaveURL(`/host?game=${gameId}-v1`);

  // The game is listed for its owner (the lobby uses the same list), marked as theirs alone.
  await page.goto('/games');
  await expect(page.locator('.game-card', { hasText: 'Robot Majority' }).filter({ hasText: 'only you' })).toHaveCount(1);
});
