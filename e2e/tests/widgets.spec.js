import { test, expect } from './helpers.js';

// The widgets (plan §12, K3) on a real phone page, using the test-only "Widget Test" game
// (e2e/server/widgetGame.js): reaction, mash, timing bar, tap targets, then a drawing.
// The big screen lists what the game received.
test.setTimeout(60_000);

async function startWidgetGame(people) {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex');
  await host.page.getByRole('combobox', { name: 'Game' }).selectOption('widget-test');
  await host.page.getByRole('button', { name: 'Start game' }).click();
  return { host, phone: alex.page };
}

test('every widget, start to finish; the game gets each result', async ({ people }) => {
  const { host, phone } = await startWidgetGame(people);

  // Reaction: wait for GO, then tap. The phone measures the time itself.
  await expect(phone.getByRole('button', { name: 'Wait for it…' })).toBeVisible();
  await phone.getByRole('button', { name: 'TAP!' }).click();
  await expect(phone.getByRole('button', { name: /^\d+ ms$/ })).toBeDisabled();
  await expect(host.page.getByText(/^Alex reaction: \{"ms":\d+\}$/)).toBeVisible();

  // Mash: a countdown, then count taps for 2 s; the phone sends the count by itself.
  await expect(phone.getByRole('status')).toHaveText(/Get ready…/);
  const mash = phone.getByRole('button', { name: /TAP!/ });
  await expect(mash).toBeEnabled();
  for (let i = 0; i < 5; i++) await mash.click();
  await expect(host.page.getByText('Alex mash: {"taps":5}')).toBeVisible({ timeout: 5000 });

  // Timing bar: stop the moving marker.
  await expect(phone.getByText('Stop in the green')).toBeVisible();
  await phone.getByRole('button', { name: 'STOP!' }).click();
  await expect(phone.getByRole('button', { name: /^(Nailed it!|Missed!)$/ })).toBeDisabled();
  await expect(host.page.getByText(/^Alex timing: \{"position":\d+\}$/)).toBeVisible();

  // Tap targets: three in a row; sent as soon as the last one is hit.
  for (const n of [1, 2, 3]) await phone.getByRole('button', { name: `Target ${n}` }).click();
  await expect(host.page.getByText(/^Alex targets: \{"hits":3,"ms":\d+\}$/)).toBeVisible();

  // Draw two lines (one red), undo nothing, send; the big screen shows the drawing.
  const canvas = phone.getByRole('img', { name: 'Drawing area' });
  await expect(phone.getByRole('button', { name: 'Send' })).toBeDisabled();
  await drag(phone, canvas, [0.2, 0.2], [0.8, 0.8]);
  await phone.getByRole('button', { name: 'red' }).click();
  await drag(phone, canvas, [0.8, 0.2], [0.2, 0.8]);
  await phone.getByRole('button', { name: 'Send' }).click();
  await expect(host.page.getByText('Alex draw: 2 strokes')).toBeVisible();
  const shown = host.page.getByRole('img', { name: "Alex's drawing" });
  await expect(shown).toBeVisible();
  await expect(shown.locator('polyline')).toHaveCount(2);
  await expect(phone.getByRole('heading', { name: 'All done!' })).toBeVisible();
});

test('tapping before GO is a false start', async ({ people }) => {
  const { host, phone } = await startWidgetGame(people);
  await phone.getByRole('button', { name: 'Wait for it…' }).click();
  await expect(phone.getByRole('button', { name: 'Too soon!' })).toBeDisabled();
  await expect(host.page.getByText('Alex reaction: {"early":true}')).toBeVisible();
});

test('drawing tools: undo and clear', async ({ people }) => {
  const { phone } = await startWidgetGame(people);
  // Skip ahead to the drawing: react, mash (no taps), stop the bar, wait out the targets.
  await phone.getByRole('button', { name: 'TAP!' }).click();
  await expect(phone.getByText('Stop in the green')).toBeVisible({ timeout: 6000 });
  await phone.getByRole('button', { name: 'STOP!' }).click();
  for (const n of [1, 2, 3]) await phone.getByRole('button', { name: `Target ${n}` }).click();

  const canvas = phone.getByRole('img', { name: 'Drawing area' });
  const lines = canvas.locator('polyline');
  await drag(phone, canvas, [0.1, 0.5], [0.9, 0.5]);
  await drag(phone, canvas, [0.5, 0.1], [0.5, 0.9]);
  await expect(lines).toHaveCount(2);
  await phone.getByRole('button', { name: 'Undo' }).click();
  await expect(lines).toHaveCount(1);
  await phone.getByRole('button', { name: 'Clear' }).click();
  await expect(lines).toHaveCount(0);
  await expect(phone.getByRole('button', { name: 'Send' })).toBeDisabled();
});

/** Drags across an element, from and to fractions of its size, in several steps. */
async function drag(page, locator, [x1, y1], [x2, y2]) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x2, box.y + box.height * y2, { steps: 10 });
  await page.mouse.up();
}
