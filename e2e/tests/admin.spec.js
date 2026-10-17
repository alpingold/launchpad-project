import { test, expect } from './helpers.js';
import { ADMIN } from '../server/accounts.js';

// The admin page for AI-made games (plan §11, A6). The test server's generator is a fake
// (e2e/server/testServer.js): it takes ~2 s, writes a renamed copy of the party-rounds
// template ("Robot Majority"), or a broken game when the idea contains "broken", with a
// stand-in for the browser playtest's results.
test.setTimeout(60_000);
// One after another: these tests share the one admin account, which may have only one AI
// job at a time (plan §15).
test.describe.configure({ mode: 'serial' });
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

/** Types an idea (unique, so parallel tests don't mix up their games) and asks for its design. */
async function generate(page, idea) {
  await page.goto('/admin');
  await page.getByLabel('Game idea').fill(`${idea} (${test.info().testId}-${Date.now()})`);
  // The admin may have one job at a time (plan §15): an earlier test's last job may still be
  // finishing, so try again until it's accepted (the box empties).
  await expect(async () => {
    await page.getByRole('button', { name: 'Write the design' }).click();
    await expect(page.getByLabel('Game idea')).toHaveValue('', { timeout: 1000 });
  }).toPass(GENERATED);
}

/** Waits for the design (or plan) to be ready, then presses Build it. */
async function buildWhenDesigned(page, version = 1) {
  const v = detail(page).getByRole('article', { name: `Version ${version}` });
  await expect(v.getByRole('button', { name: 'Build it' })).toBeVisible(GENERATED);
  await v.getByRole('button', { name: 'Build it' }).click();
}

const detail = (page) => page.locator('.gen-detail');
/** A game's card in the catalogue (/games), by its id. */
const catalogCard = (page, id) => page.locator('.game-card', { has: page.locator(`a.game-card-title[href="/games/${id}"]`) });

// Each test leaves the admin with no job running, so the next one may start its own.
test.afterEach(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  expect((await api.post('/api/login', { data: ADMIN })).status()).toBe(200);
  await expect
    .poll(async () => (await (await api.get('/api/admin/generations')).json()).games.some((g) => g.progress !== null), GENERATED)
    .toBe(false);
  await api.dispose();
});

test('only admins get in', async ({ page, people }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL('/login?next=/admin');

  const host = await people.host(); // an ordinary host account
  await host.page.goto('/admin');
  await expect(host.page.getByRole('heading', { name: 'Admins only' })).toBeVisible();
});

