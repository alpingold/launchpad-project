import { test, expect } from './helpers.js';

// Privacy (plan §54): the page, linked from every page's footer; and deleting your account.

test('the privacy page is in the footer and says what is kept and how to delete it', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/games');
  await page.locator('.site-footer').getByRole('link', { name: 'Privacy' }).click();
  await expect(page).toHaveURL('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible();
  await expect(page.getByText(/stored only as a one-way scrambled form/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Removing it' })).toBeVisible();
});

test('deleting your account: the password again, then you are logged out and the name is free', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.accept());
  const username = `gone${Date.now() % 100000}`;
  expect((await context.request.post('/api/signup', { data: { username, password: 'test-password-123' } })).status()).toBe(201);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Delete my account…' }).click();
  await page.getByLabel('Your password, to confirm').fill('wrong-password-1');
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByRole('alert')).toHaveText("That's not your password.");

  await page.getByLabel('Your password, to confirm').fill('test-password-123');
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page).toHaveURL('/');
  expect((await (await context.request.get('/api/me')).json()).user).toBeNull();
  expect((await context.request.post('/api/signup', { data: { username, password: 'another-password-1' } })).status()).toBe(201);
});
