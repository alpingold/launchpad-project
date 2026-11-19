/**
 * The queries about Generations and their steps (migrations/0006-generations.sql). With
 * database.ts, the only file with SQL about them. Every value goes in as a parameter; every row read
 * is parsed.
 *
 * A state changes only from the state the caller last saw (`from`): a Generation the Creator
 * cancelled meanwhile stays cancelled, and the pipeline sees that its write did nothing.
 *
 * Times here are whole seconds since 1970, as the tables keep them.
 */
import { z } from "zod";
import { transaction, type Database } from "./database.js";
import type { About, Problem } from "./games.js";
import { all, one } from "./rows.js";

export type GenerationKind = "generation" | "revision";
export type GenerationState = "concept" | "review" | "build" | "playtest" | "ready" | "failed" | "cancelled";
/** The states the pipeline works in: each holds a place in the queue, or is being worked on. */
export const WORKING: readonly GenerationState[] = ["concept", "build", "playtest"];
/** The states nothing more happens in. */
export const FINAL: readonly GenerationState[] = ["ready", "failed", "cancelled"];
export type StepKind = "concept" | "build" | "typeFix" | "playtest";

export interface Generation {
  readonly id: string;
  readonly accountId: string;
  readonly kind: GenerationKind;
  readonly gameId: string | null;
  /** A Revision's: the Version it changes. */
  readonly baseVersionId: string | null;
  readonly idea: string;
  readonly state: GenerationState;
  /** The Concept as JSON text was parsed: still to be checked (concept.ts) before it is trusted. */
  readonly concept: unknown;
  /** What the Creator asked to change in the Concept, while it is redrafted. */
  readonly note: string | null;
  readonly code: string | null;
  readonly builds: number;
  readonly typeFixes: number;
  readonly modelCalls: number;
  readonly versionId: string | null;
  readonly reason: string | null;
  readonly waiting: { readonly why: "rateLimited" | "unavailable"; readonly until: number } | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface Step {
  readonly number: number;
  readonly kind: StepKind;
  readonly beganAt: number;
  readonly endedAt: number | null;
  readonly outcome: string | null;
  readonly problems: readonly Problem[] | null;
}

const json = z.string().transform((text) => JSON.parse(text) as unknown);
const problemsJson = json.pipe(z.array(z.object({ stage: z.string(), message: z.string(), line: z.number().optional() })));

const generationRow = z
  .object({
    id: z.string(),
    account_id: z.string(),
    kind: z.enum(["generation", "revision"]),
    game_id: z.string().nullable(),
    base_version_id: z.string().nullable(),
    idea: z.string(),
    state: z.enum(["concept", "review", "build", "playtest", "ready", "failed", "cancelled"]),
    concept: json.nullable(),
    note: z.string().nullable(),
    code: z.string().nullable(),
    builds: z.number().int(),
    type_fixes: z.number().int(),
    model_calls: z.number().int(),
    version_id: z.string().nullable(),
    reason: z.string().nullable(),
    waiting_why: z.enum(["rateLimited", "unavailable"]).nullable(),
    waiting_until: z.number().int().nullable(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
  })
  .transform(
    (row): Generation => ({
      id: row.id,
      accountId: row.account_id,
      kind: row.kind,
      gameId: row.game_id,
      baseVersionId: row.base_version_id,
      idea: row.idea,
      state: row.state,
      concept: row.concept,
      note: row.note,
      code: row.code,
      builds: row.builds,
      typeFixes: row.type_fixes,
      modelCalls: row.model_calls,
      versionId: row.version_id,
      reason: row.reason,
      waiting: row.waiting_why === null || row.waiting_until === null ? null : { why: row.waiting_why, until: row.waiting_until },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );

const COLUMNS = "id, account_id, kind, game_id, base_version_id, idea, state, concept, note, code, builds, type_fixes, model_calls, version_id, reason, waiting_why, waiting_until, created_at, updated_at";

const stepRow = z
  .object({
    number: z.number().int(),
    kind: z.enum(["concept", "build", "typeFix", "playtest"]),
    began_at: z.number().int(),
    ended_at: z.number().int().nullable(),
    outcome: z.string().nullable(),
    problems: problemsJson.nullable(),
  })
  .transform((row): Step => ({ number: row.number, kind: row.kind, beganAt: row.began_at, endedAt: row.ended_at, outcome: row.outcome, problems: row.problems }));

const placeholders = (items: readonly unknown[]) => items.map(() => "?").join(", ");

export function createGeneration(
  db: Database,
  generation: {
    readonly id: string;
    readonly accountId: string;
    readonly kind: GenerationKind;
    /** A Revision's Game and the Version it changes. */
    readonly revises?: { readonly gameId: string; readonly versionId: string };
    /** A Revision's Concept: its Game's, if a Generation made it. */
    readonly concept?: unknown;
    readonly idea: string;
    readonly state: GenerationState;
    /** A Revision starts at its first Build. */
    readonly builds?: number;
    readonly at: number;
  },
): void {
  db.prepare("INSERT INTO generations (id, account_id, kind, game_id, base_version_id, idea, state, concept, builds, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    generation.id,
    generation.accountId,
    generation.kind,
    generation.revises?.gameId ?? null,
    generation.revises?.versionId ?? null,
    generation.idea,
    generation.state,
    generation.concept === undefined ? null : JSON.stringify(generation.concept),
    generation.builds ?? 0,
    generation.at,
    generation.at,
  );
}

/** The Concept a Generation made this Game from, if one did: what its Revisions are checked against too. */
export function conceptOfGame(db: Database, gameId: string): unknown {
  const row = one(z.object({ concept: json }), db.prepare("SELECT concept FROM generations WHERE game_id = ? AND kind = 'generation' AND state = 'ready' AND concept IS NOT NULL LIMIT 1").get(gameId));
  return row?.concept;
}

export function generationById(db: Database, id: string): Generation | undefined {
  return one(generationRow, db.prepare(`SELECT ${COLUMNS} FROM generations WHERE id = ?`).get(id));
}

/** An account's Generations and Revisions, newest first. */
export function generationsOf(db: Database, accountId: string): Generation[] {
  return all(generationRow, db.prepare(`SELECT ${COLUMNS} FROM generations WHERE account_id = ? ORDER BY created_at DESC, id`).all(accountId));
}

/** The ids of every Generation the pipeline works on, oldest change first: the queue, after a restart. */
export function workingGenerations(db: Database): { readonly id: string; readonly accountId: string }[] {
  const rows = db.prepare(`SELECT id, account_id FROM generations WHERE state IN (${placeholders(WORKING)}) ORDER BY updated_at, created_at, id`).all(...WORKING);
  return all(z.object({ id: z.string(), account_id: z.string() }), rows).map((row) => ({ id: row.id, accountId: row.account_id }));
}

/** How many of this kind the account started since `since`, whatever became of them. */
export function countStartedSince(db: Database, accountId: string, kind: GenerationKind, since: number): number {
  const row = one(z.object({ n: z.number().int() }), db.prepare("SELECT count(*) AS n FROM generations WHERE account_id = ? AND kind = ? AND created_at >= ?").get(accountId, kind, since));
  return row?.n ?? 0;
}

/** Whether the account has one the pipeline is working on, or that waits in its line. */
export function hasWorking(db: Database, accountId: string): boolean {
  return db.prepare(`SELECT 1 FROM generations WHERE account_id = ? AND state IN (${placeholders(WORKING)}) LIMIT 1`).get(accountId, ...WORKING) !== undefined;
}

/** The ids of Concepts waiting for their Creator since before `before`. */
export function reviewsWaitingSince(db: Database, before: number): string[] {
  return all(z.object({ id: z.string() }), db.prepare("SELECT id FROM generations WHERE state = 'review' AND updated_at < ?").all(before)).map((row) => row.id);
}

/** What may change along with the state. Left out, unchanged. */
export interface Change {
  readonly concept?: unknown;
  readonly note?: string | null;
  readonly code?: string | null;
  readonly builds?: number;
  readonly typeFixes?: number;
  readonly reason?: string;
}

/**
 * Moves a Generation from one of the states `from` to `to`, with what else changes. True if it
 * moved; false if it was no longer in any of `from` (cancelled meanwhile, say). Moving clears the
 * notice of a wait.
 */
export function moveGeneration(db: Database, id: string, from: readonly GenerationState[], to: GenerationState, change: Change, at: number): boolean {
  const sets = ["state = ?", "updated_at = ?", "waiting_why = NULL", "waiting_until = NULL"];
  const values: (string | number | null)[] = [to, at];
  if (change.concept !== undefined) (sets.push("concept = ?"), values.push(JSON.stringify(change.concept)));
  if (change.note !== undefined) (sets.push("note = ?"), values.push(change.note));
  if (change.code !== undefined) (sets.push("code = ?"), values.push(change.code));
  if (change.builds !== undefined) (sets.push("builds = ?"), values.push(change.builds));
  if (change.typeFixes !== undefined) (sets.push("type_fixes = ?"), values.push(change.typeFixes));
  if (change.reason !== undefined) (sets.push("reason = ?"), values.push(change.reason));
  const result = db.prepare(`UPDATE generations SET ${sets.join(", ")} WHERE id = ? AND state IN (${placeholders(from)})`).run(...values, id, ...from);
  return Number(result.changes) === 1;
}

/**
 * Counts one more call to the model, before it is made, if the Generation is still being worked on
 * and has calls left. The count after, or undefined if it may not call (no calls left, or no longer
 * being worked on).
 */
export function countModelCall(db: Database, id: string, max: number, at: number): number | undefined {
  const result = db.prepare(`UPDATE generations SET model_calls = model_calls + 1, updated_at = ? WHERE id = ? AND model_calls < ? AND state IN (${placeholders(WORKING)})`).run(at, id, max, ...WORKING);
  if (Number(result.changes) !== 1) return undefined;
  return generationById(db, id)?.modelCalls;
}

/** Shows that it waits for GenAI Studio until `until`, or (null) that it no longer does. */
export function setWaiting(db: Database, id: string, waiting: { readonly why: "rateLimited" | "unavailable"; readonly until: number } | null, at: number): void {
  db.prepare(`UPDATE generations SET waiting_why = ?, waiting_until = ?, updated_at = ? WHERE id = ? AND state IN (${placeholders(WORKING)})`).run(
    waiting?.why ?? null,
    waiting?.until ?? null,
    at,
    id,
    ...WORKING,
  );
}

/** Writes that a step began, before it is taken. Its number. */
export function beginStep(db: Database, generationId: string, kind: StepKind, at: number): number {
  return transaction(db, () => {
    const last = one(z.object({ last: z.number().int().nullable() }), db.prepare("SELECT max(number) AS last FROM generation_steps WHERE generation_id = ?").get(generationId));
    const number = (last?.last ?? 0) + 1;
    db.prepare("INSERT INTO generation_steps (generation_id, number, kind, began_at) VALUES (?, ?, ?, ?)").run(generationId, number, kind, at);
    return number;
  });
}

/** Writes how a step ended, and every problem it found. */
export function endStep(db: Database, generationId: string, number: number, outcome: string, problems: readonly Problem[] | null, at: number): void {
  db.prepare("UPDATE generation_steps SET ended_at = ?, outcome = ?, problems = ? WHERE generation_id = ? AND number = ? AND ended_at IS NULL").run(
    at,
    outcome,
    problems === null ? null : JSON.stringify(problems),
    generationId,
    number,
  );
}

/** Ends every step a restart cut short, as `interrupted`. How many. */
export function interruptSteps(db: Database, at: number): number {
  return Number(db.prepare("UPDATE generation_steps SET ended_at = ?, outcome = 'interrupted' WHERE ended_at IS NULL").run(at).changes);
}

/** A Generation's steps, in order. */
export function stepsOf(db: Database, generationId: string): Step[] {
  return all(stepRow, db.prepare("SELECT number, kind, began_at, ended_at, outcome, problems FROM generation_steps WHERE generation_id = ? ORDER BY number").all(generationId));
}

/**
 * A Build that passed becomes a Version, already `ready`, in one transaction: for a Generation a new
 * Game too, made by its account. False, and nothing written, if the Generation was no longer in its
 * playtest (cancelled meanwhile).
 */
export function finishGeneration(
  db: Database,
  done: {
    readonly generation: Generation;
    readonly gameId: string;
    readonly versionId: string;
    readonly source: string;
    readonly bundle: string;
    readonly about: About;
    readonly at: number;
  },
): boolean {
  const { generation } = done;
  return transaction(db, () => {
    const current = generationById(db, generation.id);
    if (current?.state !== "playtest") return false;
    if (generation.kind === "generation") db.prepare("INSERT INTO games (id, owner_id, created_at) VALUES (?, ?, ?)").run(done.gameId, generation.accountId, done.at);
    const last = one(z.object({ last: z.number().int().nullable() }), db.prepare("SELECT max(number) AS last FROM versions WHERE game_id = ?").get(done.gameId));
    db.prepare(
      "INSERT INTO versions (id, game_id, number, made_by, source, state, bundle, about, sdk_version, created_at, checked_at) VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, 'v1', ?, ?)",
    ).run(done.versionId, done.gameId, (last?.last ?? 0) + 1, generation.kind, done.source, done.bundle, JSON.stringify(done.about), done.at, done.at);
    db.prepare("UPDATE generations SET state = 'ready', game_id = ?, version_id = ?, code = ?, updated_at = ?, waiting_why = NULL, waiting_until = NULL WHERE id = ?").run(
      done.gameId,
      done.versionId,
      done.source,
      done.at,
      generation.id,
    );
    return true;
  });
}
