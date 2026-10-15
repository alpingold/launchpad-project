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
  assert.deepEqual(
    report.problems.map((p) => [p.rule, p.screen]),
    [['blank', 'big screen']],
  );
});

test('a big screen stuck in a loop is caught, and the check still finishes', opts, async () => {
  const report = await check('hang', 12);
  assert.ok(rules(report.problems).includes('hang'), JSON.stringify(report.problems));
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
