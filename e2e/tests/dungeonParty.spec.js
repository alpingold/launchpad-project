import { test, expect, chooseGame } from './helpers.js';

// Dungeon Party (plan §13j): a turn-based co-op ASCII RPG. Alex is the Knight, Blake the Mage.
test.setTimeout(60_000);

const frame = (page) => page.frameLocator('iframe.game-frame');

test('vote on a door, then take turns: attack a chosen goblin, cast a fireball; a reload carries on', async ({ people }) => {
  const host = await people.host();
  const alex = await people.player(host.code, 'Alex');
  const blake = await people.player(host.code, 'Blake');
  await chooseGame(host.page, 'dungeon-party');
  await host.page.getByRole('button', { name: 'Start game' }).click();

  await expect(frame(alex.page).getByText('Alex the Knight')).toBeVisible();
  await expect(frame(blake.page).getByText('Blake the Mage')).toBeVisible();
  const log = frame(host.page).getByRole('list', { name: 'Battle log' });

  // Everyone votes; the East door leads to the goblin den.
  await frame(alex.page).getByRole('button', { name: 'East door' }).click();
  await expect(frame(alex.page).getByRole('button', { name: 'East door ✓' })).toBeVisible();
  await frame(blake.page).getByRole('button', { name: 'East door' }).click();
  await expect(log).toContainText('The party heads east.');
  await expect(log).toContainText('2 Goblins attack!');

  // Alex's turn: attack, pick a goblin.
  await expect(frame(alex.page).getByRole('status')).toHaveText('Your turn!');
  await expect(frame(blake.page).getByRole('status')).toHaveText("Alex's turn…");
  await frame(alex.page).getByRole('button', { name: 'Attack' }).click();
  await frame(alex.page).getByRole('button', { name: /Goblin 2/ }).click();
  await expect(log).toContainText('Alex hits the Goblin 2');

  // Blake's turn: Fireball hits both goblins (and costs 3 MP).
  await expect(frame(blake.page).getByRole('status')).toHaveText('Your turn!');
  await frame(blake.page).getByRole('button', { name: 'Fireball' }).click();
  await expect(log).toContainText('Blake casts Fireball: Goblin 1');
  await expect(frame(blake.page).getByText(/MP 6\/9/)).toBeVisible();

  // The big screen reloads mid-fight: same fight, same log, Alex's turn again.
  await expect(frame(alex.page).getByRole('status')).toHaveText('Your turn!');
  await host.page.reload();
  await expect(frame(host.page).getByRole('list', { name: 'Battle log' })).toContainText('Blake casts Fireball');
  await expect(frame(alex.page).getByRole('status')).toHaveText('Your turn!');
  await frame(alex.page).getByRole('button', { name: 'Defend' }).click();
  await expect(frame(host.page).getByRole('list', { name: 'Battle log' })).toContainText('Alex defends.');
});
