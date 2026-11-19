/**
 * Removes an account and everything of it from the site's database (db/remove-account.ts), and from
 * each copy of the database the server made before a migration, which sit beside it. Run on the
 * server, as the site's user, from the release's folder (README, "Removing an account by hand"):
 *
 *   sudo -u boilergames /usr/local/bin/node /opt/boilergames/current/server/dist/remove-account.js
 *
 * It asks for the email address on its standard input, not as an argument: sudo writes every command
 * line it runs to the server's log, and the address of someone who asked to be removed mustn't stay
 * there.
 *
 * The site can keep running: the database takes one writer at a time and waits up to 5 seconds for
 * its turn. Each file is opened without migrating it.
 */
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { DatabaseSync } from "node:sqlite";
import { removeAccount, type Removed } from "./db/remove-account.js";

const file = process.env["DATABASE_FILE"] ?? "/var/lib/boilergames/boilergames.db";
const asking = createInterface({ input: process.stdin, output: process.stdout });
const email = (await asking.question("The email address of the account to remove: ")).trim();
asking.close();
if (!email.includes("@")) {
  console.error("That isn't an email address. Nothing was removed.");
  process.exit(1);
}

/** The database and the copies made before its migrations (`<file>.backup-<seconds>-before-<name>`). */
const prefix = `${basename(file)}.backup-`;
const files = [file, ...readdirSync(dirname(file)).filter((name) => name.startsWith(prefix)).sort().map((name) => join(dirname(file), name))];

let found = false;
for (const each of files) {
  const db = new DatabaseSync(each, { enableForeignKeyConstraints: true, timeout: 5_000 });
  let removed: Removed | undefined;
  try {
    removed = removeAccount(db, email);
  } finally {
    db.close();
  }
  if (removed === undefined) {
    console.log(`${each}: no such account.`);
    continue;
  }
  found = true;
  console.log(
    `${each}: removed the account, ${removed.games} Game(s), ${removed.versions} Version(s), ${removed.plays} count(s) of plays, ${removed.sessions} session(s) and ${removed.signInLinks} sign-in link(s).`,
  );
}
if (!found) {
  console.error("There is no account with that email address. Nothing was removed.");
  process.exitCode = 1;
}
