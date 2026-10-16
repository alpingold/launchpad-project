import { test, expect, chooseGame } from './helpers.js';

// party.ui, the helpers inside every game frame (plan §13, F2), end to end with the
// test-only UI Demo game (e2e/server/ui-demo.html): phones use them, the big screen logs
// what arrived.

const frame = (page) => page.frameLocator('iframe.game-frame');

async function startDemo(people) {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex');
  await chooseGame(host.page, 'ui-demo');
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(frame(alex.page).getByRole('heading', { name: 'Phone Alex' })).toBeVisible();
  const log = frame(host.page).getByRole('list', { name: 'Log' });
  return { host, alex, log };
}

/** True if a canvas in the frame has any pixel that isn't fully transparent or pure white. */
async function hasInk(locator) {
  return locator.evaluate((canvas) => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0 && (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240)) return true;
    }
    return false;
  });
}

test('joystick: drag to steer, let go to stop', async ({ people }) => {
  const { alex, log } = await startDemo(people);
  const stick = await frame(alex.page).getByRole('application', { name: 'Joystick: drag to steer' }).boundingBox();
  const centre = { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 };
  await alex.page.mouse.move(centre.x, centre.y);
  await alex.page.mouse.down();
  await alex.page.mouse.move(stick.x + stick.width, centre.y, { steps: 4 });
  await expect(log).toContainText('stick Alex: 1.00, 0.00');
  await alex.page.mouse.up();
  await expect(log).toContainText('stick Alex: 0.00, 0.00');
});

test('gamepad: hold and release, with the mouse and with keys; the ASCII map and scoreboard follow', async ({ people }) => {
  const { host, alex, log } = await startDemo(people);
  const right = frame(alex.page).getByRole('button', { name: 'Right' });
  await right.hover();
  await alex.page.mouse.down();
  await expect(log).toContainText('pad Alex: right');
  await alex.page.mouse.up();
  await expect(log).toContainText('pad Alex: none');
  await expect(log).toContainText('Alex at 3,3'); // moved one step on the map

  await frame(alex.page).locator('body').click({ position: { x: 5, y: 5 } }); // focus the frame for keys
  await alex.page.keyboard.press('Space'); // the first button's key: Jump
  await expect(log).toContainText('pad Alex: jump');
  const scores = frame(host.page).getByRole('table');
  await expect(scores.getByRole('row').first()).toContainText(/Alex\s*1/);
  expect(await hasInk(frame(host.page).getByRole('img', { name: 'Game map' }))).toBe(true);
});

test('drawing pad: draw, send, and the big screen shows it; the timer counts down', async ({ people }) => {
  const { host, alex, log } = await startDemo(people);
  const paper = frame(alex.page).getByRole('img', { name: 'Drawing pad' });
  const box = await paper.boundingBox();
  await alex.page.mouse.move(box.x + 20, box.y + 20);
  await alex.page.mouse.down();
  await alex.page.mouse.move(box.x + box.width - 20, box.y + box.height - 20, { steps: 10 });
  await alex.page.mouse.up();
  await frame(alex.page).getByRole('button', { name: 'Send drawing' }).click();
  await expect(log).toContainText('drawing Alex: 1 strokes');
  expect(await hasInk(frame(host.page).getByRole('img', { name: 'Last drawing' }))).toBe(true);

  const seconds = frame(host.page).getByRole('timer');
  await expect(seconds).toContainText(/^(59|60)$/);
  await expect(seconds).toContainText(/^5[0-8]$/, { timeout: 5000 });
});

test('party.kit is in every frame; the countdown counts down to GO; a wider map scrolls, with fog (plan §13o)', async ({ people }) => {
  const { host, alex, log } = await startDemo(people);
  await expect(log).toContainText('kit: 3rd, ranked, #e53935'); // ordinal, rank and colorOf, inside the frame
  await expect(log).toContainText('world camera 0');

  // Step right 8 times with the arrow key: the world camera follows (2 tiles a step, centred).
  await frame(alex.page).locator('body').click({ position: { x: 5, y: 5 } });
  for (let i = 0; i < 8; i++) {
    await alex.page.keyboard.press('ArrowRight');
    await expect(log).toContainText(`Alex at ${3 + i},3`);
  }
  await expect(log).toContainText('world camera 14');
  expect(await hasInk(frame(host.page).getByRole('img', { name: 'World map' }))).toBe(true);

  // The countdown: numbers, then GO!, then it's gone; onGo ran.
  await frame(alex.page).getByRole('button', { name: 'Countdown' }).click();
  const big = frame(host.page).locator('.pu-countdown');
  await expect(big).toHaveText(/^[12]$/);
  await expect(big).toHaveText('GO!', { timeout: 4000 });
  await expect(log).toContainText('countdown: GO');
  await expect(big).toHaveCount(0);
});
