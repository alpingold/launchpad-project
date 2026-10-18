import { test, expect } from './helpers.js';

// Punchline, the writing-and-voting game: three phones each answer two prompts, vote on the
// matchups they're not in, play The Last Word, and the game ends with a winner. Plus: a big
// screen reload mid-round keeps the deal, and a player who leaves gets "house" answers so the
// round doesn't wait for them. (The game's own timers run at full length: ~90 s for a game.)
test.setTimeout(180_000);

const frame = (page) => page.frameLocator('iframe.game-frame');
const NAMES = ['Ana', 'Ben', 'Cal'];

/** Opens a room for Punchline with three phones and starts the game. */
async function startGame(people) {
  const host = await people.host({ game: 'punchline' });
  const phones = {};
  for (const name of NAMES) phones[name] = await people.player(host.code, name);
  await expect(host.page.getByRole('heading', { name: 'Next game: Punchline' })).toBeVisible();
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(frame(host.page).getByRole('heading', { name: 'PUNCHLINE' })).toBeVisible();
  return { host, phones };
}

/** Types an answer into the phone's box and sends it. */
async function answer(phone, text) {
  const box = frame(phone.page).getByLabel('Your answer');
  await box.fill(text);
  await box.press('Enter');
}

/**
 * Answers both prompts on one phone. It waits for the second prompt before typing: until the
 * game's next state arrives, the first prompt's box is still on screen, and an answer typed
 * into it would count as a repeat of the first one (and be dropped).
 */
async function answerBoth(phone, name) {
  await expect(frame(phone.page).getByText('Prompt 1 of 2')).toBeVisible({ timeout: 15_000 });
  await answer(phone, `${name} 1`);
  await expect(frame(phone.page).getByText('Prompt 2 of 2')).toBeVisible();
  await answer(phone, `${name} 2`);
}

/** Writes both prompts on every phone (after the 8 s intro). */
async function writeRound(phones, round) {
  for (const [name, phone] of Object.entries(phones)) {
    await expect(frame(phone.page).getByText('Prompt 1 of 2')).toBeVisible({ timeout: 15_000 });
    await answer(phone, `${name} joke ${round}a`);
    await expect(frame(phone.page).getByText('Prompt 2 of 2')).toBeVisible();
    await answer(phone, `${name} joke ${round}b`);
  }
}

/** Plays every matchup of a round: the one phone that can vote picks the first answer. */
async function voteRound(host, phones) {
  for (let k = 1; k <= NAMES.length; k++) {
    await expect(frame(host.page).getByText(`Matchup ${k} of ${NAMES.length}`)).toBeVisible({ timeout: 15_000 });
    let voter = null;
    await expect
      .poll(async () => {
        for (const [name, phone] of Object.entries(phones)) {
          if (await frame(phone.page).getByText('Which is funnier?').isVisible()) voter = name;
        }
        return voter;
      }, { timeout: 10_000 })
      .not.toBeNull();
    // The two authors can't vote on their own matchup.
    for (const name of NAMES.filter((n) => n !== voter)) {
      await expect(frame(phones[name].page).getByText('That’s your prompt! Hands off the vote.')).toBeVisible();
    }
    const choices = frame(phones[voter].page).locator('.choices button');
    await expect(choices).toHaveCount(2);
    await choices.first().click();
    // One voter: the vote ends the matchup at once, and the reveal names the authors.
    await expect(frame(host.page).locator('.author').first()).toBeVisible();
  }
}