test('design → new draft → edit → build → read it → playtest with phones → publish → change (plan, build) → playtest v2 next to v1 → publish → delete', async ({ browser, people }) => {
  const admin = await adminPage(browser);
  const { page } = admin;
  await page.goto('/admin');
  await expect(page.getByRole('button', { name: 'Write the design' })).toBeDisabled(); // no idea yet
  await expect(page.getByText('Model: qwen3.8:27b')).toBeVisible(); // one model, so no picker
  await generate(page, 'Everyone votes, the most popular answer scores');

  // Live progress, then the design to read: shown as formatted text, nothing built yet.
  await expect(detail(page).getByText('design: asking qwen3.8:27b')).toBeVisible(GENERATED);
  const v1 = detail(page).getByRole('article', { name: 'Version 1' });
  await expect(v1.getByText('Design ready')).toBeVisible(GENERATED);
  const design = v1.getByLabel('The design');
  await expect(design.getByRole('heading', { name: 'Robot Majority' })).toBeVisible();
  await expect(design.getByRole('heading', { name: 'Rules' })).toBeVisible();
  await expect(design).toContainText('3 rounds of 20 s.');

  // Ask for a new draft: the AI's next draft follows the feedback; the old one is kept.
  await v1.getByLabel('Ask the AI for a new draft').fill('Make it 2 rounds');
  await v1.getByRole('button', { name: 'Write a new draft' }).click();
  await expect(v1.getByLabel('The design')).toContainText('Revised: Make it 2 rounds', GENERATED);
  await expect(v1.getByText(/This draft was written after:\s*Make it 2 rounds/)).toBeVisible();
  await expect(v1.locator('.gen-drafts summary')).toHaveText('Earlier drafts (1)');

  // Edit it by hand, then build.
  await v1.getByRole('button', { name: 'Edit it myself' }).click();
  const editor = v1.getByLabel('Edit the design (Markdown)');
  await editor.fill((await editor.inputValue()).replace('Revised: Make it 2 rounds', '2 rounds of 30 s, edited by hand.'));
  await v1.getByRole('button', { name: 'Save my edit' }).click();
  await expect(v1.getByLabel('The design')).toContainText('2 rounds of 30 s, edited by hand.');
  await expect(v1.locator('.gen-drafts summary')).toHaveText('Earlier drafts (2)');
  await v1.getByRole('button', { name: 'Build it' }).click();

  // Version 1 is built and ready for review; the design it was built from is kept.
  await expect(detail(page).getByText('Ready for review')).toBeVisible(GENERATED);
  await expect(v1.getByText('The design it was built from')).toBeVisible();
  await expect(detail(page).getByRole('heading', { name: 'Robot Majority' })).toBeVisible();
  await expect(detail(page).getByText(/Passed every check: the game info, the static check, and 20 s of play/)).toBeVisible();
  // The playtest's screenshots and the lines worth a look (F4).
  await expect(detail(page).getByRole('img', { name: 'The big screen during the playtest' })).toBeVisible();
  await expect(detail(page).getByRole('img', { name: 'A phone during the playtest' })).toBeVisible();
  await expect(detail(page).getByText('Worth a look')).toBeVisible();
  await expect(detail(page).getByText(/never called party\.save/)).toBeVisible();
  // How it was built: both attempts, the first with its problem and what changed to fix it (plan §13n).
  await v1.getByText('How it was built: 2 attempts (1 failed)').click();
  const try1 = v1.getByRole('listitem', { name: 'Attempt 1' });
  await expect(try1).toContainText('1 problem');
  await expect(try1.locator('.gen-findings')).toContainText('fetch is blocked in a game');
  await expect(v1.getByRole('listitem', { name: 'Attempt 2' })).toContainText('✓ passed');
  await expect(v1.getByRole('listitem', { name: 'Attempt 2' }).locator('.gen-diff summary')).toHaveText('Changed lines since attempt 1: +1 −1');
  await expect(v1.locator('pre.gen-code').last()).toContainText('id="game-info"'); // the version's code, as text
  const gameId = (await detail(page).getByText(/^g-[a-z0-9]{8}$/).textContent()).trim();

  // Playtest v1: in the admin's own catalogue (as "-v1"), and nobody else's.
  await detail(page).getByRole('button', { name: 'Playtest v1' }).click();
  await expect(detail(page).getByText('Playtest (only you)')).toBeVisible();
  const otherHost = await people.host();
  await otherHost.page.goto('/games');
  await expect(otherHost.page.locator('.game-card').first()).toBeVisible();
  await expect(catalogCard(otherHost.page, `${gameId}-v1`)).toHaveCount(0);

  // The admin hosts a room for it and plays it with two phones.
  const hostPage = await admin.context.newPage();
  await hostPage.goto(`/host?game=${gameId}-v1`);
  const code = await hostPage.locator('.room-code').textContent();
  const alex = await people.player(code, 'Alex');
  await people.player(code, 'Blake');
  await expect(hostPage.locator('.game-picker')).toContainText('AI-made · v1 playtest, only you');
  await hostPage.getByRole('button', { name: 'Start game' }).click();
  await expect(alex.page.frameLocator('iframe.game-frame').getByRole('button', { name: '3', exact: true })).toBeVisible(); // pick a number

  // Publish: every host can pick it now, with the AI-made badge.
  await detail(page).getByRole('button', { name: 'Publish v1' }).click();
  await expect(detail(page).getByText('Everyone plays v1.')).toBeVisible();
  await otherHost.page.reload();
  await expect(catalogCard(otherHost.page, gameId).locator('h3')).toHaveText(/^Robot Majority\s*AI-made$/);

  // Ask for changes: version 2's plan first, then built, with the AI's list of changes and the changed lines.
  await detail(page).getByLabel('Ask for changes').fill('Rename it to Robot Majority 2, please');
  await detail(page).getByRole('button', { name: 'Write a plan' }).click();
  const v2 = detail(page).getByRole('article', { name: 'Version 2' });
  await expect(v2.getByText('Plan ready')).toBeVisible(GENERATED);
  await expect(v2.getByLabel('The plan')).toContainText('Change: Rename it to Robot Majority 2, please');
  await expect(detail(page).getByLabel('Ask for changes')).toBeDisabled(); // one change at a time
  await buildWhenDesigned(page, 2);
  await expect(v2.getByText('Passed the checks')).toBeVisible(GENERATED);
  await expect(v2.locator('p', { hasText: 'Changed from v1:' })).toContainText('Rename it to Robot Majority 2, please');
  await expect(v2.getByText('Renamed it to Robot Majority 2')).toBeVisible();
  const sinceV1 = v2.locator('.gen-diff').filter({ hasText: 'Changed lines since v1' }); // (each attempt has its own diff too)
  await expect(sinceV1.locator('summary')).toHaveText('Changed lines since v1: +1 −1');
  await expect(sinceV1.locator('.diff-del')).toContainText('"name": "Robot Majority",');
  await expect(sinceV1.locator('.diff-add')).toContainText('"name": "Robot Majority 2",');

  // Playtest v2: the admin gets both versions; other hosts keep v1.
  await v2.getByRole('button', { name: 'Playtest v2' }).click();
  await expect(detail(page).getByText("You're playtesting v2.")).toBeVisible();
  await hostPage.goto('/games');
  await expect(catalogCard(hostPage, gameId).locator('h3')).toHaveText(/^Robot Majority\s*AI-made$/);
  await expect(catalogCard(hostPage, `${gameId}-v2`).locator('h3')).toHaveText(/^Robot Majority 2\s*AI-made · v2 playtest, only you$/);
  await otherHost.page.reload();
  await expect(catalogCard(otherHost.page, gameId)).toHaveCount(1);
  await expect(catalogCard(otherHost.page, `${gameId}-v2`)).toHaveCount(0);

  // Publish v2: it replaces v1 for everyone.
  await detail(page).getByRole('button', { name: 'Publish v2' }).click();
  await expect(detail(page).getByText('Everyone plays v2.')).toBeVisible();
  await otherHost.page.reload();
  await expect(catalogCard(otherHost.page, gameId).locator('h3')).toHaveText(/^Robot Majority 2\s*AI-made$/);

  // Delete: gone from the list and from the catalogue.
  await detail(page).getByRole('button', { name: 'Delete game' }).click();
  await expect(detail(page)).toHaveCount(0);
  await otherHost.page.reload();
  await expect(otherHost.page.locator('.game-card').first()).toBeVisible();
  await expect(catalogCard(otherHost.page, gameId)).toHaveCount(0);
  await admin.context.close();
});

