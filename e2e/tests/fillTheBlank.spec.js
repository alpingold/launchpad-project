import { test, expect } from './helpers.js';

// Fill the Blank (plan §12, K4) with three real phones: write, vote, reveal.
test.setTimeout(60_000);

test('write answers, vote for one (never your own), see who wrote what', async ({ people }) => {
  const host = await people.host({ gameOptions: { rounds: 1 } });
  const phones = {};
  for (const name of ['Alex', 'Blake', 'Casey']) phones[name] = (await people.player(host.code, name)).page;
  await host.page.getByRole('combobox', { name: 'Game' }).selectOption('fill-the-blank');
  await host.page.getByRole('button', { name: 'Start game' }).click();

  await expect(host.page.getByText('0 of 3 answered')).toBeVisible();
  const answers = { Alex: 'a live goose', Blake: 'wet socks', Casey: 'a tuba' };
  for (const [name, text] of Object.entries(answers)) {
    await phones[name].getByPlaceholder('Your answer').fill(text);
    await phones[name].getByRole('button', { name: 'Send' }).click();
  }

  // Voting: Alex's choices leave out Alex's own answer.
  await expect(phones.Alex.getByRole('heading', { name: 'Which answer is funniest?' })).toBeVisible();
  await expect(phones.Alex.getByRole('button', { name: 'a live goose' })).toHaveCount(0);
  await expect(host.page.getByText('a live goose')).toBeVisible(); // all answers on the big screen
  await phones.Alex.getByRole('button', { name: 'a tuba' }).click();
  await phones.Blake.getByRole('button', { name: 'a tuba' }).click();
  await phones.Casey.getByRole('button', { name: 'wet socks' }).click();

  // The reveal, most votes first.
  await expect(host.page.getByText('by Casey · 2 votes')).toBeVisible();
  await expect(host.page.getByText('by Blake · 1 vote', { exact: true })).toBeVisible();
  await expect(phones.Casey.getByRole('heading', { name: 'Your answer got 2 votes!' })).toBeVisible();
  await expect(host.page.getByText('🏆 Casey won the last game!')).toBeVisible({ timeout: 20_000 });
});
