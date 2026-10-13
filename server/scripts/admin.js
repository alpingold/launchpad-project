#!/usr/bin/env node
// Admin tasks, run on the server machine: `npm run admin -- <command>`.
//
// There's deliberately no web page for granting admin: whoever can run commands on the
// server already controls everything, so this adds no new way in.
//
// Changes to games take effect when the server (re)starts, because that's when it loads
// generated games from the database.

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { setAdmin, listUsers, findUserForLogin } from '../src/db/users.js';
import {
  STATUSES,
  createGeneratedGame,
  saveGeneratedSource,
  setGeneratedGameStatus,
  listGeneratedGames,
  deleteGeneratedGame,
} from '../src/db/generatedGames.js';
import { checkGameFile, formatReport } from '../src/games/harness/index.js';

const HELP = `Usage: npm run admin -- <command>

  users                                 list accounts (and who is an admin)
  grant <username>                      make an account an admin
  revoke <username>                     take admin away
  games                                 list AI-generated games
  import-game <file> --owner <username> [--status playtest|review]
                                        store a game file as a generated game (default: playtest).
                                        It must pass the test harness first.
  set-status <game id> <status>         ${STATUSES.join(' | ')}
  delete-game <game id>

Database: ${config.DB_PATH}`;

const [command, ...rest] = process.argv.slice(2);
const positional = rest.filter((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--'));
const flag = (name) => {
  const at = rest.indexOf(`--${name}`);
  return at === -1 ? undefined : rest[at + 1];
};

const db = openDatabase(config.DB_PATH);
const done = (message, ok = true) => {
  console.log(message);
  db.close();
  process.exit(ok ? 0 : 1);
};
const restartNote = '(restart the server to load the change)';

switch (command) {
  case 'users': {
    const users = listUsers(db);
    done(users.map((u) => `${u.id}\t${u.username}${u.isAdmin ? '\t(admin)' : ''}`).join('\n') || 'No accounts yet.');
    break;
  }
  case 'grant':
  case 'revoke': {
    const [username] = positional;
    if (!username) done(HELP, false);
    if (!setAdmin(db, username, command === 'grant')) done(`No account named "${username}".`, false);
    done(`${username} is ${command === 'grant' ? 'now an admin' : 'no longer an admin'}. They may need to reload the page.`);
    break;
  }
  case 'games': {
    const games = listGeneratedGames(db);
    const owners = new Map(listUsers(db).map((u) => [u.id, u.username]));
    done(
      games
        .map((g) => `${g.id}\t${g.status.padEnd(10)}\t${g.name ?? '(no name yet)'}\tby ${owners.get(g.ownerUserId)}\t"${g.prompt.slice(0, 60)}"`)
        .join('\n') || 'No generated games yet.',
    );
    break;
  }
  case 'import-game': {
    const [file] = positional;
    const owner = findUserForLogin(db, flag('owner') ?? '');
    const status = flag('status') ?? 'playtest';
    if (!file || !owner) done(`${HELP}\n\nimport-game needs a file and an existing --owner.`, false);
    if (!['playtest', 'review'].includes(status)) done('--status must be playtest or review.', false);

    const fullPath = path.resolve(process.env.INIT_CWD || process.cwd(), file);
    const report = await checkGameFile(fullPath);
    console.log(formatReport(report, file));
    if (!report.ok) done('Not imported: fix the problems above first.', false);

    const source = await readFile(fullPath, 'utf8');
    const game = createGeneratedGame(db, { ownerUserId: owner.id, prompt: `imported by hand from ${path.basename(file)}` });
    saveGeneratedSource(db, game.id, { source, report, ...report.game, status });
    done(`Imported as ${game.id} (${status}, owner ${owner.username}) ${restartNote}`);
    break;
  }
  case 'set-status': {
    const [id, status] = positional;
    if (!STATUSES.includes(status)) done(`Status must be one of: ${STATUSES.join(', ')}`, false);
    if (!setGeneratedGameStatus(db, id, status)) done(`No generated game ${id}.`, false);
    done(`${id} is now ${status} ${restartNote}`);
    break;
  }
  case 'delete-game': {
    const [id] = positional;
    if (!deleteGeneratedGame(db, id)) done(`No generated game ${id}.`, false);
    done(`Deleted ${id} ${restartNote}`);
    break;
  }
  default:
    done(HELP, command === undefined || command === 'help');
}
