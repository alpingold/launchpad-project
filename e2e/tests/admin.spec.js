import { test, expect } from './helpers.js';
import { ADMIN } from '../server/accounts.js';

// The admin page for AI-made games (plan §11, A6). The test server's generator is a fake
// (e2e/server/testServer.js): it takes ~2 s, writes a renamed copy of the Probe frame game
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

test('generate → read it → playtest with phones → publish → ask for changes → playtest v2 next to v1 → publish → delete', async ({ browser, people }) => {
  const admin = await adminPage(browser);
  const { page } = admin;
  await page.goto('/admin');
  await expect(page.getByRole('button', { name: 'Generate' })).toBeDisabled(); // no idea yet
  await expect(page.getByText('Model: qwen3.8:27b')).toBeVisible(); // one model, so no picker
  await generate(page, 'Everyone votes, the most popular answer scores');

  // Live progress, then version 1 is ready for review.
  await expect(detail(page).getByText('asking qwen3.8:27b')).toBeVisible(GENERATED);
  await expect(detail(page).getByText('Ready for review')).toBeVisible(GENERATED);
  await expect(detail(page).getByRole('heading', { name: 'Robot Majority' })).toBeVisible();
  await expect(detail(page).getByText(/Passed every check: the game info/)).toBeVisible();
  await expect(detail(page).locator('pre')).toContainText('id="game-info"'); // the code, as text
  const gameId = (await detail(page).getByText(/^g-[a-z0-9]{8}$/).textContent()).trim();

  // Playtest v1: in the admin's own game picker (as "-v1"), and nobody else's.
  await detail(page).getByRole('button', { name: 'Playtest v1' }).click();
  await expect(detail(page).getByText('Playtest (only you)')).toBeVisible();
  const otherHost = await people.host();
  await expect(otherHost.page.locator(`option[value^="${gameId}"]`)).toHaveCount(0);

  // The admin hosts a room and plays it with two phones.
  const hostPage = await admin.context.newPage();
  await hostPage.goto('/host');
  const code = await hostPage.locator('.room-code').textContent();
  const alex = await people.player(code, 'Alex');
  await people.player(code, 'Blake');
  await hostPage.getByRole('combobox', { name: 'Game' }).selectOption(`${gameId}-v1`);
  await expect(hostPage.locator('.game-picker')).toContainText('AI-made · v1 playtest, only you');
  await hostPage.getByRole('button', { name: 'Start game' }).click();
  await expect(alex.page.frameLocator('iframe.game-frame').getByRole('button', { name: 'Ping' })).toBeVisible();

  // Publish: every host can pick it now, with the AI-made badge.
  await detail(page).getByRole('button', { name: 'Publish v1' }).click();
  await expect(detail(page).getByText('Everyone plays v1.')).toBeVisible();
  await otherHost.page.reload();
  await expect(otherHost.page.locator(`option[value="${gameId}"]`)).toHaveText('Robot Majority (AI-made)');
  await otherHost.page.goto('/');
  await expect(otherHost.page.locator('.game-cards li', { hasText: 'Robot Majority' }).first()).toContainText('AI-made');
  await otherHost.page.goto('/host'); // back before the room's host grace period runs out
  await expect(otherHost.page.locator('.room-code')).toHaveText(/^[A-Z]{4}$/);

  // Ask for changes: version 2, with the AI's list of changes and the changed lines.
  await detail(page).getByLabel('Ask for changes').fill('Rename it to Robot Majority 2, please');
  await detail(page).getByRole('button', { name: 'Make a new version' }).click();
  const v2 = detail(page).getByRole('article', { name: 'Version 2' });
  await expect(v2.getByText('Passed the tests')).toBeVisible(GENERATED);
  await expect(v2.locator('p', { hasText: 'Changed from v1:' })).toContainText('Rename it to Robot Majority 2, please');
  await expect(v2.getByText('Renamed it to Robot Majority 2')).toBeVisible();
  await expect(v2.locator('.gen-diff summary')).toHaveText('Changed lines since v1: +1 −1');
  await expect(v2.locator('.diff-del')).toContainText('"name": "Robot Majority",');
  await expect(v2.locator('.diff-add')).toContainText('"name": "Robot Majority 2",');

  // Playtest v2: the admin gets both versions; other hosts keep v1.
  await v2.getByRole('button', { name: 'Playtest v2' }).click();
  await expect(detail(page).getByText("You're playtesting v2.")).toBeVisible();
  // (The admin's room is still playing v1: end it and start a fresh one to see the picker.)
  hostPage.on('dialog', (dialog) => dialog.accept());
  await hostPage.getByRole('button', { name: 'End room' }).click();
  await hostPage.getByRole('button', { name: 'Start a new room' }).click();
  await expect(hostPage.locator('.room-code')).toHaveText(/^[A-Z]{4}$/);
  await expect(hostPage.locator(`option[value="${gameId}"]`)).toHaveText('Robot Majority (AI-made)');
  await expect(hostPage.locator(`option[value="${gameId}-v2"]`)).toHaveText('Robot Majority 2 (AI-made, v2 playtest)');
  await otherHost.page.reload();
  await expect(otherHost.page.locator('.room-code')).toHaveText(/^[A-Z]{4}$/);
  await expect(otherHost.page.locator(`option[value^="${gameId}"]`)).toHaveCount(1);

  // Publish v2: it replaces v1 for everyone.
  await detail(page).getByRole('button', { name: 'Publish v2' }).click();
  await expect(detail(page).getByText('Everyone plays v2.')).toBeVisible();
  await otherHost.page.reload();
  await expect(otherHost.page.locator(`option[value="${gameId}"]`)).toHaveText('Robot Majority 2 (AI-made)');

  // Delete: gone from the list and from the game pickers.
  await detail(page).getByRole('button', { name: 'Delete game' }).click();
  await expect(detail(page)).toHaveCount(0);
  await otherHost.page.reload();
  await expect(otherHost.page.locator('.room-code')).toHaveText(/^[A-Z]{4}$/);
  await expect(otherHost.page.locator(`option[value^="${gameId}"]`)).toHaveCount(0);
  await admin.context.close();
});

test('a failed game shows why, with its test report and code', async ({ browser }) => {
  const admin = await adminPage(browser);
  const { page } = admin;
  await generate(page, 'A broken game about nothing at all');

  await expect(detail(page).getByText('Failed', { exact: true }).first()).toBeVisible(GENERATED);
  await expect(detail(page).getByText('no passing game after 1 attempt')).toBeVisible();
  await expect(detail(page).getByText(/The tests found \d+ problems?:/)).toBeVisible();
  await expect(detail(page).getByText(/no game info/).first()).toBeVisible();
  await expect(detail(page).getByRole('button', { name: /Playtest/ })).toHaveCount(0); // only Delete
  await expect(detail(page).getByLabel('Ask for changes')).toHaveCount(0); // nothing that passed to change
  await detail(page).getByText(/^Code \(/).click();
  await expect(detail(page).locator('pre')).toContainText('Oops, no game info.');
  await admin.context.close();
});
