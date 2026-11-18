/**
 * The database: one SQLite file, through `node:sqlite`, which comes with Node (ADR 0007).
 *
 * Opening it applies the migrations: the numbered `.sql` files in server/migrations, in order,
 * each in one transaction, recorded in the `migrations` table. Before applying any to a database
 * that already has data, the file is copied beside itself, and the last three copies are kept. A
 * migration that fails leaves the database as it was, and opening it throws, so the server doesn't
 * start on half a database.
 *
 * The query modules (one per subject) are the only other files with SQL in them.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { all, one } from "./rows.js";

export type Database = DatabaseSync;

/** An in-memory database: for tests, and for development without DATABASE_FILE. */
export const IN_MEMORY = ":memory:";

/** How many copies from before a migration are kept beside the file. */
export const KEPT_COPIES = 3;

/**
 * server/migrations. The same path from src/db (tests, development through the source) and from
 * dist/db (the built server): both sit two folders below server/. deploy/package-release.sh packs
 * the folder into every release beside server/dist.
 */
export const MIGRATIONS = fileURLToPath(new URL("../../migrations/", import.meta.url));

/** A migration's file name: four digits, a dash, a name in lower case. */
const MIGRATION_NAME = /^\d{4}-[a-z0-9-]+\.sql$/;

export interface OpenOptions {
  /** The database file, or IN_MEMORY. */
  readonly file: string;
  /** The folder of migrations: MIGRATIONS unless a test wants its own. */
  readonly migrations?: string;
  /** The time, in milliseconds since 1970, for the record and the copies' names. Date.now unless a test passes its own. */
  readonly now?: () => number;
  /** Where to report what was done. console.log unless a test wants quiet. */
  readonly log?: (line: string) => void;
}

interface Migration {
  readonly name: string;
  readonly sql: string;
  readonly sha256: string;
}

/** Opens the database and brings it up to date. Throws, and leaves the file as it was, if a migration fails. */
export function openDatabase(options: OpenOptions): Database {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.log(line));
  const db = new DatabaseSync(options.file, { enableForeignKeyConstraints: true, timeout: 5_000 });
  try {
    // Write-ahead logging: a reader never waits for a writer, and a crash mid-write loses nothing
    // committed. An in-memory database has no log, and says "memory".
    if (options.file !== IN_MEMORY) db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db, options.file, readMigrations(options.migrations ?? MIGRATIONS), now, log);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Runs `work` in one transaction: all of its writes happen, or none do. `work` must not await:
 * node:sqlite is synchronous, and nothing else runs on the database until it returns.
 */
export function transaction<T>(db: Database, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function readMigrations(folder: string): Migration[] {
  const names = readdirSync(folder)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  return names.map((name) => {
    if (!MIGRATION_NAME.test(name)) throw new Error(`${join(folder, name)}: a migration's name is four digits, a dash and a name, such as 0003-uploads.sql`);
    // Line endings don't count: a checkout on Windows may turn every \n into \r\n.
    const sql = readFileSync(join(folder, name), "utf8").replaceAll("\r\n", "\n");
    return { name, sql, sha256: createHash("sha256").update(sql).digest("hex") };
  });
}

function migrate(db: Database, file: string, migrations: readonly Migration[], now: () => number, log: (line: string) => void): void {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    name TEXT NOT NULL PRIMARY KEY,
    sha256 TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  ) STRICT`);
  const applied = new Map(all(z.object({ name: z.string(), sha256: z.string() }), db.prepare("SELECT name, sha256 FROM migrations").all()).map((row) => [row.name, row.sha256]));

  // A file that has shipped is never edited: a changed one means the database and the code
  // disagree about what the tables are. Refuse rather than guess.
  for (const migration of migrations) {
    const recorded = applied.get(migration.name);
    if (recorded !== undefined && recorded !== migration.sha256) {
      throw new Error(`migration ${migration.name} was changed after it was applied; a shipped migration is never edited (add a new one)`);
    }
  }
  // A migration the database has and this release doesn't is fine: it is what rolling a release
  // back looks like, and a migration always leaves the database usable by the release before it
  // (ADR 0007).
  const pending = migrations.filter((migration) => !applied.has(migration.name));
  if (pending.length === 0) return;

  const first = pending[0];
  if (first !== undefined && file !== IN_MEMORY && hasData(db)) copyBeforeMigrating(db, file, first.name, now, log);

  for (const migration of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      // A migration may not leave a row pointing at nothing.
      if (db.prepare("PRAGMA foreign_key_check").all().length > 0) throw new Error("it leaves rows whose foreign keys point at nothing");
      db.prepare("INSERT INTO migrations (name, sha256, applied_at) VALUES (?, ?, ?)").run(migration.name, migration.sha256, Math.floor(now() / 1000));
      db.exec("COMMIT");
      log(`Database: applied ${migration.name}`);
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${migration.name} failed, and the database is as it was before it: ${(error as Error).message}`, { cause: error });
    }
  }
}

/** Whether any table besides the record of migrations exists. */
function hasData(db: Database): boolean {
  const row = one(z.object({ tables: z.number() }), db.prepare("SELECT count(*) AS tables FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'migrations'").get());
  return (row?.tables ?? 0) > 0;
}

/**
 * Copies the whole database beside its file, as `<file>.backup-<seconds>-before-<migration>`, and
 * keeps only the newest KEPT_COPIES. VACUUM INTO writes a complete, consistent copy even while the
 * write-ahead log holds changes not yet in the main file, which copying the file itself would not.
 */
function copyBeforeMigrating(db: Database, file: string, migration: string, now: () => number, log: (line: string) => void): void {
  const prefix = `${basename(file)}.backup-`;
  const copy = join(dirname(file), `${prefix}${Math.floor(now() / 1000)}-before-${migration.replace(/\.sql$/, "")}`);
  db.prepare("VACUUM INTO ?").run(copy);
  log(`Database: copied to ${copy} before migrating`);
  const copies = readdirSync(dirname(file))
    .filter((name) => name.startsWith(prefix))
    .sort((a, b) => Number(b.slice(prefix.length).split("-")[0]) - Number(a.slice(prefix.length).split("-")[0]));
  for (const old of copies.slice(KEPT_COPIES)) rmSync(join(dirname(file), old));
}
