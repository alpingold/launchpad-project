// Games played: one row for every game that ended in a room, finished or stopped. Only plays
// of an official game or a published version: a maker's playtests aren't recorded. Keyed by the
// game's page id (an official game's id, or "g-..." for every version of a generated game), like
// game_pages. Nothing about who played or what anyone typed.

/**
 * Records one game that ended.
 * @param {import('../rooms/RoomManager.js').GamePlayed} play
 */
export function recordPlay(db, { gameId, version, stopped }, now = Date.now()) {
  db.prepare('INSERT INTO game_plays (game_id, version, stopped, ended_at) VALUES (?, ?, ?, ?)').run(gameId, version, stopped, now);
}

/**
 * How many times each game was played to the end (stopped games don't count), in one query.
 * Games never finished aren't in it.
 * @returns {Map<string, number>}
 */
export function finishedPlayCounts(db) {
  return new Map(
    db
      .prepare('SELECT game_id, COUNT(*) AS n FROM game_plays WHERE stopped IS NULL GROUP BY game_id')
      .all()
      .map((r) => [r.game_id, r.n]),
  );
}

/** Every record of a game, when the game itself is deleted. */
export function deletePlaysOf(db, gameId) {
  db.prepare('DELETE FROM game_plays WHERE game_id = ?').run(gameId);
}
