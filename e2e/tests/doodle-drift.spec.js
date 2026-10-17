import { test, expect } from './helpers.js';

// Doodle Drift (design: generator/spec/designs/doodle-drift.md), the drawing-telephone game:
// four phones write phrases, then pass the books: draw, guess, draw, guess. The big screen
// replays each book, the phones vote for favourites, and the game ends in the lobby.
// (~90 s: rounds end early when everyone's done, but each favourites vote stays 5 s.)
test.setTimeout(180_000);

const frame = (page) => page.frameLocator('iframe.game-frame');
const NAMES = ['Ana', 'Ben', 'Cal', 'Dot'];

/** Opens a room for Doodle Drift with four phones and starts the game. */
async function startGame(people) {
  const host = await people.host({ game: 'doodle-drift' });
  const phones = {};
  for (const name of NAMES) phones[name] = await people.player(host.code, name);
  await expect(host.page.getByRole('heading', { name: 'Next game: Doodle Drift' })).toBeVisible();
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(frame(host.page).getByText('Write a phrase!')).toBeVisible();
  return { host, phones };
}

/** A quick squiggle on the phone's drawing pad. */
async function scribble({ page }) {
  const pad = await frame(page).getByRole('img', { name: 'Drawing pad' }).boundingBox();
  await page.mouse.move(pad.x + pad.width * 0.2, pad.y + pad.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(pad.x + pad.width * 0.5, pad.y + pad.height * 0.7, { steps: 5 });
  await page.mouse.move(pad.x + pad.width * 0.8, pad.y + pad.height * 0.3, { steps: 5 });
  await page.mouse.up();
}

/** Everyone writes a phrase: Ana taps a suggestion, the others type their own. */
async function writePhrases(phones) {
  for (const name of NAMES) {
    const ph = frame(phones[name].page);
    if (name === 'Ana') {
      await ph.locator('.ideas button').first().click();
    } else {
      const box = ph.getByLabel('Your phrase');
      await box.fill(`${name}'s phrase`);
      await box.press('Enter');
    }
  }
}

/** The phrase a phone was asked to draw. */
async function promptOf(phone) {
  const card = frame(phone.page).locator('.card', { hasText: 'Draw this:' });
  await expect(card).toBeVisible();
  return (await card.locator('.words').textContent()).trim();
}

test('write, draw, guess, draw, guess; the books are replayed, favourites voted, and the game ends', async ({ people }) => {
  const { host, phones } = await startGame(people);
  const big = frame(host.page);

  // Page 1: everyone writes, so the round ends at once and the books pass.
  await writePhrases(phones);
  await expect(big.getByText('Draw!')).toBeVisible();

  // Page 2: everyone draws someone else's phrase. Dot sends a blank page.
  const prompts = {};
  for (const name of NAMES) prompts[name] = await promptOf(phones[name]);
  for (const name of NAMES) expect(prompts[name]).not.toBe(`${name}'s phrase`);
  expect(new Set(Object.values(prompts)).size).toBe(4); // every book went to a different phone
  for (const name of NAMES) {
    if (name !== 'Dot') await scribble(phones[name]);
    await frame(phones[name].page).getByRole('button', { name: "I'm done" }).click();
  }

  // Page 3: guess. Whoever got Dot's blank drawing skips; the rest type a guess.
  await expect(big.getByText('Guess!')).toBeVisible();
  let skipped = null;
  await expect
    .poll(async () => {
      for (const name of NAMES) {
        if (await frame(phones[name].page).getByText('Nothing to guess this time').isVisible()) skipped = name;
      }
      return skipped;
    })
    .not.toBeNull();
  for (const name of NAMES.filter((n) => n !== skipped)) {
    const ph = frame(phones[name].page);
    await expect(ph.getByRole('img', { name: 'The drawing to guess' })).toBeVisible();
    const box = ph.getByLabel('Your guess');
    await box.fill(`${name} guess 1`);
    await box.press('Enter');
  }

  // Page 4: draw again (Dot's book carries its phrase forward past the skipped guess).
  await expect(big.getByText('Draw!')).toBeVisible();
  for (const name of NAMES) {
    await promptOf(phones[name]);
    await scribble(phones[name]);
    await frame(phones[name].page).getByRole('button', { name: "I'm done" }).click();
  }

  // Page 5: the last guess (with 4 players it's the book's owner).
  await expect(big.getByText('Guess!')).toBeVisible();
  for (const name of NAMES) {
    const box = frame(phones[name].page).getByLabel('Your guess');
    await box.fill(`${name} guess 2`);
    await box.press('Enter');
  }

  // The reveal: each book in turn. Its owner taps Next; then everyone votes a favourite.
  for (let book = 0; book < NAMES.length; book++) {
    const heading = big.locator('h1.headline');
    await expect(heading).toHaveText(/'s book$/, { timeout: 15_000 });
    const owner = (await heading.textContent()).replace("'s book", '').trim();
    await expect(big.getByText(`${owner} wrote:`)).toBeVisible();
    const ownerPhone = frame(phones[owner].page);
    await expect
      .poll(async () => {
        if (await big.getByText('Started as').isVisible()) return true;
        const next = ownerPhone.getByRole('button', { name: 'Next' });
        if (await next.isVisible()) await next.click().catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 1300));
        return big.getByText('Started as').isVisible();
      }, { timeout: 40_000 })
      .toBe(true);
    await expect(big.getByText('Ended as')).toBeVisible();

    // Everyone votes; your own pages can't be picked.
    for (const name of NAMES) {
      const ph = frame(phones[name].page);
      await expect(ph.getByText('Tap your favourite page!')).toBeVisible();
      await expect(ph.locator('.faves button:not([disabled])', { hasText: '(you)' })).toHaveCount(0);
      await ph.locator('.faves button:not([disabled])').first().click();
      await expect(ph.getByText('Vote counted!')).toBeVisible();
    }
    if (book < NAMES.length - 1) await expect(big.getByText('Started as')).toHaveCount(0, { timeout: 15_000 });
  }

  // The final board, then the game ends in the lobby.
  await expect(big.getByText('Crowd favourites')).toBeVisible({ timeout: 15_000 });
  await expect(big.getByText(/^Page of the game/)).toBeVisible();
  for (const name of NAMES) await expect(frame(phones[name].page).getByText('Thanks for drawing!')).toBeVisible();
  await expect(host.page.getByRole('heading', { name: 'Next game: Doodle Drift' })).toBeVisible({ timeout: 25_000 });
});

