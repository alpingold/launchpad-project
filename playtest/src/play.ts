/**
 * The Playtest's bundle check and play stage: the bundle is loaded into a fresh `vm` context, must
 * set exactly one global to a Game with a valid `about`, and is then played with the simulator
 * (harness.ts) in the same context.
 *
 * A `vm` context is NOT a wall. Code in it can find its way back to Node's own objects, and a Game
 * can make its own Playtest say anything. The wall is the operating system's, around the whole
 * runner (Step 13: deploy/boilergames-playtest@.service). The context is here so that the Game
 * doesn't see Node's globals by accident, and so its time can be limited: each call into it has a
 * timeout, which is how a Game that loops forever is stopped and reported.
 */
import vm from "node:vm";
import { GAME_GLOBAL } from "./bundle.js";
import type { Expect } from "./expect.js";
import { HARNESS_GLOBAL } from "./harness.js";
import { LOAD_MS, RUN_MS, SEEDS } from "./limits.js";
import type { Problem } from "./problems.js";
import { SDK_IMPORT } from "./sdk.js";

/** The Game's `about`, as the harness checked it. */
export interface About {
  readonly title: string;
  readonly players: { readonly min: number; readonly max: number };
  readonly look?: unknown;
}

/** The most Players a Room holds (the Engine's MAX_PLAYERS): the simulator never seats more. */
const ROOM_SIZE = 16;

/** One simulated Match: how many Players start, leave and join, and the seed. */
export interface Run {
  readonly players: number;
  readonly leavers: number;
  readonly joiners: number;
  readonly seed: number;
}

/**
 * The runs a Game is played with, each on every seed: the fewest Players; the most; the most with
 * half of them leaving early; and the fewest with newcomers arriving until the Game is full (or one,
 * if the fewest is already the most). The same run is played once.
 */
export function runsFor(about: About): Run[] {
  const min = about.players.min;
  const max = Math.min(about.players.max, ROOM_SIZE);
  const kinds = [
    { players: min, leavers: 0, joiners: 0 },
    { players: max, leavers: 0, joiners: 0 },
    { players: max, leavers: Math.floor(max / 2), joiners: 0 },
    { players: min, leavers: 0, joiners: Math.min(ROOM_SIZE - min, Math.max(1, max - min)) },
  ];
  const seen = new Set<string>();
  const runs: Run[] = [];
  for (const kind of kinds) {
    for (const seed of SEEDS) {
      const run = { ...kind, seed };
      const key = JSON.stringify(run);
      if (!seen.has(key)) runs.push(run);
      seen.add(key);
    }
  }
  return runs;
}

/** "8 Players, 4 of them leaving": a run without its seed. */
function describeRun(run: Run): string {
  const parts = [`${run.players} Player${run.players === 1 ? "" : "s"}`];
  if (run.leavers > 0) parts.push(`${run.leavers} of them leaving`);
  if (run.joiners > 0) parts.push(`${run.joiners} more joining`);
  return parts.join(", ");
}

function isTimeout(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT";
}

/**
 * An error thrown inside the context, as text. Read inside the context too, with a timeout: the
 * error is the Game's object, and its `message` could be a getter that never returns.
 */
function describe(context: vm.Context, error: unknown): string {
  if (isTimeout(error)) return "it didn't finish in time";
  if (error instanceof Error) return error.message;
  try {
    context["__playtestError"] = error;
    return String(vm.runInContext("(() => { try { const e = __playtestError; return String(e && e.message !== undefined ? e.message : e); } catch { return 'an error'; } })()", context, { timeout: 100 }));
  } catch {
    return "an error";
  } finally {
    delete context["__playtestError"];
  }
}

/**
 * A `require()` the bundler couldn't see (its name worked out as the code runs) fails only when it
 * is called, with "require is not defined". Say the rule it broke, as the bundler does for the rest.
 */
function withImportRule(message: string): string {
  return /\brequire is not defined\b/.test(message) ? `${message}: a Game may import only ${SDK_IMPORT}, with import, never with require().` : message;
}

export type Loaded = { readonly ok: true; readonly context: vm.Context; readonly about: About } | { readonly ok: false; readonly problems: Problem[] };

/**
 * Loads the bundle and the harness into a new context and reads the Game's `about`. `given` is put
 * in the context first (only for the attack script: runner.ts) and isn't counted as the Game's.
 */
