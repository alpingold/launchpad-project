// The pipeline (BUILD-PLAN Step 32), with the scripted model and a clock the test moves: a whole
// Generation from idea to a ready Version; a restart in each state carrying on; the queue's limits;
// the waits while GenAI Studio is busy, and failing as unavailable; a rejected key; cancelling in
// each state; and that a failed Generation leaves no Game.
import { childProcessRunner, type PlaytestRunner, type RunOptions, type RunResult } from "@boilergames/playtest/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createAccount } from "../db/accounts.js";
import { IN_MEMORY, openDatabase, type Database } from "../db/database.js";
import { countGames, gamesOwnedBy, versionsOf } from "../db/games.js";
import { saveKey } from "../db/genai-keys.js";
import { createGeneration, generationById, moveGeneration, stepsOf, type Generation } from "../db/generations.js";
import { GAMES_PER_ACCOUNT } from "../games.js";
import type { Clock } from "../rooms.js";
import type { Concept } from "./concept.js";
import { ScriptedModel, type ScriptedReply } from "./fake-model.js";
import { keySecretFromBytes, SECRET_BYTES } from "./key-secret.js";
import type { ChatMessage, CompleteOptions, Completion, Model, ModelFailure } from "./model.js";
import { GENERATIONS_PER_DAY, MAX_BUILDS, MAX_MODEL_CALLS, MAX_WAITING_GENERATIONS, REVIEW_EXPIRES_MS, UNAVAILABLE_WAITS_MS } from "./numbers.js";
import { Pipeline, REASONS } from "./pipeline.js";

const keySecret = keySecretFromBytes(Buffer.alloc(SECRET_BYTES, 9));
const keyOf = (accountId: string) => `sk-test-${accountId}-0123456789`;

class FakeClock implements Clock {
  time = 1_800_000_000_000;
  readonly #timers: { at: number; run: () => void; live: boolean }[] = [];
  now = () => this.time;
  setTimeout = (run: () => void, ms: number) => {
    const timer = { at: this.time + ms, run, live: true };
    this.#timers.push(timer);
    return () => void (timer.live = false);
  };
  /** Moves time on, running each timer that comes due. */
  advance(ms: number): void {
    this.time += ms;
    for (const timer of this.#timers.filter((each) => each.live && each.at <= this.time)) {
      timer.live = false;
      timer.run();
    }
  }
}

