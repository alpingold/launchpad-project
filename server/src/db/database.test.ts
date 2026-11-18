// The database: the real migration files, applied to a database in memory and to real files, as
// the server applies them at start.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { IN_MEMORY, KEPT_COPIES, MIGRATIONS, openDatabase, transaction, type Database } from "./database.js";

const TABLES = ["accounts", "games", "migrations", "sessions", "sign_in_links", "versions"];
/** Every migration in server/migrations, in order. A test's own extra ones are numbered 0099 and up, after them all. */
const ALL_MIGRATIONS = ["0001-accounts.sql", "0002-games.sql", "0003-takedowns.sql"];
const quiet = () => undefined;

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "db-"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** The tables a database has, and whether each is STRICT. */
function tables(db: Database): Record<string, boolean> {
  const rows = db.prepare("SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return Object.fromEntries(rows.map((row) => [String(row["name"]), row["strict"] === 1]));
}

function applied(db: Database): string[] {
  return db
    .prepare("SELECT name FROM migrations ORDER BY name")
    .all()
    .map((row) => String(row["name"]));
}

/** A folder holding the real migrations up to and including `last` (all of them unless given), and any `extra` files. */
function migrations(last?: string, extra: Record<string, string> = {}): string {
  const to = join(folder, `migrations-${Math.random().toString(36).slice(2)}`);
  cpSync(MIGRATIONS, to, { recursive: true, filter: (path) => last === undefined || !path.endsWith(".sql") || path.split("/").at(-1)! <= last });
  for (const [name, sql] of Object.entries(extra)) writeFileSync(join(to, name), sql);
  return to;
}

function copies(file: string): string[] {
  return readdirSync(folder)
    .filter((name) => name.startsWith(`${file.split("/").at(-1)!}.backup-`))
    .sort();
}

test("a new database gets every table, each STRICT, and records each migration", () => {
  const db = openDatabase({ file: IN_MEMORY, log: quiet });
  expect(tables(db)).toEqual(Object.fromEntries(TABLES.map((name) => [name, true])));
  expect(applied(db)).toEqual(ALL_MIGRATIONS);
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual(expect.objectContaining({ foreign_keys: 1 }));
  db.close();
});

test("a database file uses write-ahead logging, and opening it again changes nothing", () => {
  const file = join(folder, "site.db");
  const lines: string[] = [];
  openDatabase({ file, log: (line) => lines.push(line) }).close();
  expect(lines).toEqual(ALL_MIGRATIONS.map((name) => `Database: applied ${name}`));

  lines.length = 0;
  const again = openDatabase({ file, log: (line) => lines.push(line) });
  expect(lines).toEqual([]);
  expect(applied(again)).toEqual(ALL_MIGRATIONS);
  expect(again.prepare("PRAGMA journal_mode").get()).toEqual(expect.objectContaining({ journal_mode: "wal" }));
  again.close();
  expect(copies(file)).toEqual([]);
});

test("a database one migration behind gets only the missing one, and a copy of the file from before it", () => {
  const file = join(folder, "site.db");
  const old = openDatabase({ file, migrations: migrations("0001-accounts.sql"), log: quiet });
  old.prepare("INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)").run("a1", "ada@purdue.edu", 1);
  old.close();

  const lines: string[] = [];
  const db = openDatabase({ file, now: () => 1_800_000_000_000, log: (line) => lines.push(line) });
  expect(lines.filter((line) => line.startsWith("Database: applied"))).toEqual(["Database: applied 0002-games.sql", "Database: applied 0003-takedowns.sql"]);
  expect(Object.keys(tables(db))).toEqual(TABLES);
  expect(db.prepare("SELECT email FROM accounts").all()).toEqual([expect.objectContaining({ email: "ada@purdue.edu" })]);
  db.close();

  expect(copies(file)).toEqual(["site.db.backup-1800000000-before-0002-games"]);
  const copy = openDatabase({ file: join(folder, "site.db.backup-1800000000-before-0002-games"), migrations: migrations("0001-accounts.sql"), log: quiet });
  expect(Object.keys(tables(copy))).toEqual(["accounts", "migrations", "sessions", "sign_in_links"]);
  expect(copy.prepare("SELECT email FROM accounts").all()).toEqual([expect.objectContaining({ email: "ada@purdue.edu" })]);
  copy.close();
});

test(`only the last ${KEPT_COPIES} copies are kept`, () => {
  const file = join(folder, "site.db");
  openDatabase({ file, log: quiet }).close();
  const extra: Record<string, string> = {};
  for (let n = 3; n <= 7; n++) {
    extra[`009${n}-extra-${n}.sql`] = `CREATE TABLE extra_${n} (x INTEGER) STRICT;`;
    openDatabase({ file, migrations: migrations(undefined, extra), now: () => n * 1000, log: quiet }).close();
  }
  expect(copies(file)).toEqual(["site.db.backup-5-before-0095-extra-5", "site.db.backup-6-before-0096-extra-6", "site.db.backup-7-before-0097-extra-7"]);
});

test("a migration that fails leaves the database exactly as it was, and opening it throws", () => {
  const file = join(folder, "site.db");
  openDatabase({ file, log: quiet }).close();
  // It makes a table and changes a row, then fails part way.
  const broken = migrations(undefined, {
    "0099-broken.sql": "CREATE TABLE half_done (x INTEGER) STRICT;\nINSERT INTO accounts (id, email, created_at) VALUES ('b', 'b@purdue.edu', 2);\nTHIS IS NOT SQL;",
  });
  expect(() => openDatabase({ file, migrations: broken, log: quiet })).toThrow(/migration 0099-broken.sql failed, and the database is as it was before it/);

  const db = openDatabase({ file, log: quiet });
  expect(Object.keys(tables(db))).toEqual(TABLES);
  expect(applied(db)).toEqual(ALL_MIGRATIONS);
  expect(db.prepare("SELECT count(*) AS n FROM accounts").get()).toEqual(expect.objectContaining({ n: 0 }));
  db.close();
});

test("a migration that leaves a row pointing at nothing fails too", () => {
  const broken = migrations(undefined, { "0099-orphans.sql": "PRAGMA defer_foreign_keys = ON; INSERT INTO sessions VALUES ('h', 'nobody', 1, 1, 2);" });
  expect(() => openDatabase({ file: IN_MEMORY, migrations: broken, log: quiet })).toThrow(/0099-orphans.sql failed.*point at nothing/);
});

test("a migration changed after it was applied stops the database opening", () => {
  const file = join(folder, "site.db");
  openDatabase({ file, log: quiet }).close();
  const edited = migrations();
  writeFileSync(join(edited, "0002-games.sql"), "-- edited\n");
  expect(() => openDatabase({ file, migrations: edited, log: quiet })).toThrow(/0002-games.sql was changed after it was applied/);
});

test("a database with a migration this release doesn't know still opens, as after rolling a release back", () => {
  const file = join(folder, "site.db");
  openDatabase({ file, migrations: migrations(undefined, { "0099-newer.sql": "CREATE TABLE newer (x INTEGER) STRICT;" }), log: quiet }).close();
  const db = openDatabase({ file, log: quiet });
  expect(applied(db)).toEqual([...ALL_MIGRATIONS, "0099-newer.sql"]);
  db.close();
});

test("a migration's line endings don't count as a change", () => {
  const file = join(folder, "site.db");
  openDatabase({ file, log: quiet }).close();
  const crlf = migrations();
  writeFileSync(join(crlf, "0002-games.sql"), readFileSync(join(MIGRATIONS, "0002-games.sql"), "utf8").replaceAll("\n", "\r\n"));
  openDatabase({ file, migrations: crlf, log: quiet }).close();
});

test("a file in the migrations folder that isn't named like one is refused", () => {
  expect(() => openDatabase({ file: IN_MEMORY, migrations: migrations(undefined, { "3-oops.sql": "" }), log: quiet })).toThrow(/four digits, a dash and a name/);
});

test("the tables refuse what the data rules forbid", () => {
  const db = openDatabase({ file: IN_MEMORY, log: quiet });
  const account = db.prepare("INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)");
  account.run("a1", "ada@purdue.edu", 1);
  // STRICT: a time must be a whole number.
  expect(() => account.run("a2", "bo@purdue.edu", "yesterday")).toThrow();
  // One account per address, in lower case only.
  expect(() => account.run("a3", "ada@purdue.edu", 1)).toThrow(/UNIQUE/);
  expect(() => account.run("a4", "Cy@purdue.edu", 1)).toThrow(/CHECK/);
  // A session belongs to an account that exists.
  expect(() => db.prepare("INSERT INTO sessions VALUES ('h', 'nobody', 1, 1, 2)").run()).toThrow(/FOREIGN KEY/);

  db.prepare("INSERT INTO games (id, owner_id, created_at) VALUES ('g1', 'a1', 1), ('g2', 'a1', 1)").run();
  const version = db.prepare("INSERT INTO versions (id, game_id, number, made_by, source, state, sdk_version, created_at) VALUES (?, ?, ?, 'upload', 'code', 'checking', 'v1', 1)");
  version.run("v1", "g1", 1);
  version.run("v2", "g2", 1);
  // A ready Version has a bundle and an `about`; a failed one has its problems.
  expect(() => db.prepare("UPDATE versions SET state = 'ready', checked_at = 2 WHERE id = 'v1'").run()).toThrow(/CHECK/);
  db.prepare(`UPDATE versions SET state = 'ready', checked_at = 2, bundle = 'var x;', about = '{"title":"T"}' WHERE id = 'v1'`).run();
  // ...and once decided, never changes.
  expect(() => db.prepare(`UPDATE versions SET state = 'failed', problems = '[]' WHERE id = 'v1'`).run()).toThrow(/never changes state/);
  // A Game publishes only one of its own Versions.
  expect(() => db.prepare("UPDATE games SET published_version_id = 'v2' WHERE id = 'g1'").run()).toThrow(/FOREIGN KEY/);
  db.prepare("UPDATE games SET published_version_id = 'v1' WHERE id = 'g1'").run();
  db.close();
});

test("a transaction keeps all of its writes or none", () => {
  const db = openDatabase({ file: IN_MEMORY, log: quiet });
  const account = db.prepare("INSERT INTO accounts (id, email, created_at) VALUES (?, ?, 1)");
  expect(() =>
    transaction(db, () => {
      account.run("a1", "ada@purdue.edu");
      account.run("a2", "ada@purdue.edu");
    }),
  ).toThrow(/UNIQUE/);
  expect(db.prepare("SELECT count(*) AS n FROM accounts").get()).toEqual(expect.objectContaining({ n: 0 }));
  transaction(db, () => account.run("a1", "ada@purdue.edu"));
  expect(db.prepare("SELECT count(*) AS n FROM accounts").get()).toEqual(expect.objectContaining({ n: 1 }));
  db.close();
});
