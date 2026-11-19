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
 * The command runs it on the database and on each copy the server made of it before a migration
 * (database.ts, KEPT_COPIES), which would otherwise keep the account. The nightly backups still hold
 * it until each is deleted, 30 days after it was made (README, "The database's backups").
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
