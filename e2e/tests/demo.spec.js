import { test, expect, uniqueUsername } from './helpers.js';
import { ADMIN } from '../server/accounts.js';

// The demo phase (plan §31): "(demo)" on every page except during a game, the footer on most
// pages, and the report form it leads to.

test('home says it is a demo; the corner badge is on every page and opens the report form for that page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.wordmark .wordmark-name')).toHaveText('BoilerGames');
  await expect(page.locator('.wordmark .demo-tag')).toHaveText('(demo)');
  await expect(page.getByText("Fair warning: it's a demo")).toBeVisible();
  const badge = page.getByRole('link', { name: '(demo)' });
  await expect(badge).toHaveAttribute('href', '/report');

  await page.goto('/games/punchline');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('href', '/report?from=%2Fgames%2Fpunchline');
});

test('the badge shows in the lobby and steps aside during a game, on the big screen and the phones', async ({ people }) => {
  const host = await people.host({ game: 'probe' });
  const player = await people.player(host.code, 'Alex');
  const badge = (p) => p.getByRole('link', { name: '(demo)' });
  await expect(badge(host.page)).toBeVisible();
  await expect(badge(player.page)).toBeVisible();

  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(host.page.locator('iframe.game-frame')).toBeVisible();
  await expect(badge(host.page)).toBeHidden();
  await expect(badge(player.page)).toBeHidden();
});

test('the footer is on ordinary pages, not the room screens; its link remembers the page', async ({ page }) => {
  await page.goto('/join');
  await expect(page.locator('.site-footer')).toHaveCount(0);
  await page.goto('/games');
  const footer = page.locator('.site-footer');
  await expect(footer).toContainText("BoilerGames is still in an early testing phase and I'd love your feedback!");
  await expect(footer).toContainText('not affiliated with, endorsed by, sponsored by, or in any way sanctioned by Purdue University');
  await footer.getByRole('link', { name: 'Report an issue' }).click();
  await expect(page).toHaveURL('/report?from=%2Fgames');
  await expect(page.locator('.site-footer')).toHaveCount(0);
});

test('sending a report: thanks, a 3-second countdown, then home; the admin reads it in the Reports tab', async ({ page, browser }) => {
  const text = `The vote button is stuck on my phone (${Date.now()})`;
  await page.goto('/report?from=%2Fgames%2Fpunchline');
  await expect(page.getByText('About Punchline?')).toBeVisible();
  await expect(page.getByText('the page /games/punchline')).toBeVisible();
  const send = page.getByRole('button', { name: 'Send report' });
  await page.getByLabel('What happened?').fill('broken');
  await expect(send).toBeDisabled(); // under 10 characters
  await page.getByLabel('An idea').check();
  await page.getByLabel('What happened?').fill(text);
  await send.click();

  await expect(page.getByRole('heading', { name: 'Thanks! Your feedback is very, very, very much appreciated!' })).toBeVisible();
  await expect(page.getByText('Redirecting back to the main site in 3…')).toBeVisible();
  await expect(page.getByText('Redirecting back to the main site in 2…')).toBeVisible();
  await expect(page).toHaveURL('/', { timeout: 5000 });

  const admin = await browser.newContext();
  expect((await admin.request.post('/api/login', { data: ADMIN })).status()).toBe(200);
  const adminPage = await admin.newPage();
  await adminPage.goto('/admin');
  await adminPage.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Reports' }).click();
  await expect(adminPage).toHaveURL('/admin?tab=reports');
  const report = adminPage.locator('.site-report', { hasText: text });
  await expect(report).toContainText('Idea');
  await expect(report).toContainText('/games/punchline');
  await expect(report).toContainText('logged out');
  await report.getByRole('button', { name: 'Done' }).click();
  await expect(report.getByRole('button', { name: 'Not done' })).toBeVisible();
  await admin.close();
});

/** A browser context with a fresh account, logged in. */
async function account(browser) {
  const context = await browser.newContext();
  const res = await context.request.post('/api/signup', { data: { username: uniqueUsername(), password: 'test-password-123' } });
  expect(res.status()).toBe(201);
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.accept());
  return { context, page };
}

