import { test, expect } from './helpers.js';

// Bumper Blobs (plan §13g), the first frame game: phones are joysticks, the big screen runs
// the physics. Blake holds his stick to the right for the whole game. He starts on the
// right, so he slides off the ice every round and Alex wins all three. (~30 s)
test.setTimeout(90_000);

const frame = (page) => page.frameLocator('iframe.game-frame');

test('steer with the joystick, fall off the ice, lose three rounds; the last blob standing wins', async ({ people }) => {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex');
  const blake = await people.player(host.code, 'Blake');
  await expect(host.page.getByRole('radio', { name: 'Bumper Blobs' })).toBeChecked();
  await host.page.getByRole('button', { name: 'Start game' }).click();

  // Each phone is a controller in its own colour; the big screen draws the arena.
  await expect(frame(alex.page).getByText("You're the Red blob")).toBeVisible();
  await expect(frame(blake.page).getByText("You're the Yellow blob")).toBeVisible();
  await expect(frame(blake.page).getByRole('status')).toHaveText('Round 1 of 3: get ready!');
  await expect(frame(host.page).locator('canvas')).toBeVisible();

  // Blake pushes his stick all the way right and keeps his thumb there.
  const pad = await frame(blake.page).getByLabel('Joystick: drag to steer').boundingBox();
  const centre = { x: pad.x + pad.width / 2, y: pad.y + pad.height / 2 };
  await blake.page.mouse.move(centre.x, centre.y);
  await blake.page.mouse.down();
  await blake.page.mouse.move(centre.x + pad.width / 2, centre.y, { steps: 5 });

  await expect(frame(blake.page).getByRole('status')).toHaveText('Alex wins the round.', { timeout: 15_000 });
  await expect(frame(alex.page).getByText('Rounds won: 1 of 3')).toBeVisible();

  await expect(alex.page.getByText('You won the last game!')).toBeVisible({ timeout: 45_000 });
  await expect(host.page.getByText('Alex won the last game!')).toBeVisible();
  await blake.page.mouse.up();
});

test('the big screen reloads mid-game and Bumper Blobs carries on, wins kept', async ({ people }) => {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex');
  const blake = await people.player(host.code, 'Blake');
  await host.page.getByRole('button', { name: 'Start game' }).click();

  // Blake slides off once: Alex has a round.
  const pad = await frame(blake.page).getByLabel('Joystick: drag to steer').boundingBox();
  await blake.page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
  await blake.page.mouse.down();
  await blake.page.mouse.move(pad.x + pad.width, pad.y + pad.height / 2, { steps: 3 });
  await expect(frame(alex.page).getByText('Rounds won: 1 of 3')).toBeVisible({ timeout: 15_000 });
  await blake.page.mouse.up();

  await host.page.reload();
  await expect(frame(alex.page).getByRole('status')).toHaveText('Round 2 of 3: get ready!');
  await expect(frame(alex.page).getByText('Rounds won: 1 of 3')).toBeVisible();
  await expect(host.page.getByText(/stopped/)).toHaveCount(0);
});
