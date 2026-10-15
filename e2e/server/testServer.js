// The server the browser tests run against: the real server (same code as
// server/src/index.js), with two test-only differences, so nothing test-related lives in
// the app itself:
//   0. Test-only frame games: Probe (probe.html: pings, state, players, and it tries every
//      way out of its sandboxed frame) and UI Demo (ui-demo.html: every party.ui helper),
//      plus the generator's starter templates (generator/templates/), each a tiny game.
//   1. A FAKE generator instead of the OpenShell sandbox + GenAI Studio. The tests don't
//      need Docker, an API key or the network, and a game takes ~2 s instead of minutes.
//      It writes a renamed Probe ("Robot Majority"); a change request renames it to
//      "Robot Majority 2". It still sends progress steps, and checks the game file the
//      same way the real one will.
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

const ROUNDS_TEMPLATE = readFileSync(new URL('../../generator/templates/rounds.html', import.meta.url), 'utf8');

/** What the fake "AI" writes: the party-rounds template, renamed so the tests can tell it apart. */
const GOOD_SOURCE = ROUNDS_TEMPLATE.replace('"name": "Unique Number"', '"name": "Robot Majority"');
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
    await pause(1000);
    return { ok: true, model: job.model, design: fakeDesign(job), attempts: [] };
  }
  onStep(`attempt 1/4: asking ${job.model}`);
  await pause(1000);
  onStep('attempt 1/4: testing the game');
  // A change request (K6) renames the game, so the tests can see which version is which.
  const broken = (job.change?.request ?? job.idea).includes('broken');
  const source = broken
    ? BROKEN_SOURCE
    : job.change
      ? job.change.source.replace(/"name": "[^"]*"/, '"name": "Robot Majority 2"')
      : GOOD_SOURCE;
  const changelog = job.change ? '- Renamed it to Robot Majority 2' : null;
  const report = withFakePlaytest(frameGameReport(source));
  if (!report.ok) {
    onStep(`attempt 1/4: ${report.problems.length} problem(s)`);
    return { ok: false, model: job.model, source, report, changelog, error: 'no passing game after 1 attempt' };
  }
  onStep('attempt 1/4: passed');
  return { ok: true, model: job.model, source, report, changelog };
}

const db = openDatabase(config.DB_PATH);
const admin = createUser(db, ADMIN.username, await hashPassword(ADMIN.password));
setAdmin(db, admin.username, true);

const games = createDefaultRegistry();
games.register(frameGameOrThrow(PROBE_SOURCE, 'probe'));
games.register(frameGameOrThrow(UI_DEMO_SOURCE, 'ui-demo'));
for (const name of ['rounds', 'realtime', 'turns']) {
  const source = readFileSync(new URL(`../../generator/templates/${name}.html`, import.meta.url), 'utf8');
  games.register(frameGameOrThrow(source, `template-${name}`));
}

// A short hang watchdog (normally 15 s), so the test of a hung big screen is quick.
const server = createGameServer({ GAME_WATCHDOG_MS: 5000 }, { db, games, runGenerator: fakeGenerator });
server.httpServer.listen(config.PORT, () => {
  console.log(`[e2e server] listening on http://localhost:${config.PORT}`);
});
