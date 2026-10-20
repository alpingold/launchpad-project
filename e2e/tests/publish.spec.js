import { test, expect } from './helpers.js';
import { ADMIN } from '../server/accounts.js';

// Asking to publish (plan §44): a maker submits their game from /create/<id>; it waits in the
// admin page's "To approve" tab, where the admin can play it, send it back with a note the maker
// sees, or publish it. The test server fakes the key check and the generator ("Robot Majority").
test.setTimeout(90_000);
const GENERATED = { timeout: 20_000 }; // other tests' jobs may be in the queue first
const GOOD_KEY = 'sk-good-0123456789abcdef0123';

test('a maker submits their game; the admin sends it back with a note, then publishes it', async ({ people, browser }) => {
  // The maker builds a game and playtests it.
  const { page, context } = await people.host(); // (its confirm dialogs are accepted)
  expect((await context.request.put('/api/account/genai-key', { data: { key: GOOD_KEY } })).status()).toBe(200);
  await page.goto('/create');
  await page.getByLabel('Game idea').fill(`Everyone votes, the most popular answer scores (${test.info().testId}-${Date.now()})`);
  await page.getByRole('button', { name: 'Write the design' }).click();
  await expect(page).toHaveURL(/\/create\/g-[a-z0-9]{8}$/);
  const gameId = new URL(page.url()).pathname.split('/').at(-1);
  await page.getByRole('button', { name: 'Build it' }).click(GENERATED);
  await expect(page.getByRole('heading', { name: 'Your game is ready' })).toBeVisible(GENERATED);

  // Submitting makes it the playtest version and waits for the admin; it can be taken back.
  await page.getByRole('button', { name: 'Submit for publishing' }).click();
  await expect(page.getByText('Waiting for approval.')).toBeVisible();
  await page.getByRole('button', { name: 'Take back the request' }).click();
  await expect(page.getByRole('button', { name: 'Submit for publishing' })).toBeVisible();
  await page.getByRole('button', { name: 'Submit for publishing' }).click();
  await expect(page.getByText('Waiting for approval.')).toBeVisible();

  // The admin sees it in "To approve", with its maker, and can host it to try it.
  const admin = await browser.newContext();
  expect((await admin.request.post('/api/login', { data: ADMIN })).status()).toBe(200);
  const adminPage = await admin.newPage();
  adminPage.on('dialog', (dialog) => dialog.accept());
  await adminPage.goto('/admin');
  await adminPage.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'To approve' }).click();
  const item = adminPage.locator('.approve-item').filter({ has: adminPage.locator(`a[href="/admin?game=${gameId}"]`) });
  await expect(item).toContainText('Robot Majority');
  await expect(item.getByRole('link', { name: 'Play it' })).toHaveAttribute('href', `/host?game=${gameId}-v1`);
  const picker = await admin.request.get('/api/games');
  expect((await picker.json()).games.map((g) => g.id)).toContain(`${gameId}-v1`);

  // Sent back with a note: gone from the list; the maker sees the note and can submit again.
  await item.getByRole('button', { name: 'Send back…' }).click();
  await item.getByLabel(/Note for/).fill('The round timer never ends with 2 players.');
  await item.getByRole('button', { name: 'Send it back' }).click();
  await expect(item).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('The round timer never ends with 2 players.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit for publishing' }).click();
  await expect(page.getByText('Waiting for approval.')).toBeVisible();
  await expect(page.getByText('The round timer never ends with 2 players.')).toHaveCount(0);

  // Published: everyone gets it, and the maker's page says so.
  await adminPage.reload();
  await item.getByRole('button', { name: 'Publish' }).click();
  await expect(item).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Everyone can play this version.')).toBeVisible();
  const everyone = await (await browser.newContext()).request.get('/api/games');
  expect((await everyone.json()).games.map((g) => g.id)).toContain(gameId);
  await admin.close();
});
