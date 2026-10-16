// The catalogue's own data about games (plan §16): what a game's creator changed about how it's
// shown (its "page"), and everyone's votes. Keyed by the game's id: an official game's id, or a
// generated game's id ("g-...", shared by all its versions).

/**
 * What the creator changed; null fields mean "what the game file says".
 * @typedef {{ name: string | null, description: string | null, about: string | null,
 *   tags: string[] | null, minutes: [number, number] | null, mainShot: 'host' | 'phone' | null,
 *   updatedAt: number }} GamePage
 */

/** @returns {GamePage | null} */
export function getGamePage(db, gameId) {
  const row = db.prepare('SELECT * FROM game_pages WHERE game_id = ?').get(gameId);
  return row ? pageFromRow(row) : null;
}

/** Every game's page, by game id. @returns {Map<string, GamePage>} */
export function allGamePages(db) {
  return new Map(db.prepare('SELECT * FROM game_pages').all().map((row) => [row.game_id, pageFromRow(row)]));
}

function pageFromRow(row) {
  return {
    name: row.name,
    description: row.description,
    about: row.about,
    tags: row.tags_json ? JSON.parse(row.tags_json) : null,
    minutes: row.minutes_json ? JSON.parse(row.minutes_json) : null,
    mainShot: row.main_shot,
    updatedAt: row.updated_at,
  };
}

/**
 * Saves a game's page (all fields at once; already checked). @param {Omit<GamePage, 'updatedAt'>} page
 */
export function saveGamePage(db, gameId, page, userId, now = Date.now()) {
  db.prepare(
    `INSERT INTO game_pages (game_id, name, description, about, tags_json, minutes_json, main_shot, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (game_id) DO UPDATE SET name = excluded.name, description = excluded.description, about = excluded.about,
       tags_json = excluded.tags_json, minutes_json = excluded.minutes_json, main_shot = excluded.main_shot,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(
    gameId,
    page.name,
    page.description,
    page.about,
    page.tags ? JSON.stringify(page.tags) : null,
    page.minutes ? JSON.stringify(page.minutes) : null,
    page.mainShot,
    userId,
    now,
  );
}

/** value: 1 (👍), -1 (👎) or 0 (take the vote back). */
export function setVote(db, gameId, userId, value, now = Date.now()) {
  if (value === 0) {
    db.prepare('DELETE FROM game_votes WHERE game_id = ? AND user_id = ?').run(gameId, userId);
    return;
  }
  db.prepare(
    `INSERT INTO game_votes (game_id, user_id, value, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (game_id, user_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`,
  ).run(gameId, userId, value, now);
}

/** Every game's votes. @returns {Map<string, { up: number, down: number }>} */
export function voteCounts(db) {
  const rows = db
    .prepare('SELECT game_id, SUM(value = 1) AS up, SUM(value = -1) AS down FROM game_votes GROUP BY game_id')
    .all();
  return new Map(rows.map((r) => [r.game_id, { up: r.up, down: r.down }]));
}

/** This account's votes, by game id. @returns {Map<string, 1 | -1>} */
export function votesBy(db, userId) {
  return new Map(db.prepare('SELECT game_id, value FROM game_votes WHERE user_id = ?').all(userId).map((r) => [r.game_id, r.value]));
}
