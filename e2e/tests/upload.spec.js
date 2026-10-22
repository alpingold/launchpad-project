import { readFileSync } from 'node:fs';
import { test, expect } from './helpers.js';

// Uploading your own game file (plan §57): no API key, the file checked with no AI (the test
// server's fake "playtest" fails a file containing "stuck"), then a fixed file as the next
// version, played and published with the "Uploaded" label.
test.setTimeout(90_000);
const CHECKED = { timeout: 20_000 }; // other tests' jobs may be in the queue first

const SOURCE = readFileSync(new URL('../server/unique-number.html', import.meta.url), 'utf8');
const named = (name) => SOURCE.replace(/"name"\s*:\s*"[^"]*"/, `"name": ${JSON.stringify(name)}`);

test('upload a file with no key: a failing one shows its problems, a fixed one becomes the next version and goes public', async ({ people, browser }) => {
  const { page } = await people.host();
  const name = `Uploaded ${Date.now() % 1_000_000}`;
  await page.goto('/create');
  const upload = page.getByRole('region', { name: 'Or upload a game file' });
  await upload.getByText('Or paste it').click();
  await upload.getByLabel('The whole file').fill(`${named(name)}\n<!-- stuck -->\n`);
  const send = upload.getByRole('button', { name: 'Upload and check it' });
  await expect(send).toBeDisabled(); // until you say it's yours to share
  await upload.getByLabel(/I made this game/).check();
  await send.click();
  await expect(page).toHaveURL(/\/create\/g-[a-z0-9]{8}$/);
  await expect(page.getByText('A game file you uploaded.')).toBeVisible();

  // It fails the checks: what they found, and (with no key) how the AI could help.
  await expect(page.getByRole('heading', { name: "Your file didn't pass the checks" })).toBeVisible(CHECKED);
  await expect(page.locator('.create-panel')).toContainText('The game got stuck');
  await expect(page.getByRole('button', { name: 'Ask the AI to fix these' })).toHaveCount(0);
  await expect(page.locator('.create-panel')).toContainText('With your GenAI Studio key saved');

  // A fixed file, chosen from disk, is version 2.
  await page.locator('.create-panel input[type="file"]').setInputFiles({ name: 'game.html', mimeType: 'text/html', buffer: Buffer.from(named(name)) });
  await page.locator('.create-panel').getByLabel(/I made this game/).check();
  await page.getByRole('button', { name: 'Upload it as a new version' }).click();
  await expect(page.getByRole('heading', { name: 'Version 2 is ready' })).toBeVisible(CHECKED);
  await expect(page.getByText('Version 2: a game file you uploaded.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask the AI to review it' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Publish for everyone' }).click();
  await expect(page.getByText('Everyone can play this version.')).toBeVisible();
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/games');
  const card = visitor.locator('.game-card').filter({ hasText: name });
  await expect(card.locator('.ai-badge')).toHaveText('Uploaded');
});
