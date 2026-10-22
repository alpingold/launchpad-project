// The server the browser tests run against: the real server (same code as
// server/src/index.js), with two test-only differences, so nothing test-related lives in
// the app itself:
//   0. Test-only frame games: Probe (probe.html: pings, state, players, and it tries every
//      way out of its sandboxed frame) and UI Demo (ui-demo.html: every party.ui helper),
//      plus Unique Number (a small rounds game) and two catalogue entries made from Probe.
//   1. A FAKE generator instead of the OpenShell sandbox + GenAI Studio. The tests don't
//      need Docker, an API key or the network, and a game takes ~2 s instead of minutes.
//      It writes a renamed Probe ("Robot Majority"); a change request renames it to
//      "Robot Majority 2"; a remix made its own (plan §45b) keeps the copy, marked. An idea with "rude" in it names it "Robot Bullshit" (for the word
//      filter, plan §49). It still sends progress steps, and checks the game file the same
//      way the real one will. An uploaded file's check (plan §57) uses the real static check;
//      a file containing "stuck" fails the "playtest".
//   2. An admin account (accounts.js) in the throwaway in-memory database.
//   3. A 5 s hang watchdog instead of 15 s.
import { readFileSync } from 'node:fs';
import { config } from '../../server/src/config.js';
import { createGameServer } from '../../server/src/server.js';
import { openDatabase } from '../../server/src/db/database.js';
import { createUser, setAdmin } from '../../server/src/db/users.js';
import { hashPassword } from '../../server/src/auth/passwords.js';
import { createDefaultRegistry } from '../../server/src/games/index.js';
import { frameGameOrThrow, frameGameReport } from '../../server/src/games/frameGame.js';
import { ADMIN } from './accounts.js';

const PROBE_SOURCE = readFileSync(new URL('./probe.html', import.meta.url), 'utf8');
const UI_DEMO_SOURCE = readFileSync(new URL('./ui-demo.html', import.meta.url), 'utf8');

const UNIQUE_NUMBER = readFileSync(new URL('./unique-number.html', import.meta.url), 'utf8');

/** What the fake "AI" writes: the party-rounds template, renamed so the tests can tell it apart. */
const GOOD_SOURCE = UNIQUE_NUMBER.replace('"name": "Unique Number"', '"name": "Robot Majority"');
/** What it writes when the idea contains "broken": a game whose line 5 reaches for the network. */
const BROKEN_SOURCE = [
  '<script type="application/json" id="game-info">',
  '  { "name": "Oops", "description": "Broken on purpose.", "minPlayers": 1, "maxPlayers": 4 }',
  '</script>',
  '<script>',
  "  party.ready(() => fetch('https://example.com/scores'));",
  '</script>',
  '',
].join('\n');

/** A stand-in screenshot: a plain picture, as a data: URL like the real ones. */
const shot = (w, h, label) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#dde"/><text x="20" y="40" font-size="24">${label}</text></svg>`)}`;

