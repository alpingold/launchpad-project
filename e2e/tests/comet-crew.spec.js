import { test, expect } from './helpers.js';

// Comet Crew, the co-op ship game: each phone is one station on the same ship. Two phones
// fly wave 1 (helm and gunner; the gun overheats if you never let go), swap stations for
// wave 2, and the new shield operator turns the shield to meet the first comet. (~65 s: the
// game's own timers, a 10 s briefing and a 35 s wave, run at full length.)
test.setTimeout(150_000);

const frame = (page) => page.frameLocator('iframe.game-frame');

/** Opens a room for Comet Crew with these phones and starts the game. */
async function startGame(people, names) {
  const host = await people.host({ game: 'comet-crew' });
  const phones = {};
  for (const name of names) phones[name] = await people.player(host.code, name);
  await expect(host.page.getByRole('heading', { name: 'Next game: Comet Crew' })).toBeVisible();
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(frame(host.page).getByRole('heading', { name: 'Wave 1 of 6' })).toBeVisible();
  return { host, phones };
}

/** The station a phone is on, from the big name on its station card. */
const station = (phone) => frame(phone.page).locator('#station b');

test('two phones crew the ship: the gun overheats, stations rotate, and the shield blocks a comet', async ({ people }) => {
  const { host, phones } = await startGame(people, ['Ana', 'Ben']);
  const big = frame(host.page);
  const { Ana, Ben } = phones;

  // Wave 1: Ana steers, Ben shoots; Shields and Engineer fly on autopilot.
  await expect(station(Ana)).toHaveText('Helm');
  await expect(station(Ben)).toHaveText('Gunner');
  await expect(big.getByText('Ana → Helm')).toBeVisible();
  await expect(big.getByText('autopilot')).toHaveCount(2);

  // Once the wave starts, Ben holds the stick right: the turret fires until it overheats.
  await expect(frame(Ben.page).getByLabel('Aim and fire')).toBeVisible({ timeout: 15_000 });
  await frame(Ben.page).locator('#station').click();
  await Ben.page.keyboard.down('ArrowRight');
  await expect(frame(Ben.page).getByText(/Overheated!|Guns jammed/)).toBeVisible({ timeout: 8_000 });
  await Ben.page.keyboard.up('ArrowRight');

  // After 35 s the wave ends and everyone moves one station along.
  await expect(big.getByRole('heading', { name: 'Wave 2 of 6' })).toBeVisible({ timeout: 45_000 });
  await expect(big.getByText('Ben → Shields')).toBeVisible();
  await expect(station(Ana)).toHaveText('Gunner');
  await expect(station(Ben)).toHaveText('Shields');

  // Wave 2 brings comets. Ben's phone warns where the first one comes from; he turns the
  // shield that way and the big screen shows the block.
  const warning = frame(Ben.page).locator('.warn').first();
  await expect(warning).toBeVisible({ timeout: 25_000 });
  const side = await warning.getAttribute('data-side');
  await frame(Ben.page).getByRole('button', { name: `Shield ${side}` }).click();
  await expect(frame(Ben.page).getByRole('button', { name: `Shield ${side}` })).toHaveAttribute('aria-pressed', 'true');
  await expect(big.getByText('Blocked!')).toBeVisible({ timeout: 6_000 });
});

test('four phones get the four stations, and a big-screen reload restarts the wave with the same crew', async ({ people }) => {
  const names = ['Ana', 'Ben', 'Cal', 'Dot'];
  const { host, phones } = await startGame(people, names);
  const big = frame(host.page);

  const expected = { Ana: 'Helm', Ben: 'Gunner', Cal: 'Shields', Dot: 'Engineer' };
  for (const name of names) await expect(station(phones[name])).toHaveText(expected[name]);
  await expect(big.getByText('autopilot')).toHaveCount(0);

  // The wave starts: the engineer has rooms to watch and a patch button (the hull is full).
  await expect(frame(phones.Dot.page).getByRole('button', { name: /Patch hull/ })).toBeDisabled({ timeout: 15_000 });
  await expect(frame(phones.Cal.page).getByRole('button', { name: 'Shield top' })).toBeVisible();

  await host.page.reload();
  await expect(frame(host.page).getByRole('heading', { name: 'Back on course: wave 1' })).toBeVisible();
  await expect(host.page.getByText(/stopped/)).toHaveCount(0);
  for (const name of names) await expect(station(phones[name])).toHaveText(expected[name]);
});
