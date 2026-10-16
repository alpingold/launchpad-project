import { test, expect } from './helpers.js';

// Stowaways (plan §24), the hidden-role game: four phones read their secret roles, the
// captain runs a writing test, the answers show on the big screen, a human hits the button
// and accuses the alien, everyone else votes Eject, and the humans win. (~60 s: the game's
// own timers, e.g. 10 s to read roles and 15 s to argue, run at full length.)
test.setTimeout(150_000);

const frame = (page) => page.frameLocator('iframe.game-frame');
const NAMES = ['Ana', 'Ben', 'Cal', 'Dot'];

/** Opens a room for Stowaways with four phones and starts the game. */
async function startGame(people) {
  const host = await people.host({ game: 'stowaways' });
  const phones = {};
  for (const name of NAMES) phones[name] = await people.player(host.code, name);
  await expect(host.page.getByRole('heading', { name: 'Next game: Stowaways' })).toBeVisible();
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(frame(host.page).getByText('Check your phone.')).toBeVisible();
  return { host, phones };
}

/** Taps each phone's covered role card and reads it: { Ana: 'human', ... }. */
async function readRoles(phones) {
  const roles = {};
  for (const [name, phone] of Object.entries(phones)) {
    const card = frame(phone.page).getByRole('button', { name: 'Your role (tap to show)' });
    await card.click();
    const open = frame(phone.page).getByRole('button', { name: 'Your role (tap to hide)' });
    await expect(open).toContainText(/You are (HUMAN|an ALIEN)/);
    roles[name] = (await open.textContent()).includes('ALIEN') ? 'alien' : 'human';
    await open.click(); // covered again, as a careful player would
  }
  return roles;
}

/** The phone whose screen says it's the captain (it may take a moment to get there). */
async function findCaptain(phones) {
  let captain = null;
  await expect
    .poll(async () => {
      for (const [name, phone] of Object.entries(phones)) {
        if (await frame(phone.page).getByText("You're the captain!").isVisible()) captain = name;
      }
      return captain;
    }, { timeout: 20_000 })
    .not.toBeNull();
  return captain;
}