test('bug reports on a game page: post, votes move the agreed-with ones up, −5 folds away, the admin marks fixed', async ({ browser, page }) => {
  const tag = Date.now();
  const [ana, ben, cal] = [await account(browser), await account(browser), await account(browser)];
  const reports = (p) => p.locator('#reports .report-list').first().locator('> li');

  for (const [who, text] of [[ana, `Useless report lol ${tag}`], [ben, `Votes in round 2 are lost ${tag}`]]) {
    await who.page.goto('/games/stowaways');
    await who.page.getByLabel('Report a problem').fill(text);
    await who.page.getByRole('button', { name: 'Report', exact: true }).click();
    await expect(who.page.locator('.game-report', { hasText: text })).toBeVisible();
  }
  // Newest first while nobody has voted: Ben's is on top.
  await cal.page.goto('/games/stowaways');
  const mine = reports(cal.page).filter({ hasText: String(tag) });
  await expect(mine).toHaveText([/Votes in round 2/, /Useless report/]);

  // Cal agrees with Ben's (+1) and not with Ana's (−1): one total each, and the order holds.
  const report = (p, text) => p.locator('.game-report', { hasText: text });
  await report(cal.page, 'Votes in round 2').getByRole('button', { name: "I've hit this too" }).click();
  await expect(report(cal.page, 'Votes in round 2').locator('.report-score')).toHaveText('1');
  await report(cal.page, 'Useless report').getByRole('button', { name: 'Not helpful' }).click();
  await expect(report(cal.page, 'Useless report').locator('.report-score')).toHaveText('-1');
  // Your own report: no voting on it.
  await ana.page.reload();
  await expect(report(ana.page, 'Useless report').getByRole('button', { name: 'Not helpful' })).toBeDisabled();

  // Four more people vote Ana's down: at −5 it folds away (and can be shown again).
  for (let i = 0; i < 4; i++) {
    const voter = await account(browser);
    await voter.page.goto('/games/stowaways');
    await report(voter.page, 'Useless report').getByRole('button', { name: 'Not helpful' }).click();
    // The fourth vote makes it −5: it folds away at once, even for the voter.
    if (i < 3) await expect(report(voter.page, 'Useless report').locator('.report-score')).toHaveText(String(-2 - i));
    else await expect(voter.page.locator('.game-report.is-sunk', { hasText: '(-5)' })).toBeVisible();
    await voter.context.close();
  }
  await cal.page.reload();
  await expect(cal.page.locator('.game-report', { hasText: 'Useless report' })).toHaveCount(0);
  const sunk = cal.page.locator('.game-report.is-sunk', { hasText: 'Hidden: voted down (-5)' });
  await expect(sunk).toBeVisible();
  await sunk.getByRole('button', { name: 'Show' }).click();
  await expect(report(cal.page, 'Useless report')).toBeVisible();

  // The admin (the creator of an official game) marks Ben's fixed: it moves to "Fixed".
  const admin = await browser.newContext();
  expect((await admin.request.post('/api/login', { data: ADMIN })).status()).toBe(200);
  const adminPage = await admin.newPage();
  await adminPage.goto('/games/stowaways');
  await report(adminPage, 'Votes in round 2').getByRole('button', { name: 'Mark fixed' }).click();
  await expect(adminPage.locator('.reports-fixed summary')).toHaveText(/Fixed \(\d+\)/);
  await expect(reports(adminPage).filter({ hasText: 'Votes in round 2' })).toHaveCount(0);
  await adminPage.locator('.reports-fixed summary').click();
  await expect(adminPage.locator('.reports-fixed .game-report', { hasText: 'Votes in round 2' })).toContainText('Fixed');

  // Logged out: read only.
  await page.goto('/games/stowaways');
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
  await expect(page.getByLabel('Report a problem')).toHaveCount(0);
  await expect(report(page, 'Useless report').locator('.report-score')).toHaveCount(0); // folded
  for (const c of [ana, ben, cal]) await c.context.close();
  await admin.close();
});

test('search engines (plan §33): the page describes itself, previews have a picture, and missing pages say noindex', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /party games on one big screen/i);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://boilergames.party/og-image.png');
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  for (const file of ['/og-image.png', '/favicon.svg', '/apple-touch-icon.png']) expect((await request.get(file)).status(), file).toBe(200);

  for (const missing of ['/no-such-page', '/games/no-such-game', '/u/nobody-at-all']) {
    await page.goto(missing);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  }
});
