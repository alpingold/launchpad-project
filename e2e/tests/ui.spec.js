import { test, expect } from './helpers.js';

// party.ui, the helpers inside every game frame (plan §13, F2), end to end with the
// test-only UI Demo game (e2e/server/ui-demo.html): phones use them, the big screen logs
// what arrived.

const frame = (page) => page.frameLocator('iframe.game-frame');

async function startDemo(people) {
  const host = await people.host({ game: 'ui-demo' });
  const alex = await people.player(host.code, 'Alex');
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

test('joystick (plan §21): it starts where the thumb lands, and a small wobble there sends nothing', async ({ people }) => {
  const { alex, log } = await startDemo(people);
  const stick = await frame(alex.page).getByRole('application', { name: 'Joystick: drag to steer' }).boundingBox();
  const start = { x: stick.x + stick.width * 0.3, y: stick.y + stick.height * 0.7 }; // off-centre: the lower left
  await alex.page.mouse.move(start.x, start.y);
  await alex.page.mouse.down();
  await alex.page.mouse.move(start.x + 4, start.y - 3, { steps: 2 }); // inside the dead zone
  await alex.page.waitForTimeout(300);
  await expect(log).not.toContainText('stick Alex');
  await alex.page.mouse.move(start.x, start.y - stick.height * 0.4, { steps: 4 }); // straight up from where it landed
  await expect(log).toContainText('stick Alex: 0.00, -1.00');
  await alex.page.mouse.up();
});

test('gamepad (plan §21): a finger slides from one button to the next without lifting', async ({ people }) => {
  const { alex, log } = await startDemo(people);
  const left = await frame(alex.page).getByRole('button', { name: 'Left' }).boundingBox();
  const right = await frame(alex.page).getByRole('button', { name: 'Right' }).boundingBox();
  await alex.page.mouse.move(left.x + left.width / 2, left.y + left.height / 2);
  await alex.page.mouse.down();
  await expect(log).toContainText('pad Alex: left');
  await alex.page.mouse.move(right.x + right.width / 2, right.y + right.height / 2, { steps: 6 });
  await expect(log).toContainText('pad Alex: right'); // left let go, right held
  await alex.page.mouse.up();
  await expect(log).toContainText('pad Alex: none');
});

test('text input (plan §21): Enter sends, the box empties, empty answers are ignored; text big enough not to zoom', async ({ people }) => {
  const { alex, log } = await startDemo(people);
  const box = frame(alex.page).getByRole('textbox', { name: 'Your answer' });
  expect(await box.evaluate((input) => parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(16);
  await expect(box).toHaveAttribute('enterkeyhint', 'send');
  await box.fill('   ');
  await box.press('Enter');
  await box.fill('a llama in pajamas');
  await expect(frame(alex.page).getByText('18/40')).toBeVisible();
  await box.press('Enter');
  await expect(log).toContainText('answer Alex: a llama in pajamas');
  await expect(log.getByText(/^answer Alex/)).toHaveCount(1); // the blank one was never sent
  await expect(box).toHaveValue('');
});

test('text input with lockOnSubmit: sent once, then locked with the text still showing', async ({ people }) => {
  const { alex, log } = await startDemo(people);
  const box = frame(alex.page).getByRole('textbox', { name: 'Locked answer' });
  await box.fill('my one answer');
  await box.press('Enter');
  await expect(log).toContainText('answer Alex: locked my one answer');
  await expect(box).toBeDisabled();
  await expect(box).toHaveValue('my one answer');
  await expect(frame(alex.page).getByRole('button', { name: 'Sent ✓' })).toBeDisabled();
  await expect(log.getByText(/^answer Alex: locked/)).toHaveCount(1);
});

test('sound (plan §21): a phone and the big screen can play sounds; the frame may play audio', async ({ people }) => {
  const { host, alex, log } = await startDemo(people);
  await expect(host.page.locator('iframe.game-frame')).toHaveAttribute('allow', 'autoplay');
  await frame(alex.page).getByRole('button', { name: 'Beep' }).click();
  await expect(log).toContainText('sound Alex: true');
  await frame(alex.page).getByRole('textbox', { name: 'Your answer' }).fill('yes');
  await frame(alex.page).getByRole('textbox', { name: 'Your answer' }).press('Enter');
  await expect(log).toContainText('host sound: true');
});

test('gamepad: hold and release, with the mouse and with keys; the map and the tap count follow', async ({ people }) => {
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
  await expect(frame(host.page).locator('#scores')).toContainText('Alex: 1');
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

  // A new timer for the same deadline (a game rebuilding its screen) carries on, not full (§36a).
  const width = await frame(host.page).locator('body').evaluate(() => {
    const box = document.createElement('div');
    document.body.append(box);
    window.party.ui.timer(box, { endsAt: window.demoEndsAt });
    return parseFloat(box.querySelector('.pu-timer-fill').style.width);
  });
  expect(width).toBeLessThan(98);
});

test('the countdown counts down to GO; party.kit is gone (plan §20)', async ({ people }) => {
  const { host, alex, log } = await startDemo(people);
  expect(await frame(host.page).locator('body').evaluate(() => 'kit' in window.party)).toBe(false);

  // The countdown: numbers, then GO!, then it's gone; onGo ran.
  await frame(alex.page).getByRole('button', { name: 'Countdown' }).click();
  const big = frame(host.page).locator('.pu-countdown');
  await expect(big).toHaveText(/^[12]$/);
  await expect(big).toHaveText('GO!', { timeout: 4000 });
  await expect(log).toContainText('countdown: GO');
  await expect(big).toHaveCount(0);
});

test('phone layout in a game (plan §21): no site header, the game nearly fills the screen, a slim bar with Leave', async ({ people }) => {
  const { alex } = await startDemo(people);
  await expect(alex.page.locator('.site-header')).toBeHidden();
  const bar = alex.page.locator('.phone-bar');
  await expect(bar).toContainText('Alex · room');
  await expect(bar).toContainText('BoilerGames never asks for your password in a game.'); // plan §57
  await expect(bar.getByRole('button', { name: 'Leave' })).toBeVisible();
  const frameBox = await alex.page.locator('iframe.game-frame').boundingBox();
  const { height } = alex.page.viewportSize();
  expect(frameBox.height).toBeGreaterThan(height - 70); // about all of it, minus the bar
});
