import { test, expect } from './helpers.js';

// The input blocks (plan §12, K2), through the real phone page and server, using the
// test-only "Input Test" game (e2e/server/inputGame.js): it asks each phone for every kind
// of input in turn and lists what it received on the big screen.

test('type, slide, tick and rank on a phone; the game gets checked values', async ({ people }) => {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex');
  await host.page.getByRole('combobox', { name: 'Game' }).selectOption('input-test');
  await host.page.getByRole('button', { name: 'Start game' }).click();
  const phone = alex.page;

  // Text: Send stays disabled until there's something to send; the server trims it.
  const send = phone.getByRole('button', { name: 'Send' });
  await expect(send).toBeDisabled();
  await phone.getByLabel('Say something').fill('   Hello there   ');
  await send.click();
  await expect(host.page.getByText('Alex text: "Hello there"')).toBeVisible();

  // Slider: starts at its initial value.
  await expect(phone.locator('output')).toHaveText('5');
  await phone.getByLabel('How many?').fill('8');
  await expect(phone.locator('output')).toHaveText('8');
  await phone.getByRole('button', { name: 'Send' }).click();
  await expect(host.page.getByText('Alex slider: 8')).toBeVisible();

  // Multi choice: at most 2, so the third option locks once two are ticked.
  await expect(phone.getByText('Pick 1–2')).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Send' })).toBeDisabled();
  await phone.getByRole('button', { name: 'Olives' }).click();
  await phone.getByRole('button', { name: 'Cheese' }).click();
  await expect(phone.getByRole('button', { name: 'Pineapple' })).toBeDisabled();
  await expect(phone.getByRole('button', { name: '✓ Olives' })).toHaveAttribute('aria-pressed', 'true');
  await phone.getByRole('button', { name: 'Send' }).click();
  await expect(host.page.getByText('Alex multi: [0,2]')).toBeVisible();

  // Rank: move Dinner to the top.
  await phone.getByRole('button', { name: 'Move Dinner up' }).click();
  await phone.getByRole('button', { name: 'Move Dinner up' }).click();
  await expect(phone.locator('.rank-label')).toHaveText(['Dinner', 'Breakfast', 'Lunch']);
  await expect(phone.getByRole('button', { name: 'Move Dinner up' })).toBeDisabled();
  await phone.getByRole('button', { name: 'Send' }).click();
  await expect(host.page.getByText('Alex rank: [2,0,1]')).toBeVisible();
  await expect(phone.getByRole('heading', { name: 'All done!' })).toBeVisible();
});

test('after sending, the control shows "Sent" and locks until the game moves on', async ({ people }) => {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex', { controllable: true });
  const blake = await people.player(host.code, 'Blake');
  await host.page.getByRole('combobox', { name: 'Game' }).selectOption('input-test');
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(alex.page.getByLabel('Say something')).toBeVisible();

  // Hold back the server's messages to Alex, so the game's next screen can't replace the
  // control before we've looked at it (on localhost it arrives within milliseconds).
  alex.network.hold();
  await alex.page.getByLabel('Say something').fill('Hi');
  await alex.page.getByRole('button', { name: 'Send' }).click();
  await expect(alex.page.getByRole('button', { name: 'Sent ✓' })).toBeDisabled();
  await expect(alex.page.getByLabel('Say something')).toBeDisabled();
  alex.network.release();
  await expect(alex.page.getByLabel('How many?')).toBeVisible(); // then the next step arrives

  // Blake's screen is unaffected.
  await expect(blake.page.getByLabel('Say something')).toBeEnabled();
});
