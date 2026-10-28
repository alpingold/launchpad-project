// Games played: one row for every game that ended in a room, finished or stopped. Keyed by the
// game's page id (an official game's id, or "g-..." for every version of a generated game), like
// game_pages. Nothing about who played or what anyone typed.

/**
 * Records one game that ended.
 * @param {import('../rooms/RoomManager.js').GamePlayed} play
 */
export function recordPlay(db, { gameId, version, stopped }, now = Date.now()) {
  db.prepare('INSERT INTO game_plays (game_id, version, stopped, ended_at) VALUES (?, ?, ?, ?)').run(gameId, version, stopped, now);
}

/** How many times a game was played to the end (stopped games don't count). */
export function countFinishedPlays(db, gameId) {
  return db.prepare('SELECT COUNT(*) AS n FROM game_plays WHERE game_id = ? AND stopped IS NULL').get(gameId).n;
}

/** Every record of a game, when the game itself is deleted. */
export function deletePlaysOf(db, gameId) {
  db.prepare('DELETE FROM game_plays WHERE game_id = ?').run(gameId);
}