/** The scripted model, with a gate: while held, every call waits until released (or given up). */
class GatedModel implements Model {
  readonly scripted: ScriptedModel;
  held = false;
  readonly #waiting: (() => void)[] = [];
  constructor(script: readonly ScriptedReply[] = [], respond?: (messages: readonly ChatMessage[]) => string | { readonly failure: ModelFailure }) {
    this.scripted = new ScriptedModel(script, respond === undefined ? {} : { respond });
  }
  get calls() {
    return this.scripted.calls;
  }
  get waiting(): number {
    return this.#waiting.length;
  }
  async complete(key: string, messages: readonly ChatMessage[], options: CompleteOptions = {}): Promise<Completion> {
    if (this.held) await new Promise<void>((go) => (this.#waiting.push(go), options.signal?.addEventListener("abort", () => go(), { once: true })));
    return this.scripted.complete(key, messages, options);
  }
  release(): void {
    this.held = false;
    for (const go of this.#waiting.splice(0)) go();
  }
  checkKey(key: string) {
    return this.scripted.checkKey(key);
  }
}

const PASSED: RunResult = { ok: true, bundle: "var BoilerGamesGame = (function() {})();", about: { title: "Tap Vote", players: { min: 2, max: 4 } }, sdkVersion: "v1" };
const PLAY_PROBLEM: RunResult = { ok: false, problems: [{ stage: "play", message: "With 2 Players (seed 1): it never ends" }] };

/** A Playtest that answers from a list (passing when it runs out), and can be held like the model. */
class FakePlaytest implements PlaytestRunner {
  readonly results: RunResult[] = [];
  readonly runs: { readonly source: string; readonly options: RunOptions | undefined }[] = [];
  held = false;
  running = 0;
  most = 0;
  readonly #waiting: (() => void)[] = [];
  async run(source: string, options?: RunOptions): Promise<RunResult> {
    this.runs.push({ source, options });
    this.running += 1;
    this.most = Math.max(this.most, this.running);
    if (this.held) await new Promise<void>((go) => this.#waiting.push(go));
    this.running -= 1;
    return this.results.shift() ?? PASSED;
  }
  release(): void {
    this.held = false;
    for (const go of this.#waiting.splice(0)) go();
  }
}

/** A Concept (test data: never shown to a model). */
const CONCEPT: Concept = {
  title: "Tap Vote",
  pitch: "Everyone taps; the third tap opens the vote, the sixth ends it.",
  players: { min: 2, max: 4 },
  phases: [
    { id: "write", name: "Tap to write", screen: "The taps so far", phone: "A Tap button", ends: "Three taps" },
    { id: "vote", name: "Tap to vote", screen: "The taps so far", phone: "A Tap button", ends: "Six taps" },
  ],
  scoring: { kind: "points", how: "A point per tap." },
  length: "A few seconds.",
  look: { colors: { background: "#101828", text: "#f8fafc", accent: "#f59e0b" }, font: "rounded", corners: "soft" },
};
const CONCEPT_ANSWER = JSON.stringify(CONCEPT);
/** Answers a Build's prompt with a file and a Concept's with the Concept. */
const ANSWER = (messages: readonly ChatMessage[]) => (messages[0]?.content.startsWith("You write party games") === true ? CODE_ANSWER : CONCEPT_ANSWER);
/** The model's file, for a fake Playtest: its text doesn't matter. */
const CODE_ANSWER = "```ts\n// the Game\n```";
/** A file that really works, for the real Playtest (test data: the model's side, never put in a prompt). */
const WORKING_GAME = `\`\`\`ts
import { defineGame, type Context, type ControllerView, type Player, type ScreenView, type Step } from "@boilergames/sdk/v1";
type Phase = "write" | "vote";
interface State { readonly phase: Phase; readonly taps: number; readonly by: Readonly<Record<string, number>> }
type Action = { readonly type: "tap" };
export default defineGame<State, Action>({
  about: ${JSON.stringify({ title: CONCEPT.title, players: CONCEPT.players, look: CONCEPT.look })},
  start(_ctx: Context): Step<State> { return { state: { phase: "write", taps: 0, by: {} } }; },
  onAction(state: State, player: Player, _action: Action, ctx: Context): Step<State> {
    const by = { ...state.by, [player.id]: (state.by[player.id] ?? 0) + 1 };
    const taps = state.taps + 1;
    if (taps >= 6) return { state: { ...state, taps, by }, end: { scores: Object.fromEntries(ctx.players.map((p) => [p.id, by[p.id] ?? 0])) } };
    return { state: { phase: taps >= 3 ? "vote" : "write", taps, by } };
  },
  onLeave(state: State): Step<State> { return { state }; },
  screen(state: State): ScreenView { return { parts: [{ kind: "text", text: \`\${state.taps} taps\` }] }; },
  controller(): ControllerView<Action> { return { parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] }; },
});
\`\`\``;

let db: Database;
let clock: FakeClock;
let playtest: FakePlaytest;
let logged: string[];
const pipelines: Pipeline[] = [];

function account(id: string): string {
  createAccount(db, { id, email: `${id}@purdue.edu`, createdAt: 1 });
  saveKey(db, id, { sealed: keySecret.seal(id, keyOf(id)), last4: "6789", savedAt: 1 });
  return id;
}

function pipeline(model: Model, runner: PlaytestRunner = playtest): Pipeline {
  const made = new Pipeline({ database: db, model, keySecret, playtest: runner, clock, log: (line) => logged.push(line) });
  pipelines.push(made);
  return made;
}

/** Waits for the pipeline's promises to settle, until `done` holds (or fails the test). */
async function until(done: () => boolean, what = "the condition"): Promise<void> {
  for (let i = 0; i < 2_000; i += 1) {
    if (done()) return;
    await new Promise((go) => setTimeout(go, i < 200 ? 0 : 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const generation = (id: string): Generation => {
  const found = generationById(db, id);
  if (found === undefined) throw new Error(`no Generation ${id}`);
  return found;
};
const stateOf = (id: string) => generation(id).state;

function started(result: ReturnType<Pipeline["start"]>): string {
  if (!result.ok) throw new Error(result.error);
  return result.generation.id;
}

/** A Generation already in review, as if the AI had drafted its Concept. */
function inReview(accountId: string, id: string): string {
  createGeneration(db, { id, accountId, kind: "generation", idea: "an idea", state: "concept", at: Math.floor(clock.now() / 1000) });
  moveGeneration(db, id, ["concept"], "review", { concept: CONCEPT }, Math.floor(clock.now() / 1000));
  return id;
}

beforeEach(() => {
  db = openDatabase({ file: IN_MEMORY, log: () => undefined });
  clock = new FakeClock();
  playtest = new FakePlaytest();
  logged = [];
});

afterEach(async () => {
  for (const each of pipelines.splice(0)) each.stop();
});

describe("a whole Generation", () => {
  test("from idea to a ready Version, through the real Playtest: a Game of its account's, made by a Generation", async () => {
    const ada = account("ada");
    const model = new GatedModel([CONCEPT_ANSWER, WORKING_GAME]);
    const pipe = pipeline(model, childProcessRunner());
    const id = started(pipe.start(ada, "  A game where everyone taps.  "));
    await until(() => stateOf(id) === "review", "the Concept");
    expect(generation(id)).toMatchObject({ idea: "A game where everyone taps.", concept: CONCEPT, modelCalls: 1 });
    expect(pipe.place(id)).toBeUndefined();

    expect(pipe.approve(ada, id)).toEqual({ ok: true });
    await until(() => stateOf(id) === "ready" || stateOf(id) === "failed", "the Build");
    const done = generation(id);
    expect(done).toMatchObject({ state: "ready", modelCalls: 2, builds: 1, typeFixes: 0, reason: null });
    const games = gamesOwnedBy(db, ada);
    expect(games.map((game) => game.id)).toEqual([done.gameId]);
    const versions = db.prepare("SELECT id, number, made_by, state FROM versions WHERE game_id = ?").all(done.gameId);
    expect(versions).toEqual([{ id: done.versionId, number: 1, made_by: "generation", state: "ready" }]);
    expect(versionsOf(db, done.gameId ?? "")[0]?.about).toMatchObject({ title: "Tap Vote" });
    expect(stepsOf(db, id).map((step) => [step.kind, step.outcome])).toEqual([
      ["concept", "valid"],
      ["build", "answered"],
      ["playtest", "passed"],
    ]);
    // The Creator's own key, on every call.
    expect(model.calls.map((call) => call.key)).toEqual([keyOf(ada), keyOf(ada)]);
  });

  test("each call is counted and written down before it is made", async () => {
    const ada = account("ada");
    const seen: number[] = [];
    let id = "";
    const model = new GatedModel([], () => {
      seen.push(generation(id).modelCalls);
      return seen.length === 1 ? CONCEPT_ANSWER : CODE_ANSWER;
    });
    const pipe = pipeline(model);
    id = started(pipe.start(ada, "taps"));
    await until(() => stateOf(id) === "review");
    pipe.approve(ada, id);
    await until(() => stateOf(id) === "ready");
    expect(seen).toEqual([1, 2]);
  });

  test("a failed Build sends the problems back, and a play failure uses a Build", async () => {
    const ada = account("ada");
    playtest.results.push(PLAY_PROBLEM);
    const model = new GatedModel([CODE_ANSWER, CODE_ANSWER]);
    const pipe = pipeline(model);
    const id = inReview(ada, "g1");
    pipe.approve(ada, id);
    await until(() => stateOf(id) === "ready");
    expect(generation(id)).toMatchObject({ builds: 2, modelCalls: 2 });
    expect(model.calls[1]?.messages[1]?.content).toContain("- play: With 2 Players (seed 1): it never ends");
    expect(playtest.runs[0]?.options).toEqual({ expect: { phases: ["write", "vote"], scoring: true, players: { min: 2, max: 4 } } });
  });
});

describe("a failed Generation leaves no Game", () => {
  test(`every Build failing in play, ${MAX_BUILDS} times: failed, with the reason, and no Game or Version`, async () => {
    const ada = account("ada");
    playtest.results.push(...Array(MAX_BUILDS).fill(PLAY_PROBLEM));
    const pipe = pipeline(new GatedModel([], () => CODE_ANSWER));
    const id = inReview(ada, "g1");
    pipe.approve(ada, id);
    await until(() => stateOf(id) === "failed");
    expect(generation(id)).toMatchObject({ reason: `The Game still failed its check after ${MAX_BUILDS} Builds.`, gameId: null, versionId: null });
    expect(countGames(db, ada)).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM versions").get()?.["n"]).toBe(0);
  });

  test("an idea whose Concepts are all invalid", async () => {
    const ada = account("ada");
    const pipe = pipeline(new GatedModel([], () => "no Concept here"));
    const id = started(pipe.start(ada, "taps"));
    await until(() => stateOf(id) === "failed");
    expect(generation(id).reason).toMatch(/^The AI couldn't write a usable Concept in 3 tries/);
    expect(countGames(db, ada)).toBe(0);
  });

  test("the Generation's model calls, all used", async () => {
    const ada = account("ada");
    const pipe = pipeline(new GatedModel([], () => "no code here"));
    const id = inReview(ada, "g1");
    db.prepare("UPDATE generations SET model_calls = ? WHERE id = ?").run(MAX_MODEL_CALLS - 2, id);
    pipe.approve(ada, id);
    await until(() => stateOf(id) === "failed");
    expect(generation(id)).toMatchObject({ modelCalls: MAX_MODEL_CALLS, reason: "The Generation used all the model calls it may make, before the Game passed its check." });
  });
});

describe("GenAI Studio busy, down, or refusing the key", () => {
  test(`busy: waits ${UNAVAILABLE_WAITS_MS.map((ms) => ms / 1000).join(", ")} seconds, showing why and until when, then fails as unavailable`, async () => {
    const ada = account("ada");
    const model = new GatedModel([], () => ({ failure: "rateLimited" }));
    const pipe = pipeline(model);
    const id = started(pipe.start(ada, "taps"));
    for (const [n, ms] of UNAVAILABLE_WAITS_MS.entries()) {
      await until(() => generation(id).waiting !== null && model.calls.length === n + 1, `wait ${n + 1}`);
      expect(generation(id).waiting).toEqual({ why: "rateLimited", until: Math.floor((clock.now() + ms) / 1000) });
      clock.advance(ms - 1);
      await new Promise((go) => setTimeout(go, 5));
      expect(model.calls).toHaveLength(n + 1);
      clock.advance(1);
    }
    await until(() => stateOf(id) === "failed");
    expect(generation(id)).toMatchObject({ reason: REASONS.unavailable, waiting: null, modelCalls: UNAVAILABLE_WAITS_MS.length + 1 });
  });

  test("down, then back: the Generation carries on and the notice goes", async () => {
    const ada = account("ada");
    const model = new GatedModel([{ failure: "unavailable" }, CONCEPT_ANSWER]);
    const pipe = pipeline(model);
    const id = started(pipe.start(ada, "taps"));
    await until(() => generation(id).waiting?.why === "unavailable");
    clock.advance(UNAVAILABLE_WAITS_MS[0]);
    await until(() => stateOf(id) === "review");
    expect(generation(id).waiting).toBeNull();
  });

  test("a rejected key fails it at once, saying to check the key", async () => {
    const ada = account("ada");
    const model = new GatedModel([{ failure: "keyRejected" }]);
    const pipe = pipeline(model);
    const id = started(pipe.start(ada, "taps"));
    await until(() => stateOf(id) === "failed");
    expect(generation(id).reason).toBe(REASONS.keyRejected);
    expect(model.calls).toHaveLength(1);
  });

  test("a key deleted while it waits fails it, saying to save it again; no key is ever logged or put in a reason", async () => {
    const ada = account("ada");
    const pipe = pipeline(new GatedModel([CODE_ANSWER]));
    const id = inReview(ada, "g1");
    db.prepare("DELETE FROM genai_keys WHERE account_id = ?").run(ada);
    pipe.approve(ada, id);
    await until(() => stateOf(id) === "failed");
    expect(generation(id)).toMatchObject({ reason: REASONS.noKey, modelCalls: 0 });
    expect(JSON.stringify([logged, generation(id), stepsOf(db, id)])).not.toContain("sk-test");
  });
});

describe("the queue", () => {
  test("two worked on at once on the site; the rest wait, each told its place", async () => {
    const [ada, bo, cy, di] = ["ada", "bo", "cy", "di"].map(account);
    const model = new GatedModel([], () => CONCEPT_ANSWER);
    model.held = true;
    const pipe = pipeline(model);
    const ids = [ada, bo, cy, di].map((who) => started(pipe.start(who ?? "", "taps")));
    await until(() => model.waiting === 2);
    expect(ids.map((id) => pipe.place(id))).toEqual([0, 0, 1, 2]);
    model.release();
    await until(() => ids.every((id) => stateOf(id) === "review"));
  });

  test("one at a time for an account: a second it starts is refused, and one it approves waits for its first", async () => {
    const ada = account("ada");
    const model = new GatedModel([], ANSWER);
    model.held = true;
    const pipe = pipeline(model);
    const review = inReview(ada, "earlier");
    const first = started(pipe.start(ada, "taps"));
    expect(pipe.start(ada, "more taps")).toMatchObject({ ok: false, status: 409 });
    expect(pipe.approve(ada, review)).toEqual({ ok: true });
    await until(() => model.waiting === 1);
    // A slot is free, but the account's first is being worked on: its second waits.
    expect([pipe.place(first), pipe.place(review)]).toEqual([0, 1]);
    model.release();
    await until(() => stateOf(review) === "ready");
  });

  test(`${MAX_WAITING_GENERATIONS} may wait; the next is refused`, async () => {
    const model = new GatedModel([], () => CONCEPT_ANSWER);
    model.held = true;
    const pipe = pipeline(model);
    const accounts = Array.from({ length: MAX_WAITING_GENERATIONS + 3 }, (_, n) => account(`a${n}`));
    for (const who of accounts.slice(0, MAX_WAITING_GENERATIONS + 2)) started(pipe.start(who, "taps"));
    expect(pipe.start(accounts.at(-1) ?? "", "taps")).toEqual({ ok: false, status: 503, error: "The AI's line is full. Try again in a few minutes." });
    model.release();
  });

  test(`${GENERATIONS_PER_DAY} started a day, whatever became of them; a day later, more`, async () => {
    const ada = account("ada");
    const pipe = pipeline(new GatedModel([], () => ({ failure: "keyRejected" })));
    for (let n = 0; n < GENERATIONS_PER_DAY; n += 1) {
      const id = started(pipe.start(ada, `idea ${n}`));
      await until(() => stateOf(id) === "failed");
    }
    expect(pipe.start(ada, "one more")).toMatchObject({ ok: false, status: 429 });
    clock.advance(24 * 60 * 60 * 1000 + 1000);
    expect(pipe.start(ada, "one more").ok).toBe(true);
  });

  test("no key saved, an empty idea, or the most Games already: refused before anything is made", () => {
    const ada = account("ada");
    createAccount(db, { id: "nokey", email: "nokey@purdue.edu", createdAt: 1 });
    const pipe = pipeline(new GatedModel());
    expect(pipe.start("nokey", "taps")).toMatchObject({ ok: false, status: 409 });
    expect(pipe.start(ada, "   ")).toMatchObject({ ok: false, status: 400 });
    for (let n = 0; n < GAMES_PER_ACCOUNT; n += 1) db.prepare("INSERT INTO games (id, owner_id, created_at) VALUES (?, ?, 1)").run(`game-${n}`, ada);
    expect(pipe.start(ada, "taps")).toEqual({ ok: false, status: 409, error: REASONS.tooManyGames });
    expect(db.prepare("SELECT count(*) AS n FROM generations").get()?.["n"]).toBe(0);
  });

  test("the Generations' Playtests take one slot at a time, so an Upload waits behind one at most", async () => {
    const [ada, bo] = ["ada", "bo"].map(account);
    playtest.held = true;
    const pipe = pipeline(new GatedModel([], () => CODE_ANSWER));
    const ids = [inReview(ada ?? "", "g1"), inReview(bo ?? "", "g2")];
    for (const [n, id] of ids.entries()) pipe.approve([ada, bo][n] ?? "", id);
    await until(() => ids.every((id) => stateOf(id) === "playtest"));
    await new Promise((go) => setTimeout(go, 20));
    expect(playtest.running).toBe(1);
    playtest.release();
    await until(() => playtest.runs.length === 2);
    playtest.release();
    await until(() => ids.every((id) => stateOf(id) === "ready"));
    expect(playtest.most).toBe(1);
  });
});

describe("cancelling", () => {
  test("while the AI drafts the Concept: the call is given up at once, and its place freed", async () => {
    const [ada, bo] = ["ada", "bo"].map(account);
    const model = new GatedModel([], () => CONCEPT_ANSWER);
    model.held = true;
    const pipe = pipeline(model);
    const id = started(pipe.start(ada ?? "", "taps"));
    await until(() => model.waiting === 1);
    expect(pipe.cancel(ada ?? "", id)).toBe(true);
    await pipe.settled();
    expect(generation(id)).toMatchObject({ state: "cancelled", reason: REASONS.cancelled });
    expect(pipe.cancel(ada ?? "", id)).toBe(false);
    expect(pipe.cancel(bo ?? "", id)).toBe(false);
  });

  test("while waiting in line, in review, in its Build and in its Playtest: cancelled, and nothing made", async () => {
    const [ada, bo, cy, di] = ["ada", "bo", "cy", "di"].map((who) => account(who) ?? "");
    const model = new GatedModel([], () => CODE_ANSWER);
    model.held = true;
    playtest.held = true;
    const pipe = pipeline(model);
    const inBuild = inReview(ada ?? "", "build");
    pipe.approve(ada ?? "", inBuild);
    const inLine = started(pipe.start(bo ?? "", "taps"));
    const inPlaytest = inReview(cy ?? "", "playtest");
    const waiting = inReview(di ?? "", "review");
    await until(() => model.waiting === 2);
    expect(pipe.place(inLine)).toBe(0);
    // Into its Playtest: the third's call answers once the first two are cancelled.
    expect(pipe.cancel(ada ?? "", inBuild)).toBe(true);
    pipe.approve(cy ?? "", inPlaytest);
    expect(pipe.place(inPlaytest)).toBe(1);
    expect(pipe.cancel(bo ?? "", inLine)).toBe(true);
    model.release();
    await until(() => stateOf(inPlaytest) === "playtest" && playtest.running === 1);
    expect(pipe.cancel(cy ?? "", inPlaytest)).toBe(true);
    playtest.release();
    expect(pipe.cancel(di ?? "", waiting)).toBe(true);
    await pipe.settled();
    expect([inBuild, inLine, inPlaytest, waiting].map(stateOf)).toEqual(["cancelled", "cancelled", "cancelled", "cancelled"]);
    expect(db.prepare("SELECT count(*) AS n FROM games").get()?.["n"]).toBe(0);
  });

  test(`a Concept left waiting ${REVIEW_EXPIRES_MS / 86_400_000} days is cancelled`, async () => {
    const ada = account("ada");
    const id = inReview(ada, "old");
    pipeline(new GatedModel());
    clock.advance(REVIEW_EXPIRES_MS + 60 * 60 * 1000);
    expect(generation(id)).toMatchObject({ state: "cancelled", reason: REASONS.expired });
  });
});

describe("a restart carries each Generation on from the start of its stage", () => {
  test("in concept: drafted again by the next start; the cut-short step written as interrupted", async () => {
    const ada = account("ada");
    const first = new GatedModel([], () => CONCEPT_ANSWER);
    first.held = true;
    const before = pipeline(first);
    const id = started(before.start(ada, "taps"));
    await until(() => first.waiting === 1);
    // As a restart: the old pipeline's work ends where it is, mid-call.
    before.stop();
    await before.settled();
    db.prepare("UPDATE generation_steps SET ended_at = NULL, outcome = NULL").run();
    expect(stateOf(id)).toBe("concept");
    pipeline(new GatedModel([CONCEPT_ANSWER]));
    await until(() => stateOf(id) === "review");
    expect(stepsOf(db, id).map((step) => step.outcome)).toEqual(["interrupted", "valid"]);
    expect(generation(id).modelCalls).toBe(2);
  });

  test("in review: it just waits", async () => {
    const ada = account("ada");
    const id = inReview(ada, "waiting");
    const model = new GatedModel();
    const after = pipeline(model);
    await new Promise((go) => setTimeout(go, 20));
    expect([stateOf(id), after.place(id), model.calls.length]).toEqual(["review", undefined, 0]);
  });

  test("in build: asks again, with the last file and the problems its check found", async () => {
    const ada = account("ada");
    const id = inReview(ada, "g1");
    playtest.results.push({ ok: false, problems: [{ stage: "types", message: "Type 'string' is not assignable to type 'number'.", line: 3 }] });
    const first = new GatedModel([CODE_ANSWER]);
    const before = pipeline(first);
    before.approve(ada, id);
    // Back in build after its type error: stopped there, before (or during) its next call.
    await until(() => generation(id).typeFixes === 1 && stateOf(id) === "build");
    before.stop();
    await before.settled();
    const next = new GatedModel([CODE_ANSWER]);
    pipeline(next);
    await until(() => stateOf(id) === "ready");
    expect(next.calls[0]?.messages[1]?.content).toContain("- types, line 3: Type 'string' is not assignable to type 'number'.");
    expect(next.calls[0]?.messages[1]?.content).toContain("// the Game");
  });

  test("in playtest: checks the file again, without asking the model", async () => {
    const ada = account("ada");
    const id = inReview(ada, "g1");
    playtest.held = true;
    const before = pipeline(new GatedModel([CODE_ANSWER]));
    before.approve(ada, id);
    await until(() => stateOf(id) === "playtest" && playtest.running === 1);
    before.stop();
    const next = new GatedModel();
    const fresh = new FakePlaytest();
    pipeline(next, fresh);
    await until(() => stateOf(id) === "ready");
    expect(next.calls).toHaveLength(0);
    expect(fresh.runs.map((run) => run.source)).toEqual(["// the Game\n"]);
    playtest.release();
  });

  test("a row that makes no sense fails, saying why, and never stops the pipeline from starting", () => {
    const ada = account("ada");
    createGeneration(db, { id: "broken", accountId: ada, kind: "generation", idea: "x", state: "concept", at: 1 });
    db.prepare("UPDATE generations SET state = 'build', concept = '{\"not\": \"a Concept\"}', builds = 1 WHERE id = 'broken'").run();
    expect(() => pipeline(new GatedModel())).not.toThrow();
    expect(generation("broken")).toMatchObject({ state: "failed", reason: "This Generation couldn't carry on after the site restarted (its Concept can't be read). Start it again." });
  });
});
