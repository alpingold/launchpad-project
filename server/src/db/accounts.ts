/**
 * The queries about accounts, the links that sign them in, and their sessions. With database.ts,
 * the only file with SQL about them. Every value goes in as a parameter; every row read is parsed.
 *
 * Times here are whole seconds since 1970, as the tables keep them. Tokens never reach this file:
 * only their hashes do.
 */
import { z } from "zod";
import type { Database } from "./database.js";
import { one } from "./rows.js";

export interface Account {
  readonly id: string;
  /** Never shown to anyone but the account itself. */
  readonly email: string;
  /** What other people see. Null until the account picks one. */
  readonly displayName: string | null;
  readonly admin: boolean;
  readonly createdAt: number;
}

const accountRow = z
  .object({ id: z.string(), email: z.string(), display_name: z.string().nullable(), admin: z.union([z.literal(0), z.literal(1)]), created_at: z.number().int() })
  .transform((row): Account => ({ id: row.id, email: row.email, displayName: row.display_name, admin: row.admin === 1, createdAt: row.created_at }));

const ACCOUNT_COLUMNS = "accounts.id, accounts.email, accounts.display_name, accounts.admin, accounts.created_at";

export function accountByEmail(db: Database, email: string): Account | undefined {
  return one(accountRow, db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE email = ?`).get(email));
}

export function createAccount(db: Database, account: { readonly id: string; readonly email: string; readonly createdAt: number }): Account {
  db.prepare("INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)").run(account.id, account.email, account.createdAt);
  return { id: account.id, email: account.email, displayName: null, admin: false, createdAt: account.createdAt };
}

/**
 * Sets the display name, and `key`, the form of it that must be unique. "taken" if another account
 * has a name with the same key.
 */
export function setDisplayName(db: Database, accountId: string, name: string, key: string): "set" | "taken" {
  const taken = one(z.object({ id: z.string() }), db.prepare("SELECT id FROM accounts WHERE display_name_key = ? AND id <> ?").get(key, accountId));
  if (taken !== undefined) return "taken";
  db.prepare("UPDATE accounts SET display_name = ?, display_name_key = ? WHERE id = ?").run(name, key, accountId);
  return "set";
}

export function createSignInLink(db: Database, link: { readonly tokenHash: string; readonly email: string; readonly createdAt: number; readonly expiresAt: number }): void {
  db.prepare("INSERT INTO sign_in_links (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)").run(link.tokenHash, link.email, link.createdAt, link.expiresAt);
}

export function deleteSignInLink(db: Database, tokenHash: string): void {
  db.prepare("DELETE FROM sign_in_links WHERE token_hash = ?").run(tokenHash);
}

/**
 * Uses a link up: marks it used if it is unused and in date, and returns its email. Undefined if
 * there is no such link, or it was used, or it ran out. One statement, so two presses at once can't
 * both use it.
 */
export function useSignInLink(db: Database, tokenHash: string, now: number): string | undefined {
  const row = db.prepare("UPDATE sign_in_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email").get(now, tokenHash, now);
  return one(z.object({ email: z.string() }), row)?.email;
}

export function createSession(db: Database, session: { readonly tokenHash: string; readonly accountId: string; readonly createdAt: number; readonly expiresAt: number }): void {
  db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(
    session.tokenHash,
    session.accountId,
    session.createdAt,
    session.createdAt,
    session.expiresAt,
  );
}

const sessionRow = z.object({ last_seen_at: z.number().int() });

/** The account a session belongs to, and when the session was last seen. Undefined if there is no such session, or it ran out. */
export function sessionAccount(db: Database, tokenHash: string, now: number): { readonly account: Account; readonly lastSeenAt: number } | undefined {
  const row = db.prepare(`SELECT ${ACCOUNT_COLUMNS}, sessions.last_seen_at FROM sessions JOIN accounts ON accounts.id = sessions.account_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(tokenHash, now);
  if (row === undefined) return undefined;
  return { account: accountRow.parse(row), lastSeenAt: sessionRow.parse(row).last_seen_at };
}

/** Records a session's use, and moves the time it runs out to `expiresAt`. */
export function touchSession(db: Database, tokenHash: string, now: number, expiresAt: number): void {
  db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?").run(now, expiresAt, tokenHash);
}

export function deleteSession(db: Database, tokenHash: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

/** Deletes every link and session that has run out. A used link is kept until then: it is how a second press is told the link was used. */
export function deleteExpired(db: Database, now: number): void {
  db.prepare("DELETE FROM sign_in_links WHERE expires_at <= ?").run(now);
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
}
