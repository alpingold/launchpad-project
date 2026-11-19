/**
 * Removing an account by hand (BUILD-PLAN Step 23), until account deletion exists (milestone 4):
 * everything the database keeps about the account, in the order the tables' keys allow, in one
 * transaction, so it is all gone or none of it is. The README's "Removing an account by hand" runs
 * it, through server/src/remove-account.ts.
 *
 * The order:
 * 1. Its Games are unpublished: a Game points at its published Version, and that Version at its
 *    Game, so one of the two links has to go first.
 * 2. Its Games' Versions, with their code.
 * 3. Its Games' counts of plays (only numbers, but they name the Game).
 * 4. Its Games.
 * 5. Its sessions (which would go with the account anyway: their key says ON DELETE CASCADE).
 * 6. Sign-in links sent to its email address.
 * 7. The account.
 *
 * Removed means overwritten. By default SQLite only marks a deleted row's space as free, so the code
 * and the address would stay readable in the file until something else happened to be written
 * there. So `secure_delete` is turned on first, which makes SQLite overwrite what it deletes with
 * zeros, and afterwards `emptyLog` empties the write-ahead log, where the database's newest pages
 * (the deleted rows' old contents among them) wait before they are written into the file.
 *
 * The command runs both on the database and on each copy the server made of it before a migration
 * (database.ts, KEPT_COPIES), which would otherwise keep the account. The nightly backups still hold
 * it until each is deleted, within 60 days (README, "The database's backups").
 */
import { z } from "zod";
import { transaction, type Database } from "./database.js";
import { one } from "./rows.js";

/** How many rows went from each table. */
export interface Removed {
  readonly games: number;
  readonly versions: number;
  readonly plays: number;
  readonly sessions: number;
  readonly signInLinks: number;
  readonly accounts: number;
}

/**
 * Removes the account with this email address, and everything of it. Undefined if there is no such
 * account. Works on an older copy of the database too (the copies made before each migration), whose
 * tables may not all exist yet: a table it doesn't have holds nothing to remove.
 */
export function removeAccount(db: Database, email: string): Removed | undefined {
  const address = email.trim().toLowerCase();
  // For this connection: what is deleted is overwritten with zeros, not only marked as free.
  db.exec("PRAGMA secure_delete = ON");
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row["name"])));
  const run = (table: string, sql: string, ...values: string[]) => (tables.has(table) ? Number(db.prepare(sql).run(...values).changes) : 0);
  return transaction(db, () => {
    const account = one(z.object({ id: z.string() }), db.prepare("SELECT id FROM accounts WHERE email = ?").get(address));
    if (account === undefined) return undefined;
    const theirGames = "SELECT id FROM games WHERE owner_id = ?";
    run("games", "UPDATE games SET published_version_id = NULL WHERE owner_id = ?", account.id);
    const versions = run("versions", `DELETE FROM versions WHERE game_id IN (${theirGames})`, account.id);
    const plays = run("plays", `DELETE FROM plays WHERE subject IN (${theirGames})`, account.id);
    const games = run("games", "DELETE FROM games WHERE owner_id = ?", account.id);
    const sessions = run("sessions", "DELETE FROM sessions WHERE account_id = ?", account.id);
    const signInLinks = run("sign_in_links", "DELETE FROM sign_in_links WHERE email = ?", address);
    const accounts = run("accounts", "DELETE FROM accounts WHERE id = ?", account.id);
    return { games, versions, plays, sessions, signInLinks, accounts };
  });
}

/**
 * Writes everything in the write-ahead log into the file and empties the log (a truncating
 * checkpoint), so no older copy of a page is left in it. True if it did; false if the database was
 * too busy to let it finish within the connection's timeout. A file not in WAL mode (the copies made
 * before a migration) has no such log, and is done at once.
 */
export function emptyLog(db: Database): boolean {
  const result = one(z.object({ busy: z.number().int() }), db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get());
  return result?.busy === 0;
}
