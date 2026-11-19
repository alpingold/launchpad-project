/**
 * The pipeline (BUILD-PLAN Step 32): it carries each Generation from its Creator's idea to a ready
 * Version, one stage at a time, and keeps the queue.
 *
 * - **The rows are the truth.** Every stage is written before it begins and every step (a call to
 *   the model, a Playtest) before and after, so a restart finds each Generation where it was and
 *   carries on from the start of that stage. A Generation in `review` waits for its Creator and holds
 *   no place.
 * - **The queue:** RUNNING_AT_ONCE worked on at once, one per account, MAX_WAITING_GENERATIONS
 *   waiting; and GENERATIONS_PER_DAY started per account (numbers.ts). One that fails for nothing its
 *   Creator did (GenAI Studio busy or down, the site's own check or code failing) doesn't count.
 * - **The Playtest's slots are shared with Uploads.** Generations' Playtests take one at a time, so
 *   an Upload's check never waits behind more than one of them.
 * - **GenAI Studio busy or down:** the call is made again after each of UNAVAILABLE_WAITS_MS, the
 *   Creator shown why and until when; then the Generation fails. A rejected key fails it at once.
 * - **The Creator's key** is decrypted for each call and goes nowhere but the call. Each call is
 *   counted, and the count written, before it is made: a restart can't spend a key past the cap.
 *
 * It only passes text: the model's code runs in the Playtest, nowhere else. Nothing here blocks the
 * server: a call to the model is minutes of waiting, not of work.
 */
import { randomBytes } from "node:crypto";
import type { PlaytestRunner, RunOptions, RunResult } from "@boilergames/playtest/client";
import type { Database } from "../db/database.js";
import { countGames, countVersions, gameById, versionSource, versionsOf } from "../db/games.js";
import { storedKey } from "../db/genai-keys.js";
import {
  beginStep,
  conceptOfVersion,
  countModelCall,
  countStartedSince,
  createGeneration,
  endStep,
  FINAL,
  finishGeneration,
  generationById,
  hasWorking,
  interruptSteps,
  moveGeneration,
  reviewsWaitingSince,
  setWaiting,
  stepsOf,
  WORKING,
  workingGenerations,
  type Generation,
  type GenerationState,
  type StepKind,
} from "../db/generations.js";
import { GAMES_PER_ACCOUNT, VERSIONS_PER_GAME } from "../games.js";
import type { Clock } from "../rooms.js";
import { buildGame, buildMessages, expectOf, generationContext, revisionContext, revisionMessages, type BuildProgress } from "./build.js";
import { checkConcept, draftConcept, invalidConceptsReason, readConcept, type Concept } from "./concept.js";
import type { KeySecret } from "./key-secret.js";
import { longestCodeBlock, type ChatMessage, type Completion, type Model, type ModelFailure } from "./model.js";
import {
  GENERATIONS_PER_DAY,
  MAX_IDEA_CHARS,
  MAX_MODEL_CALLS,
  MAX_REQUEST_CHARS,
  MAX_WAITING_GENERATIONS,
  REVIEW_EXPIRES_MS,
  REVISIONS_PER_DAY,
  RUNNING_AT_ONCE,
  UNAVAILABLE_WAITS_MS,
} from "./numbers.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How often Concepts left waiting are looked for. */
const SWEEP_MS = 60 * 60 * 1000;

/** Said of one that failed for nothing its Creator did. */
const NOT_COUNTED = "this one doesn't count against your day's limit.";

/** What the Creator is told, for each way a Generation can end without a Game. */
export const REASONS = {
  keyRejected: "GenAI Studio refused your key. Check it on your key page, save it again if it changed, and start again.",
  unavailable: `GenAI Studio was busy or down for too long. Start again later: ${NOT_COUNTED}`,
  noKey: "Your GenAI Studio key is gone, or can't be read any more. Save it again, then start again.",
  cancelled: "You cancelled it.",
  expired: "Nobody approved the Concept within 7 days.",
  tooManyGames: `You have ${GAMES_PER_ACCOUNT} Games, the most one account may have. Ask the AI for a change to one of them instead.`,
  tooManyVersions: `This Game has ${VERSIONS_PER_GAME} Versions, the most one Game may have. Start a new Game for more.`,
  baseGone: "The Version this Revision changes can't be read any more. Ask for the change again.",
  callsUsed: "The Generation used all the model calls it may make.",
  site: `Something went wrong on the site's side. Start again: ${NOT_COUNTED}`,
  conceptUnreadable: `Its Concept can't be read any more. Start again: ${NOT_COUNTED}`,
} as const;

