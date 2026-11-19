// Removing an account by hand: everything of it goes, in an order the keys allow, and nothing of
// anyone else's. On a database in memory, made by the real migrations.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createAccount, createSession, createSignInLink, setDisplayName } from "./accounts.js";
import { IN_MEMORY, MIGRATIONS, openDatabase, type Database } from "./database.js";
import { createGame, createVersion, finishCheck, publish } from "./games.js";
import { addPlay } from "./plays.js";
import { emptyLog, removeAccount } from "./remove-account.js";

let db: Database;

/** An account with a published Game of two Versions (one played), an unpublished Game, two sessions and a used and an unused sign-in link. */
function someone(id: string, email: string): void {
  createAccount(db, { id, email, createdAt: 1 });
  setDisplayName(db, id, id, id);
  for (const game of [`${id}-published`, `${id}-private`]) {
    createGame(db, { id: game, ownerId: id, createdAt: 1 });
    for (const n of [1, 2]) {
      createVersion(db, { id: `${game}-v${n}`, gameId: game, source: `// ${game} ${n}`, createdAt: n });
      finishCheck(db, `${game}-v${n}`, { ok: true, bundle: "//", about: { title: game, players: { min: 1, max: 4 } } }, n);
    }
  }
  publish(db, `${id}-published`, `${id}-published-v2`);
  addPlay(db, { gameId: `${id}-published` });
  for (const n of [1, 2]) createSession(db, { tokenHash: `${id}-session-${n}`, accountId: id, createdAt: 1, expiresAt: 9e9 });
  for (const n of [1, 2]) createSignInLink(db, { tokenHash: `${id}-link-${n}`, email, createdAt: 1, expiresAt: 9e9 });
}

/** Every row in every table that names `id` or `email`, by table. */
function rowsOf(id: string, email: string): Record<string, number> {
  const count = (sql: string, ...values: string[]) => Number(db.prepare(sql).get(...values)?.["n"]);
  return {
    accounts: count("SELECT count(*) AS n FROM accounts WHERE id = ? OR email = ?", id, email),
    games: count("SELECT count(*) AS n FROM games WHERE owner_id = ?", id),
    versions: count("SELECT count(*) AS n FROM versions WHERE game_id LIKE ? || '-%'", id),
    plays: count("SELECT count(*) AS n FROM plays WHERE subject LIKE ? || '-%'", id),
    sessions: count("SELECT count(*) AS n FROM sessions WHERE account_id = ?", id),
    signInLinks: count("SELECT count(*) AS n FROM sign_in_links WHERE email = ?", email),
  };
}

beforeEach(() => {
  db = openDatabase({ file: IN_MEMORY, log: () => undefined });
  someone("ada", "ada@purdue.edu");
  someone("bo", "bo@purdue.edu");
});

