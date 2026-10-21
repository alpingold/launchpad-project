import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkGame } from '../src/check/checkGame.js';

// The browser playtest on games with one mistake each, hidden from the static check (built
// from pieces of strings), so only the browser can find it. Uses the Chromium that
// Playwright installed for the browser tests (`npx playwright install chromium` in e2e/).

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8');
const check = (name, seconds = 6) => checkGame(fixture(name), { seconds, players: 2 });
const rules = (findings) => findings.map((f) => f.rule);

// Each check starts its own browser, so they can all run at once.
const opts = { concurrency: true, timeout: 60_000 };

test('a working game passes, ends, and has screenshots', opts, async () => {
  const report = await check('ok', 15);
  assert.deepEqual(report.problems, []);
  assert.equal(report.ok, true);
  assert.equal(report.playtest.ended, true);
  assert.equal(report.playtest.results.rankings.length, 1);
  assert.match(report.playtest.screenshots.host, /^data:image\/jpeg;base64,/);
  assert.match(report.playtest.screenshots.phone, /^data:image\/jpeg;base64,/);
  assert.match(report.checked, /headless browser with 2 simulated phones/);
});

test('reaching the network: the CSP report names what it tried', opts, async () => {
  const report = await check('network');
  assert.equal(report.ok, false);
  const csp = report.problems.find((p) => p.rule === 'csp');
  assert.ok(csp, JSON.stringify(report.problems));
  assert.match(csp.message, /network connection to https:\/\/example\.com/);
});

test('leaving the frame is caught', opts, async () => {
  const report = await check('navigation');
  assert.ok(rules(report.problems).includes('navigation'), JSON.stringify(report.problems));
});

test('an error in the game points at its line', opts, async () => {
  const report = await check('throws');
  const error = report.problems.find((p) => p.rule === 'error');
  assert.ok(error, JSON.stringify(report.problems));
  assert.match(error.message, /total/);
  assert.equal(error.code, 'player.score.total += 1; // there is no score: this throws on every tap');
  assert.equal(fixture('throws').split('\n')[error.line - 1].trim(), error.code);
});

test('a blank big screen is caught', opts, async () => {
  const report = await check('blank');
  // It never moves on either, so it's stuck too (plan §41).
  assert.deepEqual(
    report.problems.map((p) => [p.rule, p.screen]),
    [
      ['blank', 'big screen'],
      ['stuck', 'big screen'],
    ],
  );
});

test('a big screen stuck in a loop is caught, and the check still finishes', opts, async () => {
  const report = await check('hang', 12);
  assert.ok(rules(report.problems).includes('hang'), JSON.stringify(report.problems));
});

test('a game that never leaves its first screen is "stuck" once every timer has run out (plan §41)', opts, async () => {
  const stuck = await check('stuck');
  assert.deepEqual(rules(stuck.problems), ['stuck'], JSON.stringify(stuck.problems));
  assert.match(stuck.problems[0].message, /Nothing changed after every timer ran out \(the clock was moved 2 minutes ahead/);

  // Its timer working, it moves on when the clock jumps: also when it waits with a setTimeout
  // (every timer due by then runs), and with one round longer than 2 minutes: the jump goes
  // past the game's own length (its game-info minutes).
  for (const name of ['timed', 'scheduled', 'long-round']) {
    const fine = await check(name);
    assert.deepEqual(fine.problems, [], `${name}: ${JSON.stringify(fine.problems)}`);
  }
});

test('a stuck game that threw when its time was up gets the error too: usually the reason (plan §47)', opts, async () => {
  const report = await check('stuck-throws');
  assert.deepEqual(rules(report.problems).sort(), ['error', 'stuck'], JSON.stringify(report.problems));
  assert.match(report.problems.find((p) => p.rule === 'error').message, /firstRound/);
});

test('a big screen that draws once while the phones go on is "frozen" (plan §47); one that just shows the same thing a long while is not', opts, async () => {
  const frozen = await check('frozen');
  assert.deepEqual(rules(frozen.problems), ['frozen'], JSON.stringify(frozen.problems));
  assert.match(frozen.problems[0].message, /never changed while the game went on/);
  // The stuck game doesn't change either, but neither do its phones: that's "stuck", not "frozen".
  assert.ok(!rules((await check('stuck')).problems).includes('frozen'));
});

test('a player\'s name put into the page as HTML is caught, with its line; an escaped one is fine (plan §46)', opts, async () => {
  const report = await check('name-html');
  const html = report.problems.find((p) => p.rule === 'html');
  assert.ok(html, JSON.stringify(report.problems));
  assert.match(html.message, /went into the page as HTML \(`innerHTML`\)/);
  assert.match(html.code, /app\.innerHTML/);
  const escaped = await check('name-escaped');
  assert.deepEqual(rules(escaped.problems).filter((r) => r === 'html'), [], JSON.stringify(escaped.problems));
});

test('a broken value shown as text (NaN, undefined, [object Object]) is caught, on the page or a canvas, with its line (plan §51)', opts, async () => {
  const nan = (await check('nan-score')).problems.find((p) => p.rule === 'text');
  assert.ok(nan, 'NaN on the page');
  assert.match(nan.message, /The screen shows "NaN" \(`textContent`: "Score: NaN"\): a number that went wrong/);
  assert.match(nan.code, /app\.textContent = 'Score: ' \+ score/);
  const undef = (await check('undefined-canvas')).problems.find((p) => p.rule === 'text');
  assert.ok(undef, 'undefined on a canvas');
  assert.match(undef.message, /"undefined" \(`fillText`: "Winner: undefined"\): a value that was never set/);
  const fine = await check('text-ok');
  assert.deepEqual(rules(fine.problems).filter((r) => r === 'text'), [], JSON.stringify(fine.problems));
});

test('results naming someone who isn\'t playing are refused', opts, async () => {
  const report = await check('bad-end');
  assert.ok(rules(report.problems).includes('results'), JSON.stringify(report.problems));
  assert.equal(report.playtest.ended, false);
});

test('outside fonts fail the static check and the browser', opts, async () => {
  const report = await check('outside-files');
  assert.ok(rules(report.problems).includes('outside'), JSON.stringify(report.problems));
  assert.ok(rules(report.problems).includes('csp'), JSON.stringify(report.problems));
});

test('a file without game info is not played', opts, async () => {
  const report = await checkGame('<p>hello</p>');
  assert.equal(report.ok, false);
  assert.equal(report.playtest, undefined);
});
