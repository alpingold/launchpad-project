import { test, expect } from '@playwright/test';
import { uniqueUsername } from './helpers.js';

async function fillAndSubmit(page, username, password, button) {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: button }).click();
}

test('visiting /host logged out sends you to the login page; without a game, to the catalogue first', async ({ page }) => {
  await page.goto('/host');
  await expect(page).toHaveURL('/games');
  await page.goto('/host?game=bumper-blobs');
  await expect(page).toHaveURL('/login?next=%2Fhost%3Fgame%3Dbumper-blobs');
  await expect(page.getByRole('heading', { name: 'Log in to host' })).toBeVisible();
});

test('create an account, land on the host page, log out, log back in', async ({ page }) => {
  const username = uniqueUsername();
  await page.goto('/host?game=bumper-blobs');
  await page.getByRole('button', { name: 'Create one' }).click();
  await expect(page.getByRole('heading', { name: 'Create a host account' })).toBeVisible();
  await fillAndSubmit(page, username, 'a good password', 'Create account');

  await expect(page).toHaveURL('/host?game=bumper-blobs');
  await expect(page.locator('.room-code')).toHaveText(/^[A-Z]{4}$/);
  await expect(page.getByText(`Hosting as ${username}`)).toBeVisible();

  // Log out from the home page.
  await page.goto('/');
  await expect(page.getByText(`Logged in as ${username}`)).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('link', { name: 'Log in to host' })).toBeVisible();

  // Log back in.
  await page.getByRole('link', { name: 'Log in to host' }).click();
  await fillAndSubmit(page, username, 'a good password', 'Log in');
  await expect(page).toHaveURL('/games'); // pick a game to host (plan §17)
});

test('wrong password shows a message and stays on the page', async ({ page, request }) => {
  const username = uniqueUsername();
  await request.post('/api/signup', { data: { username, password: 'a good password' } });
  await page.goto('/login');
  await fillAndSubmit(page, username, 'not the password', 'Log in');
  await expect(page.getByRole('alert')).toHaveText('Wrong username or password.');
  await expect(page).toHaveURL('/login');
});

test('sign-up problems are explained', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Create one' }).click();
  await fillAndSubmit(page, 'no spaces allowed', 'a good password', 'Create account');
  await expect(page.getByRole('alert')).toHaveText('Usernames are 3–20 letters, numbers, or underscores.');
  await fillAndSubmit(page, uniqueUsername(), 'short', 'Create account');
  await expect(page.getByRole('alert')).toHaveText('Passwords are 8–128 characters.');
});

test('?next= only redirects within the site (no open redirect)', async ({ browser }) => {
  for (const next of ['https://evil.example', '//evil.example', '/\\evil.example']) {
    // A fresh browser context each time: reusing one page raced with the previous
    // iteration's page, which can still be redirecting when the next goto starts.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await page.getByRole('button', { name: 'Create one' }).click();
    await fillAndSubmit(page, uniqueUsername(), 'a good password', 'Create account');
    await expect(page).toHaveURL('/games'); // the safe default, not the other site
    await context.close();
  }
});

test('the login cookie is HttpOnly: page JavaScript cannot read it', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Create one' }).click();
  await fillAndSubmit(page, uniqueUsername(), 'a good password', 'Create account');
  await expect(page).toHaveURL('/games');
  expect(await page.evaluate(() => document.cookie)).not.toContain('sid=');
  const cookies = await page.context().cookies();
  const sid = cookies.find((c) => c.name === 'sid');
  expect(sid.httpOnly).toBe(true);
  expect(sid.sameSite).toBe('Lax');
});

test('opening /host in a second tab gives the same room back', async ({ context }) => {
  await context.request.post('/api/signup', { data: { username: uniqueUsername(), password: 'a good password' } });
  const tab1 = await context.newPage();
  await tab1.goto('/host?game=bumper-blobs');
  await expect(tab1.locator('.room-code')).toHaveText(/^[A-Z]{4}$/); // wait for the room first
  const code = await tab1.locator('.room-code').textContent();

  const tab2 = await context.newPage();
  await tab2.goto('/host?game=bumper-blobs');
  await expect(tab2.locator('.room-code')).toHaveText(code);
  await expect(tab1.getByText('This room is now open in another tab or window.')).toBeVisible();
});
