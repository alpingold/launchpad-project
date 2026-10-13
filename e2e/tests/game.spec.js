import { test, expect } from './helpers.js';

// Playing Reaction Race in real browsers: host big screen + phones.
// Games are shortened to 1 round (see gameOptions in helpers.js). Even so, each round waits
// a random 2–5 s for GO and the final scoreboard stays up for 6 s, so these tests are slower.
test.setTimeout(60_000);
const GO_WAIT = { timeout: 10_000 }; // GO comes 2–5 s after "Wait for it…"

async function startShortGame(people) {
  const host = await people.host({ gameOptions: { rounds: 1 } });
  const alex = await people.player(host.code, 'Alex');
  const blake = await people.player(host.code, 'Blake');
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(host.page.getByRole('heading', { name: 'Round 1 of 1' })).toBeVisible();
  return { host, alex, blake };
}

test('a whole game: wait, GO, first tap wins, final scores, back to the lobby', async ({ people }) => {
  const { host, alex, blake } = await startShortGame(people);
  await expect(alex.page.getByRole('button', { name: 'Wait for it…' })).toBeVisible();

  // GO: the host shows the GO sign art, phones show TAP!.
  await expect(alex.page.getByRole('button', { name: 'TAP!' })).toBeVisible(GO_WAIT);
  await expect(host.page.getByRole('heading', { name: 'GO!' })).toBeVisible();
  const goSign = host.page.getByRole('img', { name: 'Green GO sign' });
  await expect(goSign).toBeVisible();
  expect(await goSign.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0); // the file really loaded

  await alex.page.getByRole('button', { name: 'TAP!' }).click();
  await expect(alex.page.getByRole('heading', { name: 'You won this round!' })).toBeVisible();
  await expect(blake.page.getByRole('heading', { name: 'Alex was fastest!' })).toBeVisible();
  await expect(host.page.getByRole('heading', { name: 'Alex wins round 1!' })).toBeVisible();

  // Final scoreboard, with names looked up from the room.
  await expect(host.page.getByRole('heading', { name: 'Final scores' })).toBeVisible();
  await expect(host.page.locator('.scoreboard li')).toHaveText(['Alex1', 'Blake0']);
  await expect(alex.page.locator('.scoreboard li.you')).toContainText('Alex (you)');

  // Then everyone is back in the lobby, with the winner announced.
  await expect(host.page.getByText('🏆 Alex won the last game!')).toBeVisible({ timeout: 10_000 });
  await expect(alex.page.getByText('🏆 You won the last game!')).toBeVisible();
  await expect(blake.page.getByText('🏆 Alex won the last game!')).toBeVisible();
  await expect(host.page.getByRole('button', { name: 'Start game' })).toBeEnabled();
});

test('tapping before GO is a false start', async ({ people }) => {
  const { alex, blake } = await startShortGame(people);
  await blake.page.getByRole('button', { name: 'Wait for it…' }).click();
  await expect(blake.page.getByRole('heading', { name: 'Too soon!' })).toBeVisible();
  // Alex is unaffected and can still win.
  await expect(alex.page.getByRole('button', { name: 'TAP!' })).toBeVisible(GO_WAIT);
  await expect(blake.page.getByRole('heading', { name: 'Too soon!' })).toBeVisible();
});

test('if everyone taps too early, the round ends right away', async ({ people }) => {
  const { host, alex, blake } = await startShortGame(people);
  await alex.page.getByRole('button', { name: 'Wait for it…' }).click();
  await blake.page.getByRole('button', { name: 'Wait for it…' }).click();
  // Well under the 2–5 s GO wait plus 10 s timeout the old behavior needed.
  await expect(host.page.getByRole('heading', { name: 'Everyone tapped too early!' })).toBeVisible({ timeout: 1000 });
  await expect(alex.page.getByRole('heading', { name: 'Everyone tapped too early!' })).toBeVisible();
});

test('equal top scores are announced as a tie in the lobby', async ({ people }) => {
  const { host, alex, blake } = await startShortGame(people);
  // Both false-start, so the only round ends 0–0.
  await alex.page.getByRole('button', { name: 'Wait for it…' }).click();
  await blake.page.getByRole('button', { name: 'Wait for it…' }).click();
  await expect(host.page.getByText("🏆 It's a tie: Alex & Blake!")).toBeVisible({ timeout: 15_000 });
  await expect(alex.page.getByText("🏆 It's a tie: You & Blake!")).toBeVisible();
});

test('a phone refreshed mid-game gets its game screen back', async ({ people }) => {
  const { alex } = await startShortGame(people);
  await expect(alex.page.getByRole('button', { name: 'Wait for it…' })).toBeVisible();
  await alex.page.reload();
  // Back on the same spot, showing the current game screen (still waiting, or GO by now).
  await expect(alex.page.locator('.game-button')).toBeVisible();
  await expect(alex.page.getByText('Alex · room')).toBeVisible();
});

test('the host screen refreshed mid-game gets the big-screen view back', async ({ people }) => {
  const { host } = await startShortGame(people);
  await host.page.reload();
  await expect(host.page.getByText(`Room ${host.code}`)).toBeVisible();
  await expect(host.page.getByRole('heading', { name: /Round 1 of 1|GO!/ })).toBeVisible();
});
