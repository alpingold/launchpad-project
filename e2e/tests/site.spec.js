import { devices } from '@playwright/test';
import { test, expect, chooseGame } from './helpers.js';

// Getting around (plan §16): the links on every page, game pages, votes, creators editing
// their game's page, and profiles. The test server fakes GenAI Studio ("sk-good…" keys work)
// and the generator.
test.setTimeout(60_000);
const GENERATED = { timeout: 20_000 };

test('every page has Games, Docs and Sign up at the top; Account once logged in; hidden during a game', async ({ page, people }) => {
  for (const path of ['/', '/games', '/join', '/kit']) {
    await page.goto(path);
    const nav = page.getByRole('navigation', { name: 'Pages' });
    await expect(nav.getByRole('link')).toHaveText(['Games', 'Docs', 'Sign up']);
  }
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Sign up' }).click();
  await expect(page.getByRole('heading', { name: 'Create a host account' })).toBeVisible();
  await expect(page).toHaveURL('/login?mode=signup&next=%2Fkit');

  const host = await people.host();
  const nav = host.page.getByRole('navigation', { name: 'Pages' });
  await expect(nav.getByRole('link')).toHaveText(['Games', 'Docs', 'Account']);
  // Once a game starts, the links step aside (⚙ stays).
  await people.player(host.code, 'Alex');
  await chooseGame(host.page, 'probe');
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(host.page.locator('iframe.game-frame')).toBeVisible();
  await expect(nav).toBeHidden();
  await expect(host.page.getByRole('button', { name: 'Settings' })).toBeVisible();
});

test("a card opens its game's page: screenshots, creator, facts, Host this game; logged out it asks to log in to vote", async ({ page }) => {
  await page.goto('/games');
  await page.locator('.game-card', { hasText: 'Tower Dash' }).click(); // anywhere on the card
  await expect(page).toHaveURL('/games/tower-dash');
  await expect(page).toHaveTitle('Tower Dash · BoilerGames');
  await expect(page.getByRole('heading', { name: 'Tower Dash', level: 1 })).toBeVisible();
  await expect(page.getByText('by BoilerGames')).toBeVisible();
  await expect(page.getByText('1–8 players · 1–3 min')).toBeVisible();
  const big = page.locator('.game-page-shot');
  await expect(big).toHaveAttribute('alt', 'The big screen during a game of Tower Dash');
  await page.getByRole('group', { name: 'Screenshots' }).getByRole('button', { name: 'A phone' }).click();
  await expect(big).toHaveAttribute('alt', 'A phone during a game of Tower Dash');
  await expect.poll(() => big.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.getByRole('link', { name: 'Log in to vote' })).toBeVisible();
  await expect(page.getByRole('button', { name: /I like it/ })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Host this game' })).toHaveAttribute('href', '/login?next=%2Fhost%3Fgame%3Dtower-dash');
  await page.goto('/games/no-such-game');
  await expect(page.getByRole('heading', { name: 'Game not found' })).toBeVisible();
});

test('votes: ▲, change to ▼, press again to take it back; the card shows the count', async ({ people }) => {
  const { page } = await people.host();
  await page.goto('/games/dungeon-party');
  const up = page.getByRole('button', { name: /I like it/ });
  const down = page.getByRole('button', { name: /I don't like it/ });
  const before = Number((await up.textContent()).match(/\d+/)[0]);
  await up.click();
  await expect(up).toHaveAttribute('aria-pressed', 'true');
  await expect(up).toContainText(String(before + 1));
  await down.click();
  await expect(up).toHaveAttribute('aria-pressed', 'false');
  await expect(down).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/games');
  await expect(page.locator('.game-card', { hasText: 'Dungeon Party' }).locator('.game-votes')).toContainText('▼ 1');
  await page.goto('/games/dungeon-party');
  await page.getByRole('button', { name: /I don't like it/ }).click(); // take it back
  await expect(page.getByRole('button', { name: /I don't like it/ })).toHaveAttribute('aria-pressed', 'false');
});

test("a creator edits their game's page; their name links to their profile, with their bio and games", async ({ people }) => {
  const { page, context } = await people.host();
  const me = (await (await context.request.get('/api/me')).json()).user.username;
  expect((await context.request.put('/api/account/genai-key', { data: { key: 'sk-good-0123456789abcdef0123' } })).status()).toBe(200);

  // Make a game (the fake AI), build it, playtest it.
  await page.goto('/create');
  await page.getByLabel('Game idea').fill(`Everyone votes, the most popular answer scores (${test.info().testId}-${Date.now()})`);
  await page.getByRole('button', { name: 'Write the design' }).click();
  const detail = page.locator('.gen-detail');
  const v1 = detail.getByRole('article', { name: 'Version 1' });
  await expect(v1.getByRole('button', { name: 'Build it' })).toBeVisible(GENERATED);
  await v1.getByRole('button', { name: 'Build it' }).click();
  await expect(detail.getByText('Ready for review')).toBeVisible(GENERATED);
  await detail.getByRole('button', { name: 'Playtest v1' }).click();
  const gameId = (await detail.getByText(/^g-[a-z0-9]{8}$/).textContent()).trim();

  // Its page: by me, my own game (no voting), and an editor.
  await page.goto(`/games/${gameId}-v1`);
  await expect(page.getByRole('heading', { name: /Robot Majority/, level: 1 })).toBeVisible();
  await expect(page.getByText(`by ${me}`)).toBeVisible();
  await expect(page.getByText('Your game: others vote on it.')).toBeVisible();
  await page.getByRole('button', { name: 'Edit this page' }).click();
  await page.getByLabel('Name').fill('Majority Mayhem');
  await page.getByLabel('About this game').fill('Pick what you think most people pick.\nClosest to the crowd wins.');
  await page.getByRole('button', { name: 'voting', exact: true }).click();
  await page.getByLabel('From').fill('4');
  await page.getByLabel('to', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. Everyone sees the new page now.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Majority Mayhem/, level: 1 })).toBeVisible();
  await expect(page.locator('.game-page-about')).toHaveText('Pick what you think most people pick.\nClosest to the crowd wins.');
  await expect(page.getByText(/4–6 min/)).toBeVisible();

  // A bio, then the profile: reached from the creator's name.
  await page.goto('/account');
  await page.getByLabel('Bio').fill('I make party games.');
  await page.getByRole('button', { name: 'Save bio' }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await page.goto('/games');
  const card = page.locator('.game-card', { hasText: 'Majority Mayhem' });
  await expect(card.getByRole('list', { name: 'Tags' })).toContainText('voting');
  await card.getByRole('link', { name: me }).click();
  await expect(page).toHaveURL(`/u/${me}`);
  await expect(page.getByRole('heading', { name: me, level: 1 })).toBeVisible();
  await expect(page.getByText('I make party games.')).toBeVisible();
  await expect(page.locator('.game-card', { hasText: 'Majority Mayhem' })).toBeVisible();

  // Someone else can't see a playtest game, so their view of the profile has no games.
  const other = await people.host();
  await other.page.goto(`/u/${me}`);
  await expect(other.page.getByText('No games yet.')).toBeVisible();
});

test('the header fits the narrowest phones (320 px) without sideways scrolling', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone SE'], defaultBrowserType: undefined });
  const page = await context.newPage();
  for (const path of ['/', '/games', '/games/tower-dash', '/kit', '/login']) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Sign up' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
  await context.close();
});