test("removes the account, its Games, every Version's code, its counts of plays, its sessions and its sign-in links", () => {
  expect(removeAccount(db, "ada@purdue.edu")).toEqual({ games: 2, versions: 4, plays: 1, sessions: 2, signInLinks: 2, accounts: 1 });
  expect(rowsOf("ada", "ada@purdue.edu")).toEqual({ accounts: 0, games: 0, versions: 0, plays: 0, sessions: 0, signInLinks: 0 });
  // No row is left pointing at something gone.
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("leaves everyone else's alone", () => {
  const before = rowsOf("bo", "bo@purdue.edu");
  removeAccount(db, "ada@purdue.edu");
  expect(rowsOf("bo", "bo@purdue.edu")).toEqual(before);
  expect(before).toEqual({ accounts: 1, games: 2, versions: 4, plays: 1, sessions: 2, signInLinks: 2 });
});

test("finds the account however the address is typed", () => {
  expect(removeAccount(db, "  Ada@Purdue.EDU ")?.accounts).toBe(1);
});

test("an address with no account removes nothing", () => {
  expect(removeAccount(db, "nobody@purdue.edu")).toBeUndefined();
  expect(rowsOf("ada", "ada@purdue.edu").accounts).toBe(1);
});

test("works on an older copy of the database, made before the tables for Games and plays existed", () => {
  // As the copy made before 0002-games.sql was applied: accounts, sessions and sign-in links only.
  const old = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  old.exec(readFileSync(join(MIGRATIONS, "0001-accounts.sql"), "utf8"));
  createAccount(old, { id: "ada", email: "ada@purdue.edu", createdAt: 1 });
  createSession(old, { tokenHash: "s", accountId: "ada", createdAt: 1, expiresAt: 9e9 });
  createSignInLink(old, { tokenHash: "l", email: "ada@purdue.edu", createdAt: 1, expiresAt: 9e9 });
  expect(removeAccount(old, "ada@purdue.edu")).toEqual({ games: 0, versions: 0, plays: 0, sessions: 1, signInLinks: 1, accounts: 1 });
  expect(old.prepare("SELECT count(*) AS n FROM accounts").get()?.["n"]).toBe(0);
  old.close();
});

describe("what is removed is overwritten, not only marked as free", () => {
  /** Text only Ada's account holds, in her code and her address. */
  const SECRET = "ada-secret-code-7f3a9c";
  const EMAIL = "ada.secret.7f3a9c@purdue.edu";
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "remove-"));
  });
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  /** A database file in WAL mode, as the server's is, holding Ada (with SECRET in a Version's code) and Bo. */
  function fileWithAda(): { file: string; db: Database } {
    const file = join(folder, "site.db");
    const db = openDatabase({ file, log: () => undefined });
    createAccount(db, { id: "ada", email: EMAIL, createdAt: 1 });
    createGame(db, { id: "g", ownerId: "ada", createdAt: 1 });
    createVersion(db, { id: "v", gameId: "g", source: `// ${SECRET}\n${"x".repeat(20_000)}`, createdAt: 1 });
    createAccount(db, { id: "bo", email: "bo@purdue.edu", createdAt: 1 });
    // Into the file, as a long-running server's rows would be, and the log emptied.
    expect(emptyLog(db)).toBe(true);
    return { file, db };
  }

  /** Whether `text` is anywhere in the file or its write-ahead log, byte for byte. */
  function onDisk(file: string, text: string): boolean {
    return [file, `${file}-wal`, `${file}-journal`].some((each) => existsSync(each) && readFileSync(each).includes(Buffer.from(text)));
  }

  test("the control: a plain delete leaves the code and the address readable in the file", () => {
    const { file, db } = fileWithAda();
    db.exec("PRAGMA secure_delete = OFF");
    db.exec("DELETE FROM versions; DELETE FROM games; DELETE FROM accounts WHERE id = 'ada'");
    emptyLog(db);
    db.close();
    expect(onDisk(file, SECRET)).toBe(true);
    expect(onDisk(file, EMAIL)).toBe(true);
  });

  test("removing the account leaves neither in the file nor in its write-ahead log", () => {
    const { file, db } = fileWithAda();
    expect(removeAccount(db, EMAIL)?.accounts).toBe(1);
    expect(emptyLog(db)).toBe(true);
    db.close();
    expect(existsSync(`${file}-wal`) ? readFileSync(`${file}-wal`).length : 0).toBe(0);
    expect(onDisk(file, SECRET)).toBe(false);
    expect(onDisk(file, EMAIL)).toBe(false);
    expect(onDisk(file, "bo@purdue.edu")).toBe(true);
  });

  test("the same in a copy made before a migration, which isn't in WAL mode", () => {
    const { file, db } = fileWithAda();
    const copy = `${file}.backup-1800000000-before-0004-plays`;
    db.prepare("VACUUM INTO ?").run(copy);
    db.close();
    expect(onDisk(copy, SECRET)).toBe(true);
    const old = new DatabaseSync(copy, { enableForeignKeyConstraints: true });
    expect(removeAccount(old, EMAIL)?.accounts).toBe(1);
    expect(emptyLog(old)).toBe(true);
    old.close();
    expect(onDisk(copy, SECRET)).toBe(false);
    expect(onDisk(copy, EMAIL)).toBe(false);
  });
});