/** Why one couldn't carry on after a restart: the site's own doing. */
export const restartReason = (why: string) => `This couldn't carry on after the site restarted (${why}). Start again: ${NOT_COUNTED}`;

export type Refusal = { readonly ok: false; readonly status: number; readonly error: string };

export interface PipelineOptions {
  readonly database: Database;
  readonly model: Model;
  readonly keySecret: KeySecret;
  /** The site's Playtest. The pipeline uses one of its slots at a time. */
  readonly playtest: PlaytestRunner;
  readonly clock: Clock;
  /** Where failures of the site's own are written: never a key, never what a Creator wrote. */
  readonly log?: (line: string) => void;
  readonly newId?: () => string;
}

/** Thrown inside a Generation's work when it is no longer being worked on (cancelled meanwhile, or the server stopping). */
class Stopped extends Error {}

/** The Creator's key, or why there is none. */
type Key = { readonly ok: true; readonly key: string } | { readonly ok: false };

export class Pipeline {
  readonly #db: Database;
  readonly #model: Model;
  readonly #keySecret: KeySecret;
  readonly #playtest: PlaytestRunner;
  readonly #clock: Clock;
  readonly #log: (line: string) => void;
  readonly #newId: () => string;
  readonly #waiting: { readonly id: string; readonly accountId: string }[] = [];
  /** Worked on now: each one's account, and how to give up its call to the model. */
  readonly #running = new Map<string, { readonly accountId: string; readonly abort: AbortController }>();
  readonly #inFlight = new Set<Promise<void>>();
  /** The pipeline's Playtests, one after another: the end of the last one asked for. */
  #playtestTurn: Promise<unknown> = Promise.resolve();
  #stopped = false;
  #cancelSweep: () => void = () => undefined;

  constructor(options: PipelineOptions) {
    this.#db = options.database;
    this.#model = options.model;
    this.#keySecret = options.keySecret;
    this.#playtest = options.playtest;
    this.#clock = options.clock;
    this.#log = options.log ?? ((line) => console.error(line));
    this.#newId = options.newId ?? (() => randomBytes(16).toString("base64url"));
    this.#resume();
    this.#sweep();
    this.#next();
  }

  #seconds(): number {
    return Math.floor(this.#clock.now() / 1000);
  }

  // --- What a Creator does ------------------------------------------------------------------------

