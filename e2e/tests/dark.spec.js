import { test, expect } from './helpers.js';

// Dark only (plan §34): the site and every game, whatever the device prefers.

const DARK_BG = 'rgb(20, 20, 31)';
// The page background is set on <html> (the :root rule in styles.css).
const background = (page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

test('a device set to light mode still gets the dark site, with no theme setting anywhere', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light' });
  const page = await context.newPage();
  for (const path of ['/', '/games', '/join', '/report']) {
    await page.goto(path);
    expect(await background(page), path).toBe(DARK_BG);
    await expect(page.getByRole('button', { name: 'Settings' })).toHaveCount(0);
  }
  await context.close();
});

test("games are told it's dark, and their base colours are dark, on the big screen and the phones", async ({ people }) => {
  const host = await people.host({ game: 'probe' });
  const alex = await people.player(host.code, 'Alex');
  await host.page.getByRole('button', { name: 'Start game' }).click();
  for (const page of [host.page, alex.page]) {
    const frame = page.frameLocator('iframe.game-frame').locator('html');
    await expect(frame).toHaveAttribute('data-theme', 'dark');
    expect(await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())).toBe('#14141f');
  }
});