export function load(bundle: string, harness: string, given: Readonly<Record<string, unknown>> = {}): Loaded {
  const bundleProblem = (message: string): Loaded => ({ ok: false, problems: [{ stage: "bundle", message: withImportRule(message) }] });
  // Promises the Game makes run inside each call, so they count against its timeout.
  const context = vm.createContext({ ...given }, { microtaskMode: "afterEvaluate" });
  try {
    vm.runInContext(`"use strict";\n${bundle}`, context, { filename: "game.js", timeout: LOAD_MS });
  } catch (error) {
    if (isTimeout(error)) return bundleProblem(`The Game's top-level code didn't finish within ${LOAD_MS / 1000} seconds: does it loop forever?`);
    return bundleProblem(`The Game threw while loading: ${describe(context, error)}`);
  }
  const globals = Object.getOwnPropertyNames(context).filter((name) => !Object.hasOwn(given, name));
  if (globals.length !== 1 || globals[0] !== GAME_GLOBAL) {
    const extra = globals.filter((name) => name !== GAME_GLOBAL);
    return bundleProblem(`The Game's code sets globals of its own (${extra.join(", ")}). Keep everything inside the file: a Game's code may set nothing global.`);
  }
  try {
    vm.runInContext(harness, context, { filename: "playtest-harness.js", timeout: LOAD_MS });
    const answer = JSON.parse(String(vm.runInContext(`${HARNESS_GLOBAL}.about()`, context, { timeout: LOAD_MS }))) as { about?: About; problems?: string[] };
    if (answer.problems !== undefined) return { ok: false, problems: answer.problems.map((message) => ({ stage: "bundle", message: String(message) })) };
    if (answer.about === undefined) return bundleProblem("The Game's about couldn't be read.");
    return { ok: true, context, about: answer.about };
  } catch (error) {
    if (isTimeout(error)) return bundleProblem(`Reading the Game's about didn't finish within ${LOAD_MS / 1000} seconds: does a getter loop forever?`);
    return bundleProblem(`The Game's about couldn't be read: ${describe(context, error)}`);
  }
}

/**
 * Plays every run and says each problem once, with the runs it came from. Stops at a run that
 * doesn't finish in time: the Game is stuck in a loop, and what is left of the context can't be
 * trusted to play another.
 *
 * Given `expect` (a Game the site's AI made), it also watches each run and checks the Game against
 * its Concept (concept.ts below). Those problems are reported only when playing found none: a Game
 * that breaks would otherwise also be told that it never reached its phases.
 */
export function playAll(context: vm.Context, about: About, expect?: Expect): Problem[] {
  /** Each problem's text, and the runs that found it, in the order first found. */
  const found = new Map<string, Run[]>();
  const note = (said: string, run: Run) => {
    const message = withImportRule(said);
    found.set(message, [...(found.get(message) ?? []), run]);
  };
  const watched: { readonly run: Run; readonly notes: Watched }[] = [];
  for (const run of runsFor(about)) {
    try {
      const options = JSON.stringify({ players: run.players, seed: run.seed, leavers: run.leavers, joiners: run.joiners, ...(expect === undefined ? {} : { watch: true }) });
      const result = JSON.parse(String(vm.runInContext(`${HARNESS_GLOBAL}.play(${JSON.stringify(options)})`, context, { timeout: RUN_MS }))) as { problems?: unknown; watched?: unknown };
      const problems = Array.isArray(result.problems) ? result.problems : ["The simulator's result couldn't be read."];
      for (const problem of problems) note(String(problem), run);
      if (expect !== undefined) {
        const notes = readWatched(result.watched);
        if (notes === undefined) note("The simulator's result couldn't be read.", run);
        else watched.push({ run, notes });
      }
    } catch (error) {
      if (isTimeout(error)) {
        note(`A Match didn't finish within ${RUN_MS / 1000} seconds: one of the Game's functions loops forever, or takes far too long.`, run);
        break;
      }
      note(`Playing the Game failed: ${describe(context, error)}`, run);
    }
  }
  const played = [...found].map(([message, runs]): Problem => ({ stage: "play", message: `${whichRuns(runs)}: ${message}` }));
  if (expect === undefined || played.length > 0) return played;
  return againstConcept(expect, watched);
}

// --- A generated Game against its Concept ----------------------------------------------------------

/** What the harness noted about one run, read back as untrusted data: the Game shares its context. */
interface Watched {
  /** The phase values the state held, as text, each cut short. */
  readonly phases: readonly string[];
  /** What state.phase was when it wasn't text ("a number"), the first time. */
  readonly notText: string | null;
  /** Whether a state had no phase at all. */
  readonly noPhase: boolean;
  /** How the run's Match ended, if the Game ended it: its Players, its scores, how many winners. */
  readonly end: { readonly players: number; readonly scores: readonly number[]; readonly winners: number } | null;
}