  /** Starts a Generation from an idea: it waits in the line, then the AI drafts its Concept. */
  start(accountId: string, idea: string): { readonly ok: true; readonly generation: Generation } | Refusal {
    const text = idea.trim();
    if (text === "" || text.length > MAX_IDEA_CHARS) return { ok: false, status: 400, error: `Describe your idea in 1 to ${MAX_IDEA_CHARS} characters.` };
    if (!this.#key(accountId).ok) return { ok: false, status: 409, error: "Save your GenAI Studio key first: the AI uses it to make your Game." };
    if (hasWorking(this.#db, accountId)) return { ok: false, status: 409, error: "The AI is already working on one of yours. Wait for it, or cancel it, then start another." };
    if (countGames(this.#db, accountId) >= GAMES_PER_ACCOUNT) return { ok: false, status: 409, error: REASONS.tooManyGames };
    const since = Math.floor((this.#clock.now() - DAY_MS) / 1000);
    if (countStartedSince(this.#db, accountId, "generation", since) >= GENERATIONS_PER_DAY) {
      return { ok: false, status: 429, error: `You can start ${GENERATIONS_PER_DAY} Generations a day. Try again tomorrow.` };
    }
    if (this.#waiting.length >= MAX_WAITING_GENERATIONS) return { ok: false, status: 503, error: "The AI's line is full. Try again in a few minutes." };
    const id = this.#newId();
    createGeneration(this.#db, { id, accountId, kind: "generation", idea: text, state: "concept", at: this.#seconds() });
    this.#add(id, accountId);
    const generation = generationById(this.#db, id);
    if (generation === undefined) throw new Error("the Generation just made can't be read");
    return { ok: true, generation };
  }

  /**
   * Asks the AI for a change to one ready Version of the Creator's Game (story 29): a Revision. It
   * waits in the line, then is built and checked like a Generation's Build, and a pass makes a new
   * Version, which isn't published. A Game a Generation made is checked against its Concept too.
   */
  revise(accountId: string, gameId: string, versionId: string, request: string): { readonly ok: true; readonly generation: Generation } | Refusal {
    const text = request.trim();
    if (text === "" || text.length > MAX_REQUEST_CHARS) return { ok: false, status: 400, error: `Say what to change, in 1 to ${MAX_REQUEST_CHARS} characters.` };
    if (gameById(this.#db, gameId)?.ownerId !== accountId) return { ok: false, status: 404, error: "There's no such Game of yours." };
    const version = versionsOf(this.#db, gameId).find((each) => each.id === versionId);
    if (version === undefined) return { ok: false, status: 404, error: "There's no such Version of this Game." };
    if (version.state !== "ready" || versionSource(this.#db, gameId, versionId) === undefined) return { ok: false, status: 409, error: "Only a Version that passed its check can be changed." };
    if (!this.#key(accountId).ok) return { ok: false, status: 409, error: "Save your GenAI Studio key first: the AI uses it to make the change." };
    if (hasWorking(this.#db, accountId)) return { ok: false, status: 409, error: "The AI is already working on one of yours. Wait for it, or cancel it, then ask for this change." };
    if (countVersions(this.#db, gameId) >= VERSIONS_PER_GAME) return { ok: false, status: 409, error: REASONS.tooManyVersions };
    const since = Math.floor((this.#clock.now() - DAY_MS) / 1000);
    if (countStartedSince(this.#db, accountId, "revision", since) >= REVISIONS_PER_DAY) {
      return { ok: false, status: 429, error: `You can ask for ${REVISIONS_PER_DAY} changes a day. Try again tomorrow.` };
    }
    if (this.#waiting.length >= MAX_WAITING_GENERATIONS) return { ok: false, status: 503, error: "The AI's line is full. Try again in a few minutes." };
    const id = this.#newId();
    // Checked against the Concept the Version being changed was made against, if any: the Concept of
    // the Generation that made it, or the one the Revision that made it was held to. A Version the
    // Creator uploaded, and every Revision made from it, is their own design and held to none.
    const concept = version.madeBy === "upload" ? undefined : conceptOfVersion(this.#db, versionId);
    createGeneration(this.#db, {
      id,
      accountId,
      kind: "revision",
      revises: { gameId, versionId },
      ...(concept === undefined ? {} : { concept }),
      idea: text,
      state: "build",
      builds: 1,
      at: this.#seconds(),
    });
    this.#add(id, accountId);
    const generation = generationById(this.#db, id);
    if (generation === undefined) throw new Error("the Revision just made can't be read");
    return { ok: true, generation };
  }

  /** Approves the Concept in review, as the AI drafted it or as the Creator edited it: then the Build. */
  approve(accountId: string, id: string, edited?: unknown): { readonly ok: true } | Refusal | { readonly ok: false; readonly status: 400; readonly error: string; readonly problems: readonly string[] } {
    const generation = this.#owned(accountId, id);
    if (generation === undefined) return { ok: false, status: 404, error: "There is no such Generation." };
    if (generation.state !== "review") return { ok: false, status: 409, error: "This Generation isn't waiting for its Concept to be approved." };
    const checked = checkConcept(edited ?? generation.concept);
    if (!checked.ok) return { ok: false, status: 400, error: "The Concept has problems.", problems: checked.problems };
    // One at a time for an account, in the line or worked on: approving one counts as starting it.
    if (hasWorking(this.#db, accountId)) return { ok: false, status: 409, error: "The AI is already working on one of yours. Wait for it, or cancel it, then approve this one." };
    if (countGames(this.#db, accountId) >= GAMES_PER_ACCOUNT) return { ok: false, status: 409, error: REASONS.tooManyGames };
    if (this.#waiting.length >= MAX_WAITING_GENERATIONS) return { ok: false, status: 503, error: "The AI's line is full. Try again in a few minutes." };
    if (!moveGeneration(this.#db, id, ["review"], "build", { concept: checked.concept, code: null, builds: 1, typeFixes: 0 }, this.#seconds())) {
      return { ok: false, status: 409, error: "This Generation isn't waiting for its Concept to be approved." };
    }
    this.#add(id, accountId);
    return { ok: true };
  }

  /** Saves the Creator's edits to the Concept in review, if they pass every rule; otherwise every problem. */
  editConcept(accountId: string, id: string, edited: unknown): { readonly ok: true } | Refusal | { readonly ok: false; readonly status: 400; readonly error: string; readonly problems: readonly string[] } {
    const generation = this.#owned(accountId, id);
    if (generation === undefined) return { ok: false, status: 404, error: "There is no such Generation." };
    const checked = checkConcept(edited);
    if (!checked.ok) return { ok: false, status: 400, error: "The Concept has problems.", problems: checked.problems };
    if (!moveGeneration(this.#db, id, ["review"], "review", { concept: checked.concept }, this.#seconds())) {
      return { ok: false, status: 409, error: "This Generation isn't waiting for its Concept to be approved." };
    }
    return { ok: true };
  }

  /**
   * Sends the Concept in review back to the AI, with the Creator's note on what to change, and their
   * edits to it if they made any (checked like any edit).
   */
  redraft(accountId: string, id: string, note: string, edited?: unknown): { readonly ok: true } | Refusal | { readonly ok: false; readonly status: 400; readonly error: string; readonly problems: readonly string[] } {
    const generation = this.#owned(accountId, id);
    if (generation === undefined) return { ok: false, status: 404, error: "There is no such Generation." };
    if (generation.state !== "review") return { ok: false, status: 409, error: "This Generation isn't waiting for its Concept to be approved." };
    const checked = edited === undefined ? undefined : checkConcept(edited);
    if (checked?.ok === false) return { ok: false, status: 400, error: "The Concept has problems.", problems: checked.problems };
    if (hasWorking(this.#db, accountId)) return { ok: false, status: 409, error: "The AI is already working on one of yours. Wait for it, or cancel it, then ask for a new draft." };
    if (this.#waiting.length >= MAX_WAITING_GENERATIONS) return { ok: false, status: 503, error: "The AI's line is full. Try again in a few minutes." };
    if (!moveGeneration(this.#db, id, ["review"], "concept", { note: note.trim(), ...(checked === undefined ? {} : { concept: checked.concept }) }, this.#seconds())) {
      return { ok: false, status: 409, error: "This Generation isn't waiting for its Concept to be approved." };
    }
    this.#add(id, accountId);
    return { ok: true };
  }

  /** Cancels it, whatever it is doing: a call to the model is given up at once. False if there was nothing to cancel. */
  cancel(accountId: string, id: string): boolean {
    const generation = this.#owned(accountId, id);
    if (generation === undefined || FINAL.includes(generation.state)) return false;
    return this.#end(id, "cancelled", REASONS.cancelled);
  }

  /**
   * Where it is: 0 while the AI works on it, its place in the line from 1 while it waits, undefined
   * when it holds no place (in review, or over).
   */
  place(id: string): number | undefined {
    if (this.#running.has(id)) return 0;
    const at = this.#waiting.findIndex((waiting) => waiting.id === id);
    return at < 0 ? undefined : at + 1;
  }

  /** Stops starting work, and gives up every call to the model. What was cut short carries on at the next start. */
  stop(): void {
    this.#stopped = true;
    this.#cancelSweep();
    for (const { abort } of this.#running.values()) abort.abort();
  }

  /** Resolves when nothing is being worked on, and nothing that could be is waiting. For tests. */
  async settled(): Promise<void> {
    while (this.#inFlight.size > 0) await Promise.all(this.#inFlight);
  }

  #owned(accountId: string, id: string): Generation | undefined {
    const generation = generationById(this.#db, id);
    return generation?.accountId === accountId ? generation : undefined;
  }

  // --- The queue ------------------------------------------------------------------------------------

  #add(id: string, accountId: string): void {
    if (this.#running.has(id) || this.#waiting.some((waiting) => waiting.id === id)) return;
    this.#waiting.push({ id, accountId });
    this.#next();
  }

  #next(): void {
    while (!this.#stopped && this.#running.size < RUNNING_AT_ONCE) {
      const busy = new Set([...this.#running.values()].map((running) => running.accountId));
      const at = this.#waiting.findIndex((waiting) => !busy.has(waiting.accountId));
      if (at < 0) return;
      const [chosen] = this.#waiting.splice(at, 1);
      if (chosen === undefined) return;
      const abort = new AbortController();
      this.#running.set(chosen.id, { accountId: chosen.accountId, abort });
      const work = this.#work(chosen.id, abort.signal).finally(() => {
        this.#running.delete(chosen.id);
        this.#inFlight.delete(work);
        this.#next();
      });
      this.#inFlight.add(work);
    }
  }

  /**
   * Ends it as failed or cancelled, if it isn't over already, and stops any work on it. `counted`
   * false: it failed for nothing its Creator did, and doesn't count against their daily limit.
   */
  #end(id: string, to: "failed" | "cancelled", reason: string, counted = true): boolean {
    // A note asking for a new draft goes too: it is kept only until it is drafted (the privacy page).
    const moved = moveGeneration(this.#db, id, ["concept", "review", "build", "playtest"], to, { reason, note: null, ...(counted ? {} : { counted: false }) }, this.#seconds());
    const at = this.#waiting.findIndex((waiting) => waiting.id === id);
    if (at >= 0) this.#waiting.splice(at, 1);
    this.#running.get(id)?.abort.abort();
    return moved;
  }

  // --- After a restart ------------------------------------------------------------------------------

  /** Every Generation that was being worked on goes back in the line; one that can't carry on fails, saying why. */
  #resume(): void {
    const at = this.#seconds();
    let working: { readonly id: string; readonly accountId: string }[];
    try {
      interruptSteps(this.#db, at);
      working = workingGenerations(this.#db);
    } catch (error) {
      // Never stops the server from starting: the Generations wait for the next start.
      this.#log(`Generations: couldn't read what was under way: ${(error as Error).message}`);
      return;
    }
    for (const { id, accountId } of working) {
      try {
        const generation = generationById(this.#db, id);
        if (generation === undefined) continue;
        const why = cantCarryOn(generation);
        if (why !== undefined) {
          this.#log(`Generations: ${id} can't carry on after a restart: ${why}`);
          moveGeneration(this.#db, id, WORKING, "failed", { reason: restartReason(why), note: null, counted: false }, at);
          continue;
        }
        setWaiting(this.#db, id, null, at);
        this.#waiting.push({ id, accountId });
      } catch (error) {
        // A row that makes no sense must never stop the server from starting.
        this.#log(`Generations: ${id} couldn't be read after a restart: ${(error as Error).message}`);
        try {
          moveGeneration(this.#db, id, WORKING, "failed", { reason: REASONS.site, note: null, counted: false }, at);
        } catch {
          // Left as it is: it is not in the line, and the site carries on.
        }
      }
    }
  }

  /** Cancels Concepts left waiting too long; again every SWEEP_MS. */
  #sweep(): void {
    if (this.#stopped) return;
    const before = Math.floor((this.#clock.now() - REVIEW_EXPIRES_MS) / 1000);
    try {
      for (const id of reviewsWaitingSince(this.#db, before)) this.#end(id, "cancelled", REASONS.expired);
    } catch (error) {
      this.#log(`Generations: couldn't cancel the Concepts left waiting: ${(error as Error).message}`);
    }
    this.#cancelSweep = this.#clock.setTimeout(() => this.#sweep(), SWEEP_MS);
  }

  // --- The work -------------------------------------------------------------------------------------

  async #work(id: string, signal: AbortSignal): Promise<void> {
    try {
      const generation = generationById(this.#db, id);
      if (generation === undefined || !WORKING.includes(generation.state)) return;
      if (generation.state === "concept") await this.#concept(generation, signal);
      else await this.#build(generation, signal);
    } catch (error) {
      if (error instanceof Stopped) return;
      this.#log(`Generations: ${id} failed on the site's side: ${(error as Error).message}`);
      try {
        this.#end(id, "failed", REASONS.site, false);
      } catch (again) {
        // The database itself is failing (or closed after a stop): the row stays as it was, and the
        // next start carries it on. Never an unhandled rejection, which would stop the server.
        this.#log(`Generations: ${id} couldn't be marked failed: ${(again as Error).message}`);
      }
    }
  }

  /** Throws Stopped unless it is still being worked on and the pipeline is running. */
  #stillWorking(id: string, signal: AbortSignal): Generation {
    const generation = generationById(this.#db, id);
    if (this.#stopped || signal.aborted || generation === undefined || !WORKING.includes(generation.state)) throw new Stopped();
    return generation;
  }

  async #concept(generation: Generation, signal: AbortSignal): Promise<void> {
    let outOfCalls = false;
    const ask = async (messages: readonly ChatMessage[]): Promise<Completion> => {
      const answer = await this.#ask(generation, "concept", messages, signal, conceptOutcome);
      if (answer !== undefined) return answer;
      // No calls left: a failure to draftConcept, and the reason below says which.
      outOfCalls = true;
      return { ok: false, failure: "unavailable" };
    };
    // A redraft: the Concept the Creator sent back, and their note on what to change.
    const previous = generation.note === null ? undefined : checkConcept(generation.concept);
    const redraft = previous?.ok === true && generation.note !== null ? { previous: previous.concept, note: generation.note } : undefined;
    const draft = await draftConcept(ask, generation.idea, redraft === undefined ? {} : { redraft });
    this.#stillWorking(generation.id, signal);
    if (draft.kind === "valid") {
      if (!moveGeneration(this.#db, generation.id, ["concept"], "review", { concept: draft.concept, note: null }, this.#seconds())) throw new Stopped();
      return;
    }
    // A redraft that never came out usable, or ran out of calls: back to review with the Concept the
    // Creator sent back, rather than losing it. Its Track shows the tries and their problems.
    if (redraft !== undefined && (draft.kind === "invalid" || outOfCalls)) {
      if (!moveGeneration(this.#db, generation.id, ["concept"], "review", { concept: redraft.previous, note: null }, this.#seconds())) throw new Stopped();
      return;
    }
    if (draft.kind === "invalid") return void this.#end(generation.id, "failed", invalidConceptsReason(draft.attempts));
    if (outOfCalls) return void this.#end(generation.id, "failed", REASONS.callsUsed);
    this.#end(generation.id, "failed", failureReason(draft.failure), draft.failure === "keyRejected");
  }

  async #build(generation: Generation, signal: AbortSignal): Promise<void> {
    // A Generation always has its Concept; a Revision has its Game's, if a Generation made the Game.
    const checked = generation.concept === null && generation.kind === "revision" ? undefined : checkConcept(generation.concept);
    if (checked?.ok === false) return void this.#end(generation.id, "failed", REASONS.conceptUnreadable, false);
    const concept = checked?.concept;
    let first: readonly ChatMessage[];
    let context: string;
    if (generation.kind === "revision") {
      const source = generation.gameId === null || generation.baseVersionId === null ? undefined : versionSource(this.#db, generation.gameId, generation.baseVersionId);
      if (source === undefined) return void this.#end(generation.id, "failed", REASONS.baseGone);
      first = revisionMessages(concept, source, generation.idea);
      context = revisionContext(concept, generation.idea);
    } else {
      if (concept === undefined) return void this.#end(generation.id, "failed", REASONS.conceptUnreadable, false);
      first = buildMessages(concept);
      context = generationContext(concept);
    }
    const result = await buildGame({
      ask: (messages, kind) => this.#ask(generation, kind, messages, signal, buildOutcome),
      playtest: { run: (source, options) => this.#playtestStep(generation.id, source, options, signal) },
      first,
      context,
      ...(concept === undefined ? {} : { expect: expectOf(concept) }),
      from: this.#progressOf(generation),
      onProgress: (stage, progress) => {
        this.#stillWorking(generation.id, signal);
        // Before spending a call of the Creator's key on a Game that couldn't be kept.
        if (stage === "build" && generation.kind === "generation" && countGames(this.#db, generation.accountId) >= GAMES_PER_ACCOUNT) {
          this.#end(generation.id, "failed", REASONS.tooManyGames);
          throw new Stopped();
        }
        if (stage === "build" && generation.kind === "revision" && countVersions(this.#db, generation.gameId ?? "") >= VERSIONS_PER_GAME) {
          this.#end(generation.id, "failed", REASONS.tooManyVersions);
          throw new Stopped();
        }
        const moved = moveGeneration(
          this.#db,
          generation.id,
          ["build", "playtest"],
          stage,
          { code: progress.toCheck ?? progress.lastFile ?? null, builds: progress.builds, typeFixes: progress.typeFixes },
          this.#seconds(),
        );
        if (!moved) throw new Stopped();
      },
    });
    this.#stillWorking(generation.id, signal);
    if (!result.ok) {
      const reason = result.failure === undefined ? result.reason : failureReason(result.failure);
      // GenAI Studio busy or down, or the site's own check failing: nothing the Creator did.
      const counted = !(result.checkFailed === true || (result.failure !== undefined && result.failure !== "keyRejected"));
      return void this.#end(generation.id, "failed", reason, counted);
    }
    if (generation.kind === "generation" && countGames(this.#db, generation.accountId) >= GAMES_PER_ACCOUNT) return void this.#end(generation.id, "failed", REASONS.tooManyGames);
    if (generation.kind === "revision" && countVersions(this.#db, generation.gameId ?? "") >= VERSIONS_PER_GAME) return void this.#end(generation.id, "failed", REASONS.tooManyVersions);
    const current = generationById(this.#db, generation.id);
    if (current === undefined) throw new Stopped();
    const finished = finishGeneration(this.#db, {
      generation: current,
      gameId: current.gameId ?? this.#newId(),
      versionId: this.#newId(),
      source: result.source,
      bundle: result.bundle,
      about: result.about,
      at: this.#seconds(),
    });
    if (!finished) throw new Stopped();
  }

  /** Where a Build carries on from, as its row says. */
  #progressOf(generation: Generation): BuildProgress {
    const base = { builds: Math.max(1, generation.builds), typeFixes: generation.typeFixes };
    if (generation.state === "playtest" && generation.code !== null) return { ...base, lastFile: generation.code, toCheck: generation.code };
    // In build: the last file, and what the last step that found problems found, to send back.
    // After answers with no code, what the last file's check found goes back too (build.ts does the same).
    const found = stepsOf(this.#db, generation.id).filter((step) => step.kind !== "concept" && step.problems !== null && step.problems.length > 0);
    const last = found.at(-1);
    const checked = found.filter((step) => step.kind === "playtest").at(-1)?.problems ?? [];
    const lastProblems = last === undefined ? undefined : last.outcome === "noCode" ? [...checked, ...(last.problems ?? [])] : (last.problems ?? undefined);
    return { ...base, ...(generation.code === null ? {} : { lastFile: generation.code }), ...(lastProblems === undefined ? {} : { problems: lastProblems }) };
  }

  /** The Creator's key, decrypted for this one use. */
  #key(accountId: string): Key {
    const stored = storedKey(this.#db, accountId);
    const key = stored === undefined ? undefined : this.#keySecret.open(accountId, stored.sealed);
    return key === undefined ? { ok: false } : { ok: true, key };
  }

  /**
   * One call to the model, counted and written down before it is made, and again after each wait
   * while GenAI Studio is busy or down. `judge` says how the answer came out, for its step's row.
   * Undefined when the Generation has used all its calls.
   */
  async #ask(
    generation: Generation,
    kind: StepKind,
    messages: readonly ChatMessage[],
    signal: AbortSignal,
    judge: (text: string) => { readonly outcome: string; readonly problems: readonly { readonly stage: string; readonly message: string }[] | null },
  ): Promise<Completion | undefined> {
    const id = generation.id;
    for (let wait = 0; ; wait += 1) {
      this.#stillWorking(id, signal);
      const key = this.#key(generation.accountId);
      if (!key.ok) {
        this.#end(id, "failed", REASONS.noKey);
        throw new Stopped();
      }
      if (countModelCall(this.#db, id, MAX_MODEL_CALLS, this.#seconds()) === undefined) {
        this.#stillWorking(id, signal);
        return undefined;
      }
      const step = beginStep(this.#db, id, kind, this.#seconds());
      const answer = await this.#model.complete(key.key, messages, { signal });
      // A call given up (the Generation cancelled, or the server stopping) came out as neither.
      const judged = signal.aborted ? { outcome: "interrupted", problems: null } : answer.ok ? judge(answer.text) : { outcome: answer.failure, problems: null };
      endStep(this.#db, id, step, judged.outcome, judged.problems, this.#seconds());
      this.#stillWorking(id, signal);
      if (answer.ok || answer.failure === "keyRejected" || wait >= UNAVAILABLE_WAITS_MS.length) {
        setWaiting(this.#db, id, null, this.#seconds());
        return answer;
      }
      const ms = UNAVAILABLE_WAITS_MS[wait] ?? 0;
      setWaiting(this.#db, id, { why: answer.failure, until: Math.floor((this.#clock.now() + ms) / 1000) }, this.#seconds());
      await this.#sleep(ms, signal);
      // Calling again: no longer waiting.
      this.#stillWorking(id, signal);
      setWaiting(this.#db, id, null, this.#seconds());
    }
  }

  /** Waits, or less if the work is given up. */
  #sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        cancel();
        signal.removeEventListener("abort", done);
        resolve();
      };
      const cancel = this.#clock.setTimeout(done, ms);
      signal.addEventListener("abort", done, { once: true });
    });
  }

  /** One Playtest, written down before and after, taking its turn: the pipeline runs one at a time. */
  async #playtestStep(id: string, source: string, options: RunOptions | undefined, signal: AbortSignal): Promise<RunResult> {
    const turn = this.#playtestTurn.then(async () => {
      this.#stillWorking(id, signal);
      const step = beginStep(this.#db, id, "playtest", this.#seconds());
      const result = await this.#playtest.run(source, options);
      const outcome = result.ok ? "passed" : "checkFailed" in result ? "checkFailed" : "problems";
      endStep(this.#db, id, step, outcome, result.ok ? null : result.problems, this.#seconds());
      return result;
    });
    // The next one waits for this one to end, however it ends.
    this.#playtestTurn = turn.catch(() => undefined);
    return turn;
  }
}

/** Why a row in a working state can't carry on, or undefined if it can. */
function cantCarryOn(generation: Generation): string | undefined {
  if (generation.kind === "revision") {
    if (generation.state === "concept") return "a Revision has no Concept to draft";
    if (generation.gameId === null || generation.baseVersionId === null) return "it doesn't say which Version it changes";
    if (generation.concept !== null && !checkConcept(generation.concept).ok) return "its Concept can't be read";
  } else {
    if (generation.state === "concept") return undefined;
    if (!checkConcept(generation.concept).ok) return "its Concept can't be read";
  }
  if (generation.state === "playtest" && generation.code === null) return "it has no code to check";
  if (generation.builds < 1) return "it never began its Build";
  return undefined;
}

function failureReason(failure: ModelFailure): string {
  return failure === "keyRejected" ? REASONS.keyRejected : REASONS.unavailable;
}

/** A Concept draft's answer, for its step's row: valid, or invalid with its problems. */
function conceptOutcome(text: string) {
  const read = readConcept(text);
  return read.ok ? { outcome: "valid", problems: null } : { outcome: "invalid", problems: read.problems.map((message) => ({ stage: "concept", message })) };
}

/** A Build's answer, for its step's row: a file, or no code block (a problem that goes back). */
function buildOutcome(text: string) {
  return longestCodeBlock(text) === undefined
    ? { outcome: "noCode", problems: [{ stage: "source", message: "The answer has no code block. Answer with the whole file, in one TypeScript code block." }] }
    : { outcome: "answered", problems: null };
}

export type { Concept, GenerationState };
