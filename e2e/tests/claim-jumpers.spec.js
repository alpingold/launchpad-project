import { test, expect } from './helpers.js';

// Claim Jumpers, the simultaneous-move board game: two phones pick squares at the same time,
// both go for the same square and clash, the big screen reloads mid-game and carries on, and
// the game plays out to the end. (~90 s: 15 turns with a 4 s reveal each.)
test.setTimeout(180_000);

const frame = (page) => page.frameLocator('iframe.game-frame');
const NAMES = ['Ana', 'Ben'];

/** The phone's board: its size, its camp, and the squares it may pick now. */
async function readBoard(page) {
  return frame(page)
    .locator('.board')
    .evaluate((board) => {
      const cells = [...board.querySelectorAll('.cell')];
      const size = Math.round(Math.sqrt(cells.length));
      return {
        size,
        camp: Number(board.querySelector('.cell.camp.mine')?.dataset.i ?? -1),
        legal: cells.filter((c) => c.classList.contains('legal')).map((c) => Number(c.dataset.i)),
      };
    });
}

const distance = (a, b, size) => Math.abs(Math.floor(a / size) - Math.floor(b / size)) + Math.abs((a % size) - (b % size));

/** Picks the legal square closest to `target` (the target itself when it can). */
async function pickToward(page, target) {
  const { size, legal } = await readBoard(page);
  expect(legal.length).toBeGreaterThan(0);
  const best = legal.reduce((a, b) => (distance(b, target, size) < distance(a, target, size) ? b : a));
  await frame(page).locator(`.cell[data-i="${best}"]`).click();
  return best;
}

test('everyone picks at once, a clash bounces, the big screen reloads, and the game ends with a winner', async ({ people }) => {
  const host = await people.host({ game: 'claim-jumpers' });
  const phones = [];
  for (const name of NAMES) phones.push(await people.player(host.code, name));
  await expect(host.page.getByRole('heading', { name: 'Next game: Claim Jumpers' })).toBeVisible();
  await host.page.getByRole('button', { name: 'Start game' }).click();
  const big = frame(host.page);

  // The intro explains the rules; every phone knows its camp.
  await expect(big.getByText('Two people pick the same square? Nobody gets it.')).toBeVisible();
  for (const phone of phones) await expect(frame(phone.page).getByText(/Your camp is the big/)).toBeVisible();

  // Turn 1: both phones see their glowing squares. Two players: a 6 × 6 board.
  await expect(big.getByText('Turn 1 of 15')).toBeVisible({ timeout: 15_000 });
  const boards = await Promise.all(phones.map((p) => readBoard(p.page)));
  expect(boards[0].size).toBe(6);
  expect(boards[0].camp).not.toBe(boards[1].camp);

  // Aim both at the same square, halfway between the camps (each camp is 3 steps from it).
  const { size } = boards[0];
  const [a, b] = boards.map((x) => x.camp);
  const target = Math.floor((Math.floor(a / size) + Math.floor(b / size)) / 2) * size + Math.ceil(((a % size) + (b % size)) / 2);
  expect(distance(a, target, size)).toBeLessThanOrEqual(3);

  // Turns 1–2: each claims a square toward it. The turn ends as soon as both have picked.
  for (const turn of [1, 2]) {
    await expect(big.getByText(`Turn ${turn} of 15`)).toBeVisible({ timeout: 15_000 });
    await expect(frame(phones[0].page).getByText(`Turn ${turn} of 15: pick a square`)).toBeVisible();
    await expect(frame(phones[1].page).getByText(`Turn ${turn} of 15: pick a square`)).toBeVisible();
    for (const phone of phones) await pickToward(phone.page, target);
    await expect(big.getByText('2 claims, 0 jumps, 0 clashes')).toBeVisible();
    for (const phone of phones) await expect(frame(phone.page).getByText(/You (claimed a square|struck gold)/)).toBeVisible();
  }

  // Turn 3: both can reach the target, both pick it: a clash, and nobody gets it.
  await expect(big.getByText('Turn 3 of 15')).toBeVisible({ timeout: 15_000 });
  await expect(frame(phones[0].page).getByText('Turn 3 of 15: pick a square')).toBeVisible();
  await expect(frame(phones[1].page).getByText('Turn 3 of 15: pick a square')).toBeVisible();
  for (const phone of phones) expect(await pickToward(phone.page, target)).toBe(target);
  await expect(big.getByText('0 claims, 0 jumps, 1 clash')).toBeVisible();
  await expect(frame(phones[0].page).getByText('Clash with Ben: nobody got it.')).toBeVisible();
  await expect(frame(phones[1].page).getByText('Clash with Ana: nobody got it.')).toBeVisible();
  await expect(big.locator(`.cell[data-i="${target}"]`)).not.toHaveClass(/owned/);

  // The big screen reloads: the board and the turn come back from its last party.save.
  await expect(big.getByText('Turn 4 of 15')).toBeVisible({ timeout: 15_000 });
  await host.page.reload();
  await expect(frame(host.page).getByText('Turn 4 of 15')).toBeVisible({ timeout: 15_000 });
  await expect(frame(host.page).locator('.cell.owned')).toHaveCount(6); // 2 camps + 4 claims

  // Play the rest: each phone grabs the square closest to the other's camp, every turn.
  for (let turn = 4; turn <= 15; turn++) {
    await expect(frame(host.page).getByText(`Turn ${turn} of 15`)).toBeVisible({ timeout: 15_000 });
    for (const [k, phone] of phones.entries()) {
      await expect(frame(phone.page).getByText(`Turn ${turn} of 15: pick a square`)).toBeVisible();
      await pickToward(phone.page, [b, a][k]);
    }
    await expect(frame(phones[0].page).getByText(`Turn ${turn} of 15: look up!`)).toBeVisible();
  }

  // The end: a winner (or a tie) on the big screen, the result on each phone, then the lobby.
  await expect(frame(host.page).getByText(/ (wins|tie)!$/)).toBeVisible({ timeout: 15_000 });
  for (const phone of phones) await expect(frame(phone.page).getByText(/^(You win!|You tied for 1st!|You came 2nd)$/)).toBeVisible();
  await expect(host.page.getByRole('heading', { name: 'Next game: Claim Jumpers' })).toBeVisible({ timeout: 20_000 });
});
