import { test, expect } from './helpers.js';

// The generator's starter templates (generator/templates/, plan §13i): each one is a tiny
// working game. Play each a little (or all the way through) with one phone.
test.setTimeout(60_000);

const frame = (page) => page.frameLocator('iframe.game-frame');

async function start(people, gameId) {
  const host = await people.host({ game: gameId });
  const alex = await people.player(host.code, 'Alex');
  await host.page.getByRole('button', { name: 'Start game' }).click();
  return { host, alex };
}

test('rounds: three rounds of Unique Number, then the winner', async ({ people }) => {
  const { host, alex } = await start(people, 'template-rounds');
  for (const round of [1, 2, 3]) {
    await expect(frame(alex.page).getByRole('status')).toHaveText(`Round ${round}: pick a number`);
    await frame(alex.page).getByRole('button', { name: '4' }).click(); // alone, every pick is unique
    await expect(frame(alex.page).getByRole('status')).toHaveText('+4 points!');
  }
  await expect(frame(host.page).getByText('Alex wins!')).toBeVisible();
  await expect(alex.page.getByText('You won the last game!')).toBeVisible({ timeout: 15_000 });
});

test('realtime: the game runs, the joystick sends, and the host can stop it', async ({ people }) => {
  const { host, alex } = await start(people, 'template-realtime');
  await expect(frame(alex.page).getByRole('status')).toHaveText('Catch the stars! First to 5.');
  await expect(frame(host.page).getByRole('img', { name: 'The game' })).toBeVisible();
  const pad = await frame(alex.page).getByRole('application').boundingBox();
  await alex.page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
  await alex.page.mouse.down();
  await alex.page.mouse.move(pad.x + pad.width, pad.y + pad.height / 2, { steps: 3 });
  await alex.page.mouse.up();
  await host.page.getByRole('button', { name: 'Stop game' }).click();
  await expect(alex.page.getByText('The host stopped the game.')).toBeVisible();
});

test('turns: on your turn, pick a direction; the log says where you went', async ({ people }) => {
  const { host, alex } = await start(people, 'template-turns');
  await expect(frame(alex.page).getByRole('status')).toHaveText(/^Your turn! You rolled [123]\.$/);
  await frame(alex.page).getByRole('button', { name: 'East' }).click();
  await expect(frame(host.page).getByRole('list', { name: 'Log' })).toContainText(/Alex rolled [123] and went east [123] steps?\./);
  await expect(frame(alex.page).getByRole('status')).toHaveText(/^Your turn! You rolled [123]\.$/); // alone: your turn again

  await host.page.reload(); // the big screen picks up mid-game
  await expect(frame(host.page).getByRole('list', { name: 'Log' })).toContainText('went east');
});
