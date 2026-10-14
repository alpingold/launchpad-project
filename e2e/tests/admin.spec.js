import { test, expect } from './helpers.js';
import { ADMIN } from '../server/accounts.js';

// The admin page for AI-made games (plan §11, A6). The test server's generator is a fake
// (e2e/server/testServer.js): it takes ~2 s, writes a renamed copy of Majority Rules
// ("Robot Majority"), or a broken game when the idea contains "broken".
test.setTimeout(60_000);
const GENERATED = { timeout: 20_000 }; // other tests' jobs may be in the queue first

/** A browser context logged in as the test admin, with dialogs (confirm) accepted. */
async function adminPage(browser) {
  const context = await browser.newContext();
  const res = await context.request.post('/api/login', { data: ADMIN });
  expect(res.status()).toBe(200);
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.accept());
  return { context, page };
}

/** Types an idea (unique, so parallel tests don't mix up their games) and presses Generate. */
async function generate(page, idea) {
  await page.goto('/admin');
  await page.getByLabel('Game idea').fill(`${idea} (${test.info().testId}-${Date.now()})`);
  await page.getByRole('button', { name: 'Generate' }).click();
}

const detail = (page) => page.locator('.gen-detail');

test('only admins get in', async ({ page, people }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL('/login?next=/admin');

  const host = await people.host(); // an ordinary host account
  await host.page.goto('/admin');
  await expect(host.page.getByRole('heading', { name: 'Admins only' })).toBeVisible();
});

test('generate → watch it → read it → playtest with phones → publish → delete', async ({ browser, people }) => {
  const admin = await adminPage(browser);
  const { page } = admin;
  await page.goto('/admin');
  await expect(page.getByRole('button', { name: 'Generate' })).toBeDisabled(); // no idea yet
  await expect(page.getByText('Model: qwen3.8:27b')).toBeVisible(); // one model, so no picker
  await generate(page, 'Everyone votes, the most popular answer scores');

  // Live progress, then ready for review.
  await expect(detail(page).getByText('asking qwen3.8:27b')).toBeVisible(GENERATED);
  await expect(detail(page).getByText('Ready for review')).toBeVisible(GENERATED);
  await expect(detail(page).getByRole('heading', { name: 'Robot Majority' })).toBeVisible();
  await expect(detail(page).getByText(/Passed every check: .* 18 games played by bots/)).toBeVisible();
  await expect(detail(page).locator('pre')).toContainText('contractVersion: 3'); // the code, as text
  const gameId = (await detail(page).getByText(/^g-[a-z0-9]{8}$/).textContent()).trim();

  // Playtest: in the admin's own game picker, and nobody else's.
  await detail(page).getByRole('button', { name: 'Playtest' }).click();
  await expect(detail(page).getByText('Playtest (only you)')).toBeVisible();
  const otherHost = await people.host();
  await expect(otherHost.page.locator(`option[value="${gameId}"]`)).toHaveCount(0);

  // The admin hosts a room and plays it with two phones.
  const hostPage = await admin.context.newPage();
  await hostPage.goto('/host');
  const code = await hostPage.locator('.room-code').textContent();
  const alex = await people.player(code, 'Alex');
  await people.player(code, 'Blake');
  await hostPage.getByRole('combobox', { name: 'Game' }).selectOption(gameId);
  await expect(hostPage.locator('.game-picker')).toContainText('AI-made · playtest, only you');
  await hostPage.getByRole('button', { name: 'Start game' }).click();
  await expect(alex.page.locator('.choice-options button').first()).toBeVisible();

  // Publish: every host can pick it now, with the AI-made badge.
  await detail(page).getByRole('button', { name: 'Publish' }).click();
  await expect(detail(page).getByText('Published')).toBeVisible();
  await otherHost.page.reload();
  await expect(otherHost.page.locator(`option[value="${gameId}"]`)).toHaveText('Robot Majority (AI-made)');
  await otherHost.page.goto('/');
  await expect(otherHost.page.locator('.game-cards li', { hasText: 'Robot Majority' }).first()).toContainText('AI-made');

  // Delete: gone from the list and from the game pickers.
  await detail(page).getByRole('button', { name: 'Delete' }).click();
  await expect(detail(page)).toHaveCount(0);
  await otherHost.page.goto('/host');
  await expect(otherHost.page.locator('.room-code')).toHaveText(/^[A-Z]{4}$/);
  await expect(otherHost.page.locator(`option[value="${gameId}"]`)).toHaveCount(0);
  await admin.context.close();
});

test('a failed game shows why, with its test report and code', async ({ browser }) => {
  const admin = await adminPage(browser);
  const { page } = admin;
  await generate(page, 'A broken game about nothing at all');

  await expect(detail(page).getByText('Failed', { exact: true })).toBeVisible(GENERATED);
  await expect(detail(page).getByText('no passing game after 1 attempt')).toBeVisible();
  await expect(detail(page).getByText(/The tests found \d+ problems?:/)).toBeVisible();
  await expect(detail(page).getByText(/createGame/).first()).toBeVisible();
  await expect(detail(page).getByRole('button', { name: 'Playtest' })).toHaveCount(0); // only Delete
  await detail(page).getByText(/^Code \(/).click();
  await expect(detail(page).locator('pre')).toContainText("id: 'oops'");
  await admin.context.close();
});
