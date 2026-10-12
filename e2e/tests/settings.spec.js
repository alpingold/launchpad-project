import { test as base, expect } from '@playwright/test';
import { test as roomTest, hostPlayers } from './helpers.js';

const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme);
// The page background is set on <html> (the :root rule in styles.css).
const background = (page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
const LIGHT_BG = 'rgb(245, 245, 250)';
const DARK_BG = 'rgb(20, 20, 31)';

async function chooseTheme(page, label) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: label }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

base('by default the theme matches the device', async ({ browser }) => {
  for (const [colorScheme, expected, bg] of [['dark', 'dark', DARK_BG], ['light', 'light', LIGHT_BG]]) {
    const context = await browser.newContext({ colorScheme });
    const page = await context.newPage();
    await page.goto('/');
    expect(await theme(page)).toBe(expected);
    expect(await background(page)).toBe(bg);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('radio', { name: 'Match device' })).toBeChecked();
    await context.close();
  }
});

base('"Match device" follows the device when it changes, without a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  expect(await theme(page)).toBe('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => theme(page)).toBe('dark');
});

base('choosing Dark applies at once and is remembered on reload and other pages', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await chooseTheme(page, 'Dark');
  expect(await theme(page)).toBe('dark');
  expect(await background(page)).toBe(DARK_BG);

  await page.reload();
  expect(await theme(page)).toBe('dark');
  await page.goto('/join');
  expect(await background(page)).toBe(DARK_BG);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();

  // ...and Light overrides a dark device.
  await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme: 'dark' });
  await chooseTheme(page, 'Light');
  expect(await theme(page)).toBe('light');
});

base('the theme is set before the app loads (no white flash for dark-mode users)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('boilergames.settings', '{"theme":"dark"}'));
  // Block the app's JavaScript entirely: only the tiny script in index.html can run.
  await page.route('**/src/main.jsx', (route) => route.abort());
  await page.goto('/');
  expect(await theme(page)).toBe('dark');
});

base('corrupted saved settings fall back to defaults instead of breaking the page', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('boilergames.settings', '{not json'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'BoilerGames', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('radio', { name: 'Match device' })).toBeChecked();
});

base('unknown or invalid saved values are ignored', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('boilergames.settings', '{"theme":"purple","extra":1}'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('radio', { name: 'Match device' })).toBeChecked();
});

base('changing the theme in one tab updates the other open tabs', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await first.emulateMedia({ colorScheme: 'light' });
  await second.emulateMedia({ colorScheme: 'light' });
  await first.goto('/');
  await second.goto('/join');
  await chooseTheme(first, 'Dark');
  await expect.poll(() => theme(second)).toBe('dark');
});

base('Esc closes the settings panel', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

roomTest('a player can change settings mid-lobby without dropping out of the room', async ({ people }) => {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex');
  await chooseTheme(alex.page, 'Dark');
  await expect(alex.page.getByRole('heading', { name: "You're in!" })).toBeVisible();
  await expect(hostPlayers(host.page).first()).not.toContainText('reconnecting');
  expect(await theme(alex.page)).toBe('dark');
});
