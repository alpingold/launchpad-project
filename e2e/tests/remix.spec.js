import { test, expect } from './helpers.js';

// Remixing (plan §45): "Remix" on a game's page makes your own copy, ready to play on /create;
// published, it credits the original; its creator can turn new remixes off.
test.setTimeout(60_000);

test('remix an official game, publish it with a credit line, then turn remixing off for it', async ({ people, browser }) => {
  // Logged out: a link to log in first.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/games/bumper-blobs');
  await expect(visitor.getByRole('link', { name: 'Log in to remix' })).toBeVisible();

  // A host remixes Bumper Blobs: it opens as their own game, ready to play (no key needed).
  const { page } = await people.host(); // (its confirm dialogs are accepted)
  await page.goto('/games/bumper-blobs');
  await page.getByRole('button', { name: 'Remix' }).click();
  await expect(page).toHaveURL(/\/create\/g-[a-z0-9]{8}$/);
  const remixId = new URL(page.url()).pathname.split('/').at(-1);
  await expect(page.getByRole('heading', { name: 'Your remix is ready' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bumper Blobs - Remixed', level: 1 })).toBeVisible();
  await expect(page.locator('.create-idea')).toHaveText('Your remix of Bumper Blobs');
  await expect(page.locator('.create-idea a')).toHaveAttribute('href', '/games/bumper-blobs');

  // Published, its page credits the original; its creator sees no Remix button on their own game.
  await page.getByRole('button', { name: 'Publish for everyone' }).click();
  await expect(page.getByText('Everyone can play this version.')).toBeVisible();
  await page.goto(`/games/${remixId}`);
  const byLine = page.locator('.game-page-by');
  await expect(byLine).toContainText('remixed from Bumper Blobs by BoilerGames');
  await expect(byLine.getByRole('link', { name: 'Bumper Blobs' })).toHaveAttribute('href', '/games/bumper-blobs');
  await expect(page.getByRole('button', { name: 'Remix' })).toHaveCount(0);

  // Someone else can remix the remix, until its creator turns that off.
  const other = (await people.host()).page;
  await other.goto(`/games/${remixId}`);
  await expect(other.getByRole('button', { name: 'Remix' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit this page' }).click();
  await page.getByLabel('Let others remix this game').uncheck();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. Everyone sees the new page now.')).toBeVisible();
  await other.reload();
  await expect(other.locator('.game-page-by')).toContainText('remixed from Bumper Blobs');
  await expect(other.getByRole('button', { name: 'Remix' })).toHaveCount(0);
});

test('"Make it your own" (plan §45b): a remix gets its own design to read first, then is rebuilt from it', async ({ people }) => {
  test.setTimeout(90_000);
  const { page, context } = await people.host(); // (its confirm dialogs are accepted)
  expect((await context.request.put('/api/account/genai-key', { data: { key: 'sk-good-0123456789abcdef0123' } })).status()).toBe(200);
  await page.goto('/games/claim-jumpers');
  await page.getByRole('button', { name: 'Remix' }).click();
  await expect(page.getByRole('heading', { name: 'Your remix is ready' })).toBeVisible();

  // Instead of the change form: what should be different.
  await expect(page.getByRole('heading', { name: 'Make it your own' })).toBeVisible();
  await page.getByLabel('What should be different').fill('Two teams instead of everyone for themselves');
  await page.getByRole('button', { name: "Write my remix's design" }).click();
  await expect(page.locator('.create-idea')).toHaveText('Your remix of Claim Jumpers: Two teams instead of everyone for themselves', { timeout: 20_000 });
  // A whole design (the new-game track), to read and build.
  await expect(page.getByRole('button', { name: 'Build it' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel(/Step 2 of 4: Design/)).toBeVisible();
  await page.getByRole('button', { name: 'Build it' }).click();
  await expect(page.getByRole('heading', { name: 'Your remix is ready' })).toBeVisible({ timeout: 20_000 });

  // After that, ordinary changes.
  await expect(page.getByRole('heading', { name: 'Make it your own' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Want it different?' })).toBeVisible();
  await page.getByText('For the curious').click();
  await expect(page.getByText(/Made your own from version 1: Two teams/)).toBeVisible();
});