test('the big screen reloads mid-round and Doodle Drift carries on with the drawings it had', async ({ people }) => {
  const { host, phones } = await startGame(people);
  const big = frame(host.page);
  await writePhrases(phones);
  await expect(big.getByText('Draw!')).toBeVisible();

  // Ana finishes her drawing; then the big screen reloads.
  await promptOf(phones.Ana);
  await scribble(phones.Ana);
  await frame(phones.Ana.page).getByRole('button', { name: "I'm done" }).click();
  await expect(big.getByText('1 of 4 done')).toBeVisible();
  await host.page.reload();
  await expect(frame(host.page).getByText('Draw!')).toBeVisible();
  await expect(frame(host.page).getByText('1 of 4 done')).toBeVisible();
  await expect(host.page.getByText(/stopped/)).toHaveCount(0);

  // The others finish; every guesser gets a drawing, and Ana's isn't lost.
  for (const name of NAMES.slice(1)) {
    await promptOf(phones[name]);
    await scribble(phones[name]);
    await frame(phones[name].page).getByRole('button', { name: "I'm done" }).click();
  }
  await expect(frame(host.page).getByText('Guess!')).toBeVisible();
  for (const name of NAMES) {
    await expect(frame(phones[name].page).getByRole('img', { name: 'The drawing to guess' })).toBeVisible();
    await expect(frame(phones[name].page).getByText('Nothing to guess this time')).toHaveCount(0);
  }
});