test('three phones write, vote and play The Last Word: the game ends with a winner', async ({ people }) => {
  const { host, phones } = await startGame(people);
  const big = frame(host.page);

  // Round 1: everyone writes; the answers aren't shown until the matchups.
  await writeRound(phones, 1);
  await expect(big.locator('.bubble', { hasText: / joke 1[ab]$/ })).toHaveCount(2, { timeout: 10_000 });
  // While the room votes, the big screen shows the answers but not who wrote them.
  await expect(big.locator('.author')).toHaveCount(0);
  await voteRound(host, phones);
  await expect(big.getByRole('heading', { name: 'After Round 1' })).toBeVisible({ timeout: 15_000 });

  // Round 2: double points.
  await writeRound(phones, 2);
  await voteRound(host, phones);
  await expect(big.getByRole('heading', { name: 'After Round 2' })).toBeVisible({ timeout: 15_000 });

  // The Last Word: one prompt for everyone, then vote for anyone but yourself.
  for (const [name, phone] of Object.entries(phones)) {
    await expect(frame(phone.page).getByText('The Last Word')).toBeVisible({ timeout: 15_000 });
    await answer(phone, `${name} last word`);
  }
  for (const [name, phone] of Object.entries(phones)) {
    const options = frame(phone.page).locator('.choices button');
    await expect(options).toHaveCount(NAMES.length - 1);
    await expect(options.filter({ hasText: `${name} last word` })).toHaveCount(0);
    // Everyone votes for Ana's (Ana votes for Ben's).
    await options.filter({ hasText: name === 'Ana' ? 'Ben last word' : 'Ana last word' }).click();
  }
  await expect(big.getByText('+600')).toBeVisible({ timeout: 10_000 }); // Ana: 2 votes × 300

  // The end: the winner on the big screen, places on the phones, then back to the lobby.
  await expect(big.getByText(/The funniest (person in the room is|people in the room are)…/)).toBeVisible({ timeout: 20_000 });
  await expect(frame(phones.Ana.page).getByText(/You won!|You came/)).toBeVisible();
  await expect(host.page.getByText(/won the last game!|It's a tie/)).toBeVisible({ timeout: 20_000 });
});

test('the big screen reloads mid-round: the same prompts and answers carry on', async ({ people }) => {
  const { host, phones } = await startGame(people);
  const ana = frame(phones.Ana.page);
  await expect(ana.getByText('Prompt 1 of 2')).toBeVisible({ timeout: 15_000 });
  const prompt = await ana.locator('.card-p').textContent();
  await answer(phones.Ana, 'Ana before the reload');
  await expect(ana.getByText('Prompt 2 of 2')).toBeVisible();

  await host.page.reload();
  await expect(frame(host.page).getByText('Answer on your phones!')).toBeVisible();
  await expect(host.page.getByText(/stopped/)).toHaveCount(0);
  // Ana is still on her second prompt (not dealt again), and her first answer is kept.
  await expect(ana.getByText('Prompt 2 of 2')).toBeVisible();
  expect(await ana.locator('.card-p').textContent()).not.toBe(prompt);
  // The big screen kept her first answer: her badge shows one of two prompts done.
  await expect(frame(host.page).locator('.badge', { hasText: 'Ana' }).locator('.dots span.on')).toHaveCount(1);
  await answer(phones.Ana, 'Ana after the reload');
  for (const name of ['Ben', 'Cal']) await answerBoth(phones[name], name);
  await expect(frame(host.page).getByText('Matchup 1 of 3')).toBeVisible({ timeout: 15_000 });
});

test('a player who leaves gets answers from the house, so the round goes on without them', async ({ people }) => {
  const { host, phones } = await startGame(people);
  await expect(frame(phones.Cal.page).getByText('Prompt 1 of 2')).toBeVisible({ timeout: 15_000 });
  await phones.Cal.context.close(); // Cal walks away mid-round
  for (const name of ['Ana', 'Ben']) await answerBoth(phones[name], name);
  // Once Cal is marked away, nobody connected is still writing, so the matchups start, and
  // Cal's answers are the house's.
  await expect(frame(host.page).getByText('Matchup 1 of 3')).toBeVisible({ timeout: 20_000 });
  const big = frame(host.page);
  // Every matchup has Cal in it or Cal as its only voter; play until a reveal shows a house answer.
  await expect
    .poll(async () => {
      for (const name of ['Ana', 'Ben']) {
        const choices = frame(phones[name].page).locator('.choices button');
        if ((await choices.count()) === 2) await choices.first().click().catch(() => {});
      }
      return big.getByText('picked by the house').count();
    }, { timeout: 60_000, intervals: [1000] })
    .toBeGreaterThan(0);
});