const MAX_NOTED_PHASES = 20;
const MAX_NOTED_CHARS = 60;

function readWatched(value: unknown): Watched | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { phases, notText, noPhase, end } = value as Record<string, unknown>;
  if (!Array.isArray(phases) || phases.length > MAX_NOTED_PHASES || !phases.every((phase) => typeof phase === "string" && phase.length <= MAX_NOTED_CHARS)) return undefined;
  if (notText !== null && (typeof notText !== "string" || notText.length > 20)) return undefined;
  if (typeof noPhase !== "boolean") return undefined;
  if (end === null) return { phases, notText, noPhase, end };
  if (typeof end !== "object") return undefined;
  const { players, scores, winners } = end as Record<string, unknown>;
  if (!Number.isInteger(players) || !Array.isArray(scores) || !scores.every((score) => typeof score === "number") || !Number.isInteger(winners)) return undefined;
  return { phases, notText, noPhase, end: { players: players as number, scores: scores as number[], winners: winners as number } };
}

/** A phase value, quoted and cut short, for a problem's text. */
const quoted = (text: string) => JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text);

/**
 * Whether a finished Match told its Players apart: different scores, or some (not all) named
 * winners. A Match of one Player can't, so it only has to give a result at all, and counts only when
 * no Match had more (a Game for one Player); otherwise a Game for 1 to 4 that always ends level would
 * pass on its one-Player Matches.
 */
function scoringMoved(ends: readonly NonNullable<Watched["end"]>[]): boolean {
  const many = ends.filter((end) => end.players >= 2);
  if (many.length === 0) return ends.some((end) => end.scores.length > 0 || end.winners > 0);
  return many.some((end) => new Set(end.scores).size >= 2 || (end.winners > 0 && end.winners < end.players));
}

/**
 * The Concept's checks, once every run has played cleanly: state.phase is always one of the
 * Concept's phases and every phase is reached somewhere; with scoring, some finished Match tells its
 * Players apart.
 */
function againstConcept(expect: Expect, watched: readonly { readonly run: Run; readonly notes: Watched }[]): Problem[] {
  const ids = expect.phases.map((id) => `"${id}"`).join(", ");
  const found = new Map<string, Run[]>();
  const note = (message: string, run: Run) => found.set(message, [...(found.get(message) ?? []), run]);
  const reached = new Set<string>();
  for (const { run, notes } of watched) {
    if (notes.noPhase) note(`a state had no phase. Keep phase in the state at all times, set to one of the Concept's phases: ${ids}`, run);
    if (notes.notText !== null) note(`state.phase was ${notes.notText}, not text. It must always be one of the Concept's phases: ${ids}`, run);
    for (const phase of notes.phases) {
      if (expect.phases.includes(phase)) reached.add(phase);
      else note(`state.phase was ${quoted(phase)}, which isn't one of the Concept's phases: ${ids}`, run);
    }
  }
  const problems = [...found].map(([message, runs]): Problem => ({ stage: "play", message: `${whichRuns(runs)}: ${message}` }));
  for (const id of expect.phases) {
    if (!reached.has(id)) problems.push({ stage: "play", message: `No simulated Match ever reached the phase "${id}": state.phase was never "${id}". Every phase of the Concept must happen in a Match.` });
  }
  const ends = watched.flatMap(({ notes }) => (notes.end === null ? [] : [notes.end]));
  if (expect.scoring && ends.length > 0 && !scoringMoved(ends)) {
    problems.push({
      stage: "play",
      message: `The Concept has scoring, but every Match ended with its Players level: no scores, every score the same, and no winners named. End the Match with end: { scores } (each Player's score by id), or end: { winners }.`,
    });
  }
  return problems;
}

/** "With 8 Players, 4 of them leaving (seeds 1 and 3)" for the runs that found a problem. */
function whichRuns(runs: readonly Run[]): string {
  const byKind = new Map<string, number[]>();
  for (const run of runs) byKind.set(describeRun(run), [...(byKind.get(describeRun(run)) ?? []), run.seed]);
  const each = [...byKind].map(([kind, seeds]) => `${kind} (seed${seeds.length === 1 ? "" : "s"} ${listed(seeds)})`);
  return `With ${listed(each, "; with ", "; and with ")}`;
}

function listed(items: readonly (string | number)[], between = ", ", last = " and "): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(between)}${last}${String(items.at(-1))}`;
}
