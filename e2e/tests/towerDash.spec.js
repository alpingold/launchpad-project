import { test, expect } from './helpers.js';

// Tower Dash (plan §13j): an ASCII platformer. Level 1 is a flat run, so holding ◀▶'s
// right button is enough to reach the exit.
test.setTimeout(60_000);

const frame = (page) => page.frameLocator('iframe.game-frame');

test('hold right to run to the exit; the phone counts down the distance and says who finished', async ({ people }) => {
  const host = await people.host({ game: 'tower-dash' });
  const alex = await people.player(host.code, 'Alex');
  await host.page.getByRole('button', { name: 'Start game' }).click();

  await expect(frame(host.page).getByRole('heading', { name: 'Level 1 of 3: Warm-up run' })).toBeVisible();
  const status = frame(alex.page).getByRole('status');
  await expect(status).toHaveText('Level 1: run to the > !');
  await expect(frame(alex.page).getByText(/Exit: 4\d tiles away/)).toBeVisible();

  const right = frame(alex.page).getByRole('button', { name: 'Right' });
  await right.hover();
  await alex.page.mouse.down();
  await expect(frame(alex.page).getByText(/Exit: [0-3]?\d tiles away/)).toBeVisible(); // getting closer
  // Alone, finishing ends the level: 5 points for 1st.
  await expect(frame(host.page).getByRole('status')).toHaveText('Alex wins the level!', { timeout: 15_000 });
  await alex.page.mouse.up();
  await expect(frame(alex.page).getByText('Points: 5')).toBeVisible();
  await expect(frame(host.page).getByRole('heading', { name: 'Level 2 of 3: Spike pits' })).toBeVisible({ timeout: 10_000 });
});
