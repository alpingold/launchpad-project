// The server the browser tests run against: the real server (same code as
// server/src/index.js), with two test-only differences, so nothing test-related lives in
// the app itself:
//   1. A FAKE generator instead of the OpenShell sandbox + GenAI Studio. The tests don't
//      need Docker, an API key or the network, and a game takes ~2 s instead of ~30 s.
//      It still sends progress steps and runs the real harness on the code it returns.
//   2. An admin account (accounts.js) in the throwaway in-memory database.
import { readFileSync } from 'node:fs';
import { config } from '../../server/src/config.js';
import { createGameServer } from '../../server/src/server.js';
import { openDatabase } from '../../server/src/db/database.js';
import { createUser, setAdmin } from '../../server/src/db/users.js';
import { hashPassword } from '../../server/src/auth/passwords.js';
import { createDefaultRegistry } from '../../server/src/games/index.js';
import { checkGameSource } from '../../server/src/games/harness/check.js';
import { ADMIN } from './accounts.js';

/**
 * What the fake "AI" writes: the official Majority Rules game (it passes every check),
 * renamed so the tests can tell it apart from the real one.
 */
const GOOD_SOURCE = readFileSync(new URL('../../server/src/games/majority-rules/index.js', import.meta.url), 'utf8').replace(
  "name: 'Majority Rules'",
  "name: 'Robot Majority'",
);
/** What it writes when the idea contains "broken": a game with no createGame. */
const BROKEN_SOURCE = "export default { contractVersion: 2, id: 'oops', name: 'Oops' };\n";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Same inputs and result shape as the real runGeneratorInSandbox (server/src/generation/sandbox.js). */
async function fakeGenerator(job, { onStep }) {
  onStep('starting the sandbox');
  await pause(500);
  onStep(`attempt 1/4: asking ${job.model}`);
  await pause(1000);
  onStep('attempt 1/4: testing the game');
  const source = job.idea.includes('broken') ? BROKEN_SOURCE : GOOD_SOURCE;
  const report = await checkGameSource(source);
  if (!report.ok) {
    onStep(`attempt 1/4: ${report.problems.length} problem(s)`);
    return { ok: false, model: job.model, source, report, error: 'no passing game after 1 attempt' };
  }
  onStep('attempt 1/4: passed');
  return { ok: true, model: job.model, source, report };
}

const db = openDatabase(config.DB_PATH);
const admin = createUser(db, ADMIN.username, await hashPassword(ADMIN.password));
setAdmin(db, admin.username, true);

const server = createGameServer({}, { db, games: createDefaultRegistry(), runGenerator: fakeGenerator });
server.httpServer.listen(config.PORT, () => {
  console.log(`[e2e server] listening on http://localhost:${config.PORT}`);
});
