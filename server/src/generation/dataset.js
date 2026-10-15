// The game library as data (plan §13n): every version of every AI-generated game, as one
// record per line (JSON Lines), the shape a retrieval index or a fine-tuning run would read.
//
// What a record holds, and what it could teach a model:
//   idea / request          what was asked
//   drafts                  each design draft, who wrote it (the AI or the admin's edit) and the
//                           feedback that led to it: "this draft, changed like this, was better"
//   design                  the design (or change plan) the code was built from
//   source, checks          the code, and whether it passed the checks (and which rules failed)
//   outcome                 how far the admin took it: failed, built, playtested, published
//   attempts                every build attempt: its code and which check rules it failed,
//                           so "this broke like this, and was fixed like this" can be learned
//
// Left out on purpose: who owns the game (no account ids or names), and the playtest's
// screenshots (large, and not text). Not recorded yet, so not here: how the game did with
// real players.

/** @typedef {import('../db/generatedGames.js').GeneratedGame} GeneratedGame */

/**
 * @param {GeneratedGame[]} games
 * @param {{ attemptsOf?: (gameId: string) => Map<number, import('../db/generatedGames.js').BuildAttempt[]> }} [opts]
 * @returns {object[]} one record per version, oldest game and version first
 */
export function datasetRecords(games, { attemptsOf = () => new Map() } = {}) {
  const records = [];
  for (const game of [...games].sort((a, b) => a.createdAt - b.createdAt)) {
    const attempts = attemptsOf(game.id);
    for (const v of game.versions) {
      records.push({
        gameId: game.id,
        version: v.version,
        kind: v.basedOn === null ? 'new' : v.drafts.length > 0 ? 'change' : 'small-fix',
        idea: game.prompt,
        request: v.basedOn === null ? null : v.request,
        basedOn: v.basedOn,
        model: v.model,
        drafts: v.drafts.map((d) => ({ by: d.by, feedback: d.feedback ?? null, text: d.text })),
        design: v.design,
        status: v.status,
        name: v.name,
        source: v.source,
        changelog: v.changelog,
        checks: v.report && {
          ok: v.report.ok === true,
          problems: ruleCounts(v.report.problems),
          warnings: ruleCounts(v.report.warnings),
        },
        outcome: outcome(game, v),
        attempts: (attempts.get(v.version) ?? []).map((a) => ({
          build: a.build,
          attempt: a.attempt,
          ok: a.ok,
          problems: ruleCounts(a.report?.problems),
          source: a.source,
          seconds: a.seconds,
          tokens: { prompt: a.promptTokens, completion: a.completionTokens },
        })),
        createdAt: v.createdAt,
      });
    }
  }
  return records;
}

/** How far the admin took this version (live right now beats "built"). */
function outcome(game, v) {
  if (v.version === game.publishedVersion) return 'published';
  if (v.version === game.playtestVersion) return 'playtest';
  if (v.status === 'ready') return game.versions.some((later) => later.basedOn === v.version) ? 'built-then-changed' : 'built';
  return v.status; // failed, or still being designed or built
}

/** { rule: count } for a list of findings (sentences count as "info"). */
function ruleCounts(findings = []) {
  const counts = {};
  for (const f of findings) {
    const rule = typeof f === 'string' ? 'info' : (f.rule ?? 'other');
    counts[rule] = (counts[rule] ?? 0) + (typeof f === 'object' && f.count > 1 ? f.count : 1);
  }
  return counts;
}

/** Records as JSON Lines. */
export function toJsonLines(records) {
  return records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
}