test('roles, a writing test, the button, a unanimous vote: the humans eject the alien and win', async ({ people }) => {
  const { host, phones } = await startGame(people);
  const big = frame(host.page);

  // Exactly one alien among four, and the big screen never says who.
  const roles = await readRoles(phones);
  const aliens = NAMES.filter((n) => roles[n] === 'alien');
  expect(aliens).toHaveLength(1);
  const [alien] = aliens;
  await expect(big.getByText('1 alien aboard')).toBeVisible();

  // After 10 s of reading roles, a captain picks a writing test for two players.
  const captain = await findCaptain(phones);
  await expect(big.getByText(`Captain ${captain} is choosing a test.`)).toBeVisible();
  const cap = frame(phones[captain].page);
  const tested = NAMES.slice(0, 2);
  await cap.getByRole('button', { name: 'Write', exact: true }).click();
  for (const name of tested) await cap.getByRole('button', { name, exact: true }).click();
  await cap.getByRole('button', { name: 'Start test' }).click();

  // Each tested phone gets a prompt and types an answer; the big screen shows who's answering.
  await expect(big.getByText('Write test')).toBeVisible();
  for (const name of tested) {
    const box = frame(phones[name].page).getByLabel('Your answer');
    await box.fill(`${name}'s answer`);
    await box.press('Enter');
    // (The last answer ends the test at once, so only the first phone waits here.)
    if (name === tested[0]) await expect(frame(phones[name].page).getByText('Answer sent. Now act natural.')).toBeVisible();
  }

  // Both answered, so the reveal starts at once: the humans' prompt and both answers.
  await expect(big.getByText('The crew was asked:')).toBeVisible();
  for (const name of tested) await expect(big.getByText(`${name}'s answer`)).toBeVisible();

  // A human hits the button and accuses the alien.
  const accuser = NAMES.find((n) => roles[n] === 'human');
  const acc = frame(phones[accuser].page);
  await acc.getByRole('button', { name: 'THE BUTTON' }).click();
  await expect(big.getByText(`${accuser} hit the button!`)).toBeVisible();
  await acc.getByRole('button', { name: alien, exact: true }).click();
  await acc.getByRole('button', { name: 'Accuse' }).click();
  await expect(big.getByText(`${accuser} accuses ${alien}!`)).toBeVisible();
  await expect(frame(phones[alien].page).getByText("You're accused! Make your case, out loud.")).toBeVisible();

  // 15 s to argue, then everyone but the accused votes Eject. Unanimous: out they go.
  const voters = NAMES.filter((n) => n !== alien);
  for (const name of voters) {
    await frame(phones[name].page).getByRole('button', { name: 'Eject' }).click({ timeout: 25_000 });
  }
  await expect(big.getByText('Unanimous. Ejecting!')).toBeVisible();
  await expect(big.getByText('The humans win!')).toBeVisible({ timeout: 10_000 });
  await expect(frame(phones[alien].page).getByText('Your team lost.')).toBeVisible();
  await expect(frame(phones[accuser].page).getByText('Your team wins!')).toBeVisible();

  // The game ends: the three humans share the win in the lobby.
  await expect(host.page.getByText(/It's a tie: .+ & .+ & .+!/)).toBeVisible({ timeout: 20_000 });
});

test('the big screen reloads mid-game and Stowaways carries on: same captain, same secret roles', async ({ people }) => {
  const { host, phones } = await startGame(people);
  const roles = await readRoles(phones);
  const captain = await findCaptain(phones);

  await host.page.reload();
  await expect(frame(host.page).getByText(`Captain ${captain} is choosing a test.`)).toBeVisible();
  await expect(host.page.getByText(/stopped/)).toHaveCount(0);
  await expect(frame(phones[captain].page).getByText("You're the captain!")).toBeVisible();
  // Roles weren't dealt again.
  expect(await readRoles(phones)).toEqual(roles);
});

test("a drawing test, then an alien's hack: the hacked human gets the aliens' prompt", async ({ people }) => {
  const { host, phones } = await startGame(people);
  const big = frame(host.page);
  const roles = await readRoles(phones);
  const alien = NAMES.find((n) => roles[n] === 'alien');
  const humans = NAMES.filter((n) => roles[n] === 'human');

  // Test 1 (no hacks yet): two humans draw a line each.
  const first = await findCaptain(phones);
  const cap1 = frame(phones[first].page);
  await cap1.getByRole('button', { name: 'Draw', exact: true }).click();
  for (const name of humans.slice(0, 2)) await cap1.getByRole('button', { name, exact: true }).click();
  await cap1.getByRole('button', { name: 'Start test' }).click();
  for (const name of humans.slice(0, 2)) {
    const { page } = phones[name];
    const pad = await frame(page).getByRole('img', { name: 'Drawing pad' }).boundingBox();
    await page.mouse.move(pad.x + pad.width * 0.3, pad.y + pad.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(pad.x + pad.width * 0.7, pad.y + pad.height * 0.6, { steps: 6 });
    await page.mouse.up();
    await frame(page).getByRole('button', { name: "I'm done" }).click();
  }
  await expect(big.getByText('The crew was asked to draw:')).toBeVisible();
  await expect(big.getByRole('img', { name: `${humans[0]}'s drawing` })).toBeVisible();

  // The captain moves on (allowed 20 s into the discussion), and the next player is captain.
  await cap1.getByRole('button', { name: 'Next test' }).click({ timeout: 30_000 });
  await expect(cap1.getByText("You're the captain!")).toHaveCount(0);
  const captain = await findCaptain(phones);
  expect(captain).not.toBe(first);
  const cap = frame(phones[captain].page);

  // While the captain picks, the alien quietly hacks a human (the screen shows nothing).
  const target = humans.find((n) => n !== captain) ?? humans[0];
  const alienPhone = frame(phones[alien].page);
  await alienPhone.getByRole('button', { name: target, exact: true }).click();
  await expect(alienPhone.getByRole('button', { name: target, exact: true })).toHaveAttribute('aria-pressed', 'true');

  // The captain tests the hacked human and another human with an opinion.
  const other = humans.find((n) => n !== target);
  await cap.getByRole('button', { name: 'Opinion', exact: true }).click();
  for (const name of [target, other]) await cap.getByRole('button', { name, exact: true }).click();
  await cap.getByRole('button', { name: 'Start test' }).click();
  const promptOf = async (name) => {
    const prompt = frame(phones[name].page).locator('.prompt');
    await expect(prompt).toBeVisible();
    return (await prompt.textContent()).replace('How much do you agree?', '').replaceAll('"', '');
  };
  const hackedPrompt = await promptOf(target);
  const fairPrompt = await promptOf(other);
  expect(hackedPrompt).not.toEqual(fairPrompt);
  for (const name of [target, other]) await frame(phones[name].page).getByRole('button', { name: 'Slightly agree' }).click();

  // The big screen shows only the humans' statement: the fair one.
  await expect(big.getByText('The crew was asked how much they agree:')).toBeVisible();
  await expect(big.locator('.asked b')).toHaveText(`"${fairPrompt}"`);
});
