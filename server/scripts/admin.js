#!/usr/bin/env node
// Admin tasks, run on the server machine: `npm run admin -- <command>`.
//
// There's deliberately no web page for granting admin: whoever can run commands on the
// server already controls everything, so this adds no new way in.
//
// Changes to games take effect when the server (re)starts, because that's when it loads
// generated games from the database.

import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { setAdmin, listUsers, findUserForLogin } from '../src/db/users.js';
import {
  createGeneratedGame,
  saveVersionSource,
  setLiveVersions,
  saveDraft,
  getGeneratedGame,
  listGeneratedGames,
  deleteGeneratedGame,
  gameStatus,
  mainVersion,
  listBuildAttempts,
  buildAttemptStats,
} from '../src/db/generatedGames.js';
import { frameGameReport, describeProblem } from '../src/games/frameGame.js';
import { datasetRecords, toJsonLines } from '../src/generation/dataset.js';

const HELP = `Usage: npm run admin -- <command>

  users                                 list accounts (and who is an admin)
  grant <username>                      make an account an admin
  revoke <username>                     take admin away
  games                                 list AI-generated games and their versions
  import-game <file> --owner <username> [--status playtest|review] [--idea "<text>"] [--design <file.md>]
                                        store a game file as a new generated game (its version 1;
                                        default: playtest). Its game info must be valid first.
                                        --idea and --design: what it was made from, shown on /admin
  set-live <game id> published|playtest <version|none>
                                        choose which version everyone gets (published), or only
                                        its owner (playtest); "none" takes it down
  delete-game <game id>                 the game and all its versions
  export-data <file.jsonl>              every version of every AI game as JSON Lines (plan §13n):
                                        idea, design drafts with feedback, code, checks, outcome
  edit-stats [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>]
                                        by model: how often the AI's edits failed to apply, and how
                                        often a call (a fix especially) got no reply. Days in UTC,
                                        both included; default: the last ${config.EDIT_STATS_DAYS} days

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
  case 'export-data': {
    const [file] = positional;
    if (!file) done(HELP, false);
    const records = datasetRecords(listGeneratedGames(db), { attemptsOf: (id) => listBuildAttempts(db, id) });
    const out = path.resolve(process.env.INIT_CWD || process.cwd(), file);
    await writeFile(out, toJsonLines(records));
    done(`Wrote ${records.length} version${records.length === 1 ? '' : 's'} to ${out}`);
    break;
  }
  case 'edit-stats': {
    const DAY = 24 * 60 * 60 * 1000;
    const day = (text) => (/^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(text)) ? Date.parse(text) : NaN);
    const until = flag('until') === undefined ? Math.floor(Date.now() / DAY) * DAY : day(flag('until'));
    const since = flag('since') === undefined ? until - (config.EDIT_STATS_DAYS - 1) * DAY : day(flag('since'));
    if (!Number.isFinite(since) || !Number.isFinite(until) || since > until) done('--since and --until are days (YYYY-MM-DD), the first not after the last.', false);
    const period = `from ${new Date(since).toISOString().slice(0, 10)} to ${new Date(until).toISOString().slice(0, 10)}`;
    const stats = buildAttemptStats(db, { since, until: until + DAY });
    if (stats.length === 0) done(`No build attempts recorded ${period}.`);
    done([`Build attempts ${period} (UTC), by model:`, ...stats.flatMap((s) => ['', ...editStatsLines(s)])].join('\n'));
    break;
  }
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
    const live = (g) => [g.publishedVersion && `published v${g.publishedVersion}`, g.playtestVersion && `playtest v${g.playtestVersion}`];
    done(
      games
        .map((g) => {
          const versions = g.versions.map((v) => `v${v.version} ${v.status}`).join(', ');
          const where = live(g).filter(Boolean).join(', ') || gameStatus(g);
          return `${g.id}\t${mainVersion(g)?.name ?? '(no name yet)'}\tby ${owners.get(g.ownerUserId)}\t${where}\t[${versions}]\t"${g.prompt.slice(0, 60)}"`;
        })
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
    const source = await readFile(fullPath, 'utf8');
    const report = frameGameReport(source);
    if (!report.ok) done(`Not imported: fix these first:\n - ${report.problems.map(describeProblem).join('\n - ')}`, false);

    const idea = flag('idea')?.trim() || `imported by hand from ${path.basename(file)}`;
    const designFile = flag('design');
    const design = designFile ? await readFile(path.resolve(process.env.INIT_CWD || process.cwd(), designFile), 'utf8') : null;

    const game = createGeneratedGame(db, { ownerUserId: owner.id, prompt: idea });
    if (design) saveDraft(db, game.id, 1, { text: design, by: 'ai' }); // the design it was built from
    saveVersionSource(db, game.id, 1, { source, report, ...report.game });
    if (status === 'playtest') setLiveVersions(db, game.id, { playtestVersion: 1 });
    done(`Imported as ${game.id} (${status}, owner ${owner.username}) ${restartNote}`);
    break;
  }
  case 'set-live': {
    const [id, as, which] = positional;
    const game = getGeneratedGame(db, id ?? '');
    if (!game) done(`No generated game ${id}.`, false);
    if (as !== 'published' && as !== 'playtest') done('Say published or playtest.', false);
    const number = which === 'none' ? null : Number(which);
    if (number !== null && game.versions.find((v) => v.version === number)?.status !== 'ready') {
      done(`${id} has no version ${which} that passed the tests.`, false);
    }
    if (as === 'published') {
      // Publishing the playtest version ends its playtest, like the admin page does.
      setLiveVersions(db, id, { publishedVersion: number, ...(number !== null && number === game.playtestVersion && { playtestVersion: null }) });
    } else {
      if (number !== null && number === game.publishedVersion) done(`v${number} is already published.`, false);
      setLiveVersions(db, id, { playtestVersion: number });
    }
    done(`${id}: ${as} version is now ${number === null ? 'none' : `v${number}`} ${restartNote}`);
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

/**
 * One model's edit stats, as lines.
 * @param {import('../src/db/generatedGames.js').BuildAttemptStats} s
 */
function editStatsLines(s) {
  const rate = (part, whole) => `(${Math.round((100 * part) / whole)}%)`;
  return [
    s.model ?? '(model not recorded)',
    `  calls      ${s.attempts} (${s.fixes} fixes)`,
    `  edits      ${s.edits === 0 ? 'none' : `${s.edits} replies, ${s.editsFailed} didn't apply ${rate(s.editsFailed, s.edits)}`}`,
    `  no reply   ${s.noReply} of ${s.attempts} calls ${rate(s.noReply, s.attempts)}; fixes: ${s.fixes === 0 ? 'none' : `${s.fixesNoReply} of ${s.fixes} ${rate(s.fixesNoReply, s.fixes)}`}`,
  ];
}
