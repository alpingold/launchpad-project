import { test, expect } from './helpers.js';

// Sketch & Guess (plan §12, K4) with real phones: one draws, the other guesses.
test.setTimeout(60_000);

test('draw on one phone, see it everywhere, guess wrong then right', async ({ people }) => {
  const host = await people.host({ gameOptions: { rounds: 1 } });
  const alex = await people.player(host.code, 'Alex');
  const blake = await people.player(host.code, 'Blake');
  await host.page.getByRole('combobox', { name: 'Game' }).selectOption('sketch-guess');
  await host.page.getByRole('button', { name: 'Start game' }).click();

  // Alex (the first player) gets the secret word and the drawing pad.
  await expect(alex.page.getByText('Your word (keep it secret!):')).toBeVisible();
  const word = await alex.page.locator('.view h2').first().textContent();
  await expect(host.page.getByRole('heading', { name: 'Alex is drawing…' })).toBeVisible();
  await expect(blake.page.getByRole('heading', { name: 'Alex is drawing…' })).toBeVisible();
  await expect(blake.page.getByText(word, { exact: true })).toHaveCount(0); // the word stays secret

  const canvas = alex.page.getByRole('img', { name: 'Drawing area' });
  const box = await canvas.boundingBox();
  await alex.page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await alex.page.mouse.down();
  await alex.page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, { steps: 10 });
  await alex.page.mouse.up();
  await alex.page.getByRole('button', { name: 'Done!' }).click();

  // The drawing shows on the big screen and Blake's phone.
  await expect(host.page.getByRole('heading', { name: 'What did Alex draw?' })).toBeVisible();
  await expect(host.page.getByRole('img', { name: 'A drawing' }).locator('polyline')).toHaveCount(1);
  await expect(blake.page.getByRole('img', { name: 'A drawing' })).toBeVisible();

  // A wrong guess: Blake gets a fresh box, the big screen shows the guess.
  await blake.page.getByPlaceholder('Your guess').fill('a potato');
  await blake.page.getByRole('button', { name: 'Guess' }).click();
  await expect(blake.page.getByText('Not “a potato”. Try again!')).toBeVisible();
  await expect(host.page.getByText('Blake: “a potato”?')).toBeVisible();
  await expect(blake.page.getByPlaceholder('Your guess')).toHaveValue('');

  // The right guess (any capitalization) ends the round: Blake is the only guesser.
  await blake.page.getByPlaceholder('Your guess').fill(word.toUpperCase());
  await blake.page.getByRole('button', { name: 'Guess' }).click();
  await expect(host.page.getByRole('heading', { name: 'The word was' })).toBeVisible();
  await expect(host.page.getByRole('heading', { name: word, exact: true })).toBeVisible();
  await expect(blake.page.getByText('+3 points')).toBeVisible();
  await expect(alex.page.getByText('+1 point', { exact: true })).toBeVisible();
});