/** What the real checker adds after its browser playtest (generator/src/check/checkGame.js). */
function withFakePlaytest(report) {
  return {
    ...report,
    checked: 'the game info, the static check, and 20 s of play in a headless browser with 3 simulated phones',
    warnings: [...report.warnings, { rule: 'save', screen: 'big screen', message: 'The game never called party.save, so a big-screen reload starts it over.' }],
    playtest: {
      players: 3, seconds: 20, eventsFromPhones: 12, updatesToPhones: 30, saves: 0, ended: true, endedAfterSeconds: 14,
      screenshots: { host: shot(640, 360, 'big screen'), phone: shot(195, 390, 'phone') },
    },
  };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A design the fake "AI" writes, in the real format's shape (shortened). */
function fakeDesign(job) {
  if (job.change) {
    return `# Change: ${job.change.request}\n\n## What changes\n- ${job.redraft ? `Revised: ${job.redraft.feedback}` : 'The name'}\n\n## What stays the same\n- The rules\n\n## Risks\nNone\n`;
  }
  const rounds = job.redraft ? `Revised: ${job.redraft.feedback}` : '3 rounds of 20 s.';
  return `# Robot Majority\n\n## Genre and feel\nA quick party vote.\n\n## Rules\n1. Everyone picks a number.\n2. ${rounds}\n\n## Template\n\`rounds\`: everyone answers at once.\n`;
}

/** Same inputs and result shape as the real runGeneratorInSandbox (server/src/generation/sandbox.js). */
async function fakeGenerator(job, { onStep }) {
  onStep('starting the sandbox');
  await pause(500);
  if (job.step === 'design') {
    onStep(`${job.change ? 'plan' : 'design'}: asking ${job.model}`);
    await pause(2500); // long enough for the page to show this step while it runs
    return { ok: true, model: job.model, design: fakeDesign(job), attempts: [] };
  }
  if (job.step === 'check') {
    onStep('testing the game');
    await pause(1500);
    const checked = frameGameReport(job.source);
    const report = checked.ok && job.source.includes('stuck') ? { ...checked, ok: false, problems: [{ line: 1, message: 'The game got stuck: nothing happened for 60 seconds.' }] } : withFakePlaytest(checked);
    const attempts = [{ attempt: 1, mode: 'whole', ok: report.ok, problems: report.problems.length, source: job.source, report }];
    return report.ok ? { ok: true, model: null, source: job.source, report, attempts } : { ok: false, model: null, source: job.source, report, attempts, error: "it didn't pass the checks" };
  }
  onStep(`attempt 1/4: asking ${job.model}`);
  await pause(1000);
  onStep('attempt 1/4: testing the game');
  // A change request (K6) renames the game, so the tests can see which version is which.
  const broken = (job.change?.request ?? job.idea).includes('broken');
  let source = broken
    ? BROKEN_SOURCE
    : job.change
      ? job.change.source.replace(/"name": "[^"]*"/, '"name": "Robot Majority 2"')
      : job.remix
        ? `${job.remix.source}\n<!-- made its own (plan §45b) -->\n`
        : GOOD_SOURCE;
  const changelog = job.change ? '- Renamed it to Robot Majority 2' : null;
  if (!job.change && job.idea.includes('rude')) source = source.replace('"name": "Robot Majority"', '"name": "Robot Bullshit"');
  const report = withFakePlaytest(frameGameReport(source));
  const attempt = (n, code, checks) => ({ attempt: n, ok: checks.ok, problems: checks.problems.length, seconds: 30, usage: { prompt_tokens: 12000, completion_tokens: 9000 }, source: code, report: checks });
  if (!report.ok) {
    onStep(`attempt 1/4: ${report.problems.length} problem(s)`);
    return { ok: false, model: job.model, source, report, changelog, error: 'no passing game after 1 attempt', attempts: [attempt(1, source, report)] };
  }
  // A good game "needed" two attempts: the first reached for the network (plan §13n keeps both).
  const firstTry = source.replace("party.ready(", "fetch('https://example.com/x'); party.ready(");
  onStep('attempt 1/4: 1 problem(s)');
  onStep('attempt 2/4: passed');
  return { ok: true, model: job.model, source, report, changelog, attempts: [attempt(1, firstTry, frameGameReport(firstTry)), attempt(2, source, report)] };
}

const db = openDatabase(config.DB_PATH);
const admin = createUser(db, ADMIN.username, await hashPassword(ADMIN.password));
setAdmin(db, admin.username, true);

const games = createDefaultRegistry();
games.register(frameGameOrThrow(PROBE_SOURCE, 'probe'));
games.register(frameGameOrThrow(UI_DEMO_SOURCE, 'ui-demo'));
games.register(frameGameOrThrow(UNIQUE_NUMBER, 'unique-number'));
// For the catalogue's tests (tags, player counts, search): Probe under other names.
const asCatalogueEntry = (info) => PROBE_SOURCE.replace(/(id="game-info">)[\s\S]*?(<\/script>)/, `$1${JSON.stringify(info)}$2`);
games.register(frameGameOrThrow(asCatalogueEntry({ name: 'Treasure Hunt', description: 'Test-only: a catalogue entry.', minPlayers: 1, maxPlayers: 6, tags: ['board'], minutes: [3, 8] }), 'treasure-hunt'));
games.register(frameGameOrThrow(asCatalogueEntry({ name: 'Star Catch', description: 'Test-only: a catalogue entry.', minPlayers: 1, maxPlayers: 12, tags: ['action'], minutes: [1, 3] }), 'star-catch'));

// A short hang watchdog (normally 15 s), so the test of a hung big screen is quick.
// Users' own GenAI Studio keys (plan §15): a fake check instead of asking GenAI Studio.
// Keys starting "sk-good" work; any other key is rejected.
const checkKey = async (key) => (key.startsWith('sk-good') ? 'ok' : 'rejected');

const server = createGameServer({ GAME_WATCHDOG_MS: 5000 }, { db, games, runGenerator: fakeGenerator, checkKey });
server.httpServer.listen(config.PORT, () => {
  console.log(`[e2e server] listening on http://localhost:${config.PORT}`);
});
