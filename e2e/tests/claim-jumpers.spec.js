import { test, expect } from './helpers.js';

// Claim Jumpers, blind claim bids (plan §36c): two phones send their prospectors in secret. Both
// pile onto one claim (a claim jump: nobody gets it), then split two claims, then one blows a
// claim up with dynamite; the big screen reloads mid-game and carries on, and the game plays out
// through the Mother Lode to a winner. (~100 s: every reveal runs at full length.)
test.setTimeout(180_000);

const frame = (page) => page.frameLocator('iframe.game-frame');
const NAMES = ['Ana', 'Ben'];

/** Puts `count` prospectors on a claim ('A', 'B', …). */
async function send(page, claim, count) {
  for (let k = 0; k < count; k++) await frame(page).getByRole('button', { name: `More on Claim ${claim}` }).click();
  await expect(frame(page).getByLabel(`Claim ${claim}: `)).toHaveText(String(count));
}
const lockIn = (page) => frame(page).getByRole('button', { name: /^Lock in/ }).click();

/** Waits for a round's planning screen on both phones. */
async function roundStarts(phones, round) {
  const label = round === 7 ? 'MOTHER LODE (double gold): send your crew' : `Round ${round} of 7: send your crew`;
  for (const phone of phones) await expect(frame(phone.page).getByText(label)).toBeVisible({ timeout: 30_000 });
}

test('secret crews, a claim jump, a split, dynamite, a big-screen reload, and a winner', async ({ people }) => {
  const host = await people.host({ game: 'claim-jumpers' });
  const phones = [];
  for (const name of NAMES) phones.push(await people.player(host.code, name));
  await expect(host.page.getByRole('heading', { name: 'Next game: Claim Jumpers' })).toBeVisible();
  await host.page.getByRole('button', { name: 'Start game' }).click();
  const [ana, ben] = phones.map((p) => p.page);

  // The intro explains the rules on the big screen.
  await expect(frame(host.page).getByText('Tie for biggest? Claim jumped: nobody gets it.')).toBeVisible();
  for (const page of [ana, ben]) await expect(frame(page).getByText('Get ready!')).toBeVisible();

  // Round 1: two players, three claims. Both put all 5 on Claim A: a claim jump.
  await roundStarts(phones, 1);
  await expect(frame(ana).locator('.plot')).toHaveCount(3);
  await send(ana, 'A', 5);
  await expect(frame(ana).getByText('0 of 5 left')).toBeVisible();
  await expect(frame(ana).getByRole('button', { name: 'More on Claim B' })).toBeDisabled();
  await lockIn(ana);
  await expect(frame(ana).getByRole('button', { name: 'Locked in ✓' })).toBeDisabled();
  await expect(frame(host.page).getByLabel('locked in')).toHaveCount(1); // a tick, never where
  await send(ben, 'A', 5);
  await lockIn(ben);
  await expect(frame(host.page).locator('.claim[data-i="0"]')).toContainText('CLAIM JUMPED! Nobody gets it');
  await expect(frame(ana).getByText('Claim A was jumped: you tied with Ben.')).toBeVisible({ timeout: 15_000 });

  // Round 2: they split. Ana takes A (3 vs 2), Ben takes B (3 vs 2).
  await roundStarts(phones, 2);
  await send(ana, 'A', 3);
  await send(ana, 'B', 2);
  await send(ben, 'A', 2);
  await send(ben, 'B', 3);
  for (const page of [ana, ben]) await lockIn(page);
  await expect(frame(ana).getByText(/^You took Claim A: \+\d+ gold!$/)).toBeVisible({ timeout: 20_000 });
  await expect(frame(ana).getByText('Ben outbid you on Claim B.')).toBeVisible();
  await expect(frame(ben).getByText(/^You took Claim B: \+\d+ gold!$/)).toBeVisible();

  // Round 3: Ana blows up Claim C, where Ben sent everyone. Then her dynamite is gone.
  await roundStarts(phones, 3);
  await frame(ana).getByRole('button', { name: 'Dynamite on Claim C' }).click();
  await expect(frame(ana).getByRole('button', { name: 'Dynamite on Claim C' })).toHaveAttribute('aria-pressed', 'true');
  await expect(frame(ana).getByRole('button', { name: 'More on Claim C' })).toBeDisabled();
  await send(ben, 'C', 5);
  for (const page of [ana, ben]) await lockIn(page);
  await expect(frame(host.page).locator('.claim[data-i="2"]')).toContainText('Ana blew it up', { timeout: 15_000 });
  await expect(frame(ana).getByText('You blew up Claim C.')).toBeVisible({ timeout: 15_000 });
  await expect(frame(ben).getByText('Ana blew up Claim C under your crew.')).toBeVisible();

  // Round 4: Ana has no dynamite left. The big screen reloads mid-round and carries on.
  await roundStarts(phones, 4);
  await expect(frame(ana).getByRole('button', { name: /^Dynamite on/ })).toHaveCount(0);
  await expect(frame(ben).getByRole('button', { name: /^Dynamite on/ })).toHaveCount(3);
  await send(ana, 'B', 1);
  await lockIn(ana);
  await host.page.reload();
  await expect(frame(host.page).getByText('Round 4 of 7')).toBeVisible({ timeout: 15_000 });
  await expect(frame(host.page).getByLabel('locked in')).toHaveCount(1);
  await lockIn(ben);
  await expect(frame(ana).getByText(/^You took Claim B: \+\d+ gold!$/)).toBeVisible({ timeout: 20_000 });

  // Rounds 5–7: both sit out, quickly; the last round is the Mother Lode.
  for (const round of [5, 6, 7]) {
    await roundStarts(phones, round);
    if (round === 7) await expect(frame(host.page).getByText('MOTHER LODE')).toBeVisible();
    for (const page of [ana, ben]) await lockIn(page);
    await expect(frame(ana).getByText('You sat this round out.')).toBeVisible({ timeout: 20_000 });
  }

  // The end: a winner (or a tie) on the big screen, the result on each phone, then the lobby.
  await expect(frame(host.page).getByText(/ (wins|tie)!$/)).toBeVisible({ timeout: 15_000 });
  for (const page of [ana, ben]) await expect(frame(page).getByText(/^(You win!|You tied for 1st!|You came 2nd)$/)).toBeVisible();
  await expect(host.page.getByRole('heading', { name: 'Next game: Claim Jumpers' })).toBeVisible({ timeout: 20_000 });
});