test('a failed game shows why, with its test report and code, and can be built again', async ({ browser }) => {
  const admin = await adminPage(browser);
  const { page } = admin;
  await generate(page, 'A broken game about nothing at all');
  await buildWhenDesigned(page);

  await expect(detail(page).getByText('Failed', { exact: true }).first()).toBeVisible(GENERATED);
  await expect(detail(page).getByRole('button', { name: 'Build it again' })).toBeVisible(); // the design stays
  await expect(detail(page).getByText('no passing game after 1 attempt')).toBeVisible();
  await expect(detail(page).getByText(/The checks found \d+ problems?/)).toBeVisible();
  // The static check's finding, with its line; the line is marked in the code.
  const finding = detail(page).locator('.gen-report .gen-findings li', { hasText: 'fetch is blocked in a game' }); // (also listed under its attempt)
  await expect(finding).toContainText('line 5');
  await expect(finding.locator('.gen-finding-code')).toHaveText("party.ready(() => fetch('https://example.com/scores'));");
  await expect(detail(page).getByRole('button', { name: /Playtest/ })).toHaveCount(0); // only Delete
  await expect(detail(page).getByLabel('Ask for changes')).toHaveCount(0); // nothing that passed to change
  const code = detail(page).locator('.gen-version > details > details.gen-source').filter({ hasText: /^Code \(/ }).last(); // the version's code, not an attempt's
  await code.locator('summary').click();
  await expect(code.locator('pre .code-line.flagged')).toHaveAttribute('data-line', '5');
  await admin.context.close();
});

test('a small fix skips the plan; an unwanted plan can be discarded', async ({ browser }) => {
  const admin = await adminPage(browser);
  const { page } = admin;
  await generate(page, 'A quick voting game for testing fixes');
  await buildWhenDesigned(page);
  await expect(detail(page).getByText('Ready for review')).toBeVisible(GENERATED);

  await detail(page).getByLabel('Ask for changes').fill('Fix the title, please');
  await detail(page).getByLabel('Small fix: skip the plan').check();
  await detail(page).getByRole('button', { name: 'Make the fix' }).click();
  const v2 = detail(page).getByRole('article', { name: 'Version 2' });
  await expect(v2.getByText('Passed the checks')).toBeVisible(GENERATED);
  await expect(v2.getByText(/The plan it was built from/)).toHaveCount(0);

  await detail(page).getByLabel('Ask for changes').fill('Something we will not want after all');
  await detail(page).getByRole('button', { name: 'Write a plan' }).click();
  const v3 = detail(page).getByRole('article', { name: 'Version 3' });
  await expect(v3.getByText('Plan ready')).toBeVisible(GENERATED);
  await v3.getByRole('button', { name: 'Discard v3' }).click();
  await expect(v3).toHaveCount(0);
  await expect(detail(page).getByLabel('Ask for changes')).toBeEnabled();
  await admin.context.close();
});

test('an admin publishes their own game from /create (its routes have no publish, so it goes to the admin routes)', async ({ browser }) => {
  const { page } = await adminPage(browser);
  await page.goto('/create');
  await page.getByLabel('Game idea').fill(`Everyone votes, the most popular answer scores (${test.info().testId}-${Date.now()})`);
  // An earlier test's last job may still be finishing (one job at a time): retry until it starts.
  await expect(async () => {
    await page.getByRole('button', { name: 'Write the design' }).click();
    await expect(page).toHaveURL(/\/create\/g-[a-z0-9]{8}$/, { timeout: 1000 });
  }).toPass(GENERATED);
  const gameId = new URL(page.url()).pathname.split('/').at(-1);
  await page.getByRole('button', { name: 'Build it' }).click({ timeout: GENERATED.timeout });
  await expect(page.getByRole('heading', { name: 'Your game is ready' })).toBeVisible(GENERATED);
  await page.getByRole('button', { name: 'Publish for everyone' }).click();
  await expect(page.getByText('Everyone can play this version.')).toBeVisible();
  await expect(page.getByText('Something went wrong.')).toHaveCount(0);

  // Logged out, the catalogue lists it now.
  const visitor = await browser.newContext();
  const games = await (await visitor.request.get('/api/games')).json();
  expect(games.games.some((g) => g.pageId === gameId)).toBe(true);
  await visitor.close();
  await page.request.delete(`/api/admin/generations/${gameId}`);
});
