import { test, expect } from './helpers.js';

// Ballpark (design: generator/spec/designs/ballpark.md), the estimation-and-betting game. Two
// phones play a whole game of 7 questions. Ana always guesses 0 (never over any answer) and Ben
// always guesses 9,999,999,999 (always over), so the winning guess is always Ana's and every
// payout is known in advance: a token pays odds × (1 + its chips), the closest guess gets +3.
// (~2.5 min: each reveal and standings screen runs at full length.)
test.setTimeout(300_000);

const frame = (page) => page.frameLocator('iframe.game-frame');
const BIG = '9999999999';

async function startGame(people) {
  const host = await people.host({ game: 'ballpark' });
  const ana = await people.player(host.code, 'Ana');
  const ben = await people.player(host.code, 'Ben');
  await expect(host.page.getByRole('heading', { name: 'Next game: Ballpark' })).toBeVisible();
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(frame(host.page).getByText('Guess the number. Then bet on the best guess.')).toBeVisible();
  return { host, ana: frame(ana.page), ben: frame(ben.page) };
}

/** Types a number on a phone's keypad and locks it in. */
async function guess(phone, digits) {
  await expect(phone.getByRole('button', { name: 'Lock in' })).toBeVisible({ timeout: 25_000 });
  for (const d of digits) await phone.getByRole('button', { name: d, exact: true }).click();
  await phone.getByRole('button', { name: 'Lock in' }).click();
}

/** A betting row on a phone, by the guess it shows (e.g. "0" or "9,999,999,999"). */
const slot = (phone, label) => phone.getByRole('button', { name: new RegExp(`^${label.replace(/[,.]/g, '\\$&')}, pays`) });

test('a whole game: guesses go on the board, bets and staked chips pay out, the best score wins', async ({ people }) => {
  const { host, ana, ben } = await startGame(people);
  const big = frame(host.page);

  // Question 1: the keypad, then the odds board.
  await expect(ana.getByText('Question 1 of 7')).toBeVisible({ timeout: 15_000 });
  await guess(ana, '0');
  await expect(ana.getByText(/^You guessed 0 /)).toBeVisible();
  await expect(big.getByText('1 of 2 locked in.', { exact: false })).toBeVisible();
  await guess(ben, BIG);
  // Everyone locked in: the board, smallest first, with "Smaller than all" on the left.
  await expect(big.getByText('Smaller than all')).toBeVisible();
  await expect(big.getByText('9,999,999,999')).toBeVisible();
  await expect(big.locator('.odds')).toHaveText(['×6', '×2', '×2']);

  // Ana puts both free bets on her own guess; Ben bets on his.
  await slot(ana, '0').click();
  await slot(ana, '0').click();
  await expect(ana.getByText('Tap a guess to bet on it (0 free bets left).')).toBeVisible();
  await ana.getByRole('button', { name: 'Lock bets' }).click();
  await slot(ben, '9,999,999,999').click();
  await ben.getByRole('button', { name: 'Lock bets' }).click();

  // The reveal: Ana's 0 wins. 2 tokens × odds 2 + 3 for the closest guess = 7.
  await expect(big.getByText('Ana was closest: +3')).toBeVisible();
  await expect(ana.locator('.result')).toHaveText('+7');
  await expect(ben.locator('.result')).toHaveText('±0');
  await expect(big.getByText('The standings')).toBeVisible({ timeout: 15_000 });
  await expect(ana.getByText("You're 1st of 2.")).toBeVisible();

  // Question 2: Ana stakes 3 of her 7 points as chips on one bet; Ben backs Ana's guess for free.
  await guess(ana, '0');
  await guess(ben, BIG);
  await slot(ana, '0').click();
  await slot(ana, '0').click();
  const more = ana.getByRole('button', { name: 'More chips on 0' }).first();
  for (let i = 0; i < 3; i++) await more.click();
  await expect(ana.getByLabel('Chips on 0', { exact: true }).first()).toHaveText('3 chips');
  await ana.getByRole('button', { name: 'Lock bets' }).click();
  await expect(ben.getByRole('button', { name: 'More chips on 0' })).toHaveCount(0); // no bets yet
  await slot(ben, '0').click();
  await expect(ben.getByRole('button', { name: 'More chips on 0' })).toBeDisabled(); // 0 points: nothing to stake
  await ben.getByRole('button', { name: 'Lock bets' }).click();
  // Ana: 2 × (1 + 3) + 2 + 3 = 13, so 20. Ben: 2, for backing the right guess.
  await expect(ana.locator('.result')).toHaveText('+13');
  await expect(ben.locator('.result')).toHaveText('+2');
  await expect(ana.getByText('20 points')).toBeVisible();
  await expect(ben.getByText('2 points')).toBeVisible();

  // Question 3: the big screen reloads during the bets and carries on with the same board.
  await guess(ana, '0');
  await guess(ben, BIG);
  await slot(ana, '0').click();
  await expect(big.locator('.chip')).toHaveCount(1);
  await host.page.reload();
  await expect(big.getByText('Question 3 of 7')).toBeVisible();
  await expect(big.locator('.odds')).toHaveText(['×6', '×2', '×2']);
  await expect(big.locator('.chip')).toHaveCount(1); // Ana's bet survived the reload
  await expect(host.page.getByText(/stopped/)).toHaveCount(0);
  await ana.getByRole('button', { name: 'Lock bets' }).click();
  await ben.getByRole('button', { name: 'Skip betting' }).click();
  await expect(ana.locator('.result')).toHaveText('+5'); // 2 + 3

  // Questions 4–7: quick guesses, no bets (Ana gets +3 each time for the closest guess).
  for (let q = 4; q <= 7; q++) {
    await expect(ana.getByText(`Question ${q} of 7`)).toBeVisible({ timeout: 20_000 });
    await guess(ana, '0');
    await guess(ben, BIG);
    await ana.getByRole('button', { name: 'Skip betting' }).click();
    await ben.getByRole('button', { name: 'Skip betting' }).click();
    await expect(ana.locator('.result')).toHaveText('+3');
  }

  // 7 + 13 + 5 + 4 × 3 = 37 for Ana, 2 for Ben.
  await expect(big.getByText('Ana wins!')).toBeVisible({ timeout: 20_000 });
  await expect(ana.getByText('You win!')).toBeVisible();
  await expect(ana.getByText('You finished with 37 points.')).toBeVisible();
  await expect(ben.getByText('You finished with 2 points.')).toBeVisible();
  await expect(host.page.getByText('Ana won the last game!')).toBeVisible({ timeout: 20_000 });
});

test('a phone can type with the keypad, delete, and the big screen never shows a guess before the board', async ({ people }) => {
  const { host, ana, ben } = await startGame(people);
  const big = frame(host.page);
  await expect(ana.getByRole('button', { name: 'Lock in' })).toBeDisabled({ timeout: 15_000 });
  for (const d of ['1', '2', '3', '4']) await ana.getByRole('button', { name: d, exact: true }).click();
  await expect(ana.getByRole('status', { name: 'Your guess' })).toHaveText('1,234');
  await ana.getByRole('button', { name: 'Delete' }).click();
  await expect(ana.getByRole('status', { name: 'Your guess' })).toHaveText('123');
  await ana.getByRole('button', { name: 'Lock in' }).click();
  await expect(ana.getByText(/^You guessed 123 /)).toBeVisible();
  await expect(big.getByText('123')).toHaveCount(0);
  await guess(ben, '500');
  await expect(big.locator('.plate .num')).toHaveText(['Smaller than all', '123', '500']);
});
