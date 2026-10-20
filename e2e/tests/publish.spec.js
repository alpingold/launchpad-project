import { test, expect } from './helpers.js';
import { ADMIN } from '../server/accounts.js';

// Publishing your own game (plan §49): no admin approval, but a public game's name and
// description can't have blocked words. The maker is told which, highlighted, and fixes them
// on the game's page. The test server fakes the key check and the generator: an idea with
// "rude" in it makes "Robot Bullshit".
test.setTimeout(90_000);
const GENERATED = { timeout: 20_000 }; // other tests' jobs may be in the queue first
const GOOD_KEY = 'sk-good-0123456789abcdef0123';

test('a maker publishes their own game once its name has no blocked words, and can unpublish it', async ({ people, browser }) => {
  const { page, context } = await people.host(); // (its confirm dialogs are accepted)
  expect((await context.request.put('/api/account/genai-key', { data: { key: GOOD_KEY } })).status()).toBe(200);
  await page.goto('/create');
  await page.getByLabel('Game idea').fill(`A rude vote: the most popular answer scores (${test.info().testId}-${Date.now()})`);
  await page.getByRole('button', { name: 'Write the design' }).click();
  await expect(page).toHaveURL(/\/create\/g-[a-z0-9]{8}$/);
  const gameId = new URL(page.url()).pathname.split('/').at(-1);
  await page.getByRole('button', { name: 'Build it' }).click(GENERATED);
  await expect(page.getByRole('heading', { name: 'Your game is ready' })).toBeVisible(GENERATED);
  const everyoneSees = async () => {
    const res = await (await browser.newContext()).request.get('/api/games');
    return (await res.json()).games.map((g) => g.id).includes(gameId);
  };

  // Publishing is refused: the name's blocked word is highlighted, with where to change it.
  await page.getByRole('button', { name: 'Publish for everyone' }).click();
  const blocked = page.locator('.blocked-words');
  await expect(blocked).toContainText("Some words can't be in a public game.");
  await expect(blocked.locator('dd mark')).toHaveText('Bullshit');
  await expect(blocked.locator('dd').first()).toHaveText('Robot Bullshit');
  expect(await everyoneSees()).toBe(false);

  // On the game's page: another blocked name isn't saved either; a clean one is.
  await blocked.getByRole('link', { name: "the game's page" }).click();
  await expect(page).toHaveURL(`/games/${gameId}-v1`);
  await page.getByRole('button', { name: 'Edit this page' }).click();
  await page.getByLabel('Name').fill('Robot Shitshow');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.blocked-words mark')).toHaveText('Shitshow');
  await page.getByLabel('Name').fill('Robot Majority');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. Everyone sees the new page now.')).toBeVisible();
  await expect(page.locator('.blocked-words')).toHaveCount(0);

  // Now it publishes, with no admin involved, and everyone gets it.
  await page.goto(`/create/${gameId}`);
  await page.getByRole('button', { name: 'Publish for everyone' }).click();
  await expect(page.getByText('Everyone can play this version.')).toBeVisible();
  await expect(page.locator('.blocked-words')).toHaveCount(0);
  expect(await everyoneSees()).toBe(true);

  // Its maker can take it down again.
  await page.getByRole('button', { name: 'Unpublish' }).click();
  await expect(page.getByRole('button', { name: 'Publish for everyone' })).toBeVisible();
  expect(await everyoneSees()).toBe(false);
});

test('the admin page has no "To approve" tab any more', async ({ browser }) => {
  const admin = await browser.newContext();
  expect((await admin.request.post('/api/login', { data: ADMIN })).status()).toBe(200);
  const page = await admin.newPage();
  await page.goto('/admin');
  const tabs = page.getByRole('navigation', { name: 'Admin' });
  await expect(tabs.getByRole('link', { name: 'AI games' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'To approve' })).toHaveCount(0);
  await admin.close();
});
