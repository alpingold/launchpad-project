// The server the browser tests run against: the real server (same code as
// server/src/index.js), with two test-only differences, so nothing test-related lives in
// the app itself:
//   0. A test-only frame game, Probe (probe.html): pings, state, players, and it tries every
//      way out of its sandboxed frame.
//   1. A FAKE generator instead of the OpenShell sandbox + GenAI Studio. The tests don't
//      need Docker, an API key or the network, and a game takes ~2 s instead of minutes.
//      It writes a renamed Probe ("Robot Majority"); a change request renames it to
//      "Robot Majority 2". It still sends progress steps, and checks the game file the
//      same way the real one will.
//   2. An admin account (accounts.js) in the throwaway in-memory database.
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

/** What the fake "AI" writes: the Probe game, renamed so the tests can tell it apart. */
const GOOD_SOURCE = PROBE_SOURCE.replace('"name": "Probe"', '"name": "Robot Majority"');
/** What it writes when the idea contains "broken": a page with no game info. */
const BROKEN_SOURCE = '<p>Oops, no game info.</p>\n';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Same inputs and result shape as the real runGeneratorInSandbox (server/src/generation/sandbox.js). */
async function fakeGenerator(job, { onStep }) {
  onStep('starting the sandbox');
  await pause(500);
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
  const report = frameGameReport(source);
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

const server = createGameServer({}, { db, games, runGenerator: fakeGenerator });
server.httpServer.listen(config.PORT, () => {
  console.log(`[e2e server] listening on http://localhost:${config.PORT}`);
});
