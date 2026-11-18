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
import { HARNESS_GLOBAL } from "./harness.js";
import { LOAD_MS, RUN_MS, SEEDS } from "./limits.js";
import type { Problem } from "./problems.js";

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

export type Loaded = { readonly ok: true; readonly context: vm.Context; readonly about: About } | { readonly ok: false; readonly problems: Problem[] };

/** Loads the bundle and the harness into a new context and reads the Game's `about`. */
export function load(bundle: string, harness: string): Loaded {
  const bundleProblem = (message: string): Loaded => ({ ok: false, problems: [{ stage: "bundle", message }] });
  // Promises the Game makes run inside each call, so they count against its timeout.
  const context = vm.createContext({}, { microtaskMode: "afterEvaluate" });
  try {
    vm.runInContext(`"use strict";\n${bundle}`, context, { filename: "game.js", timeout: LOAD_MS });
  } catch (error) {
    if (isTimeout(error)) return bundleProblem(`The Game's top-level code didn't finish within ${LOAD_MS / 1000} seconds: does it loop forever?`);
    return bundleProblem(`The Game threw while loading: ${describe(context, error)}`);
  }
  const globals = Object.getOwnPropertyNames(context);
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
 */
export function playAll(context: vm.Context, about: About): Problem[] {
  /** Each problem's text, and the runs that found it, in the order first found. */
  const found = new Map<string, Run[]>();
  const note = (message: string, run: Run) => found.set(message, [...(found.get(message) ?? []), run]);
  for (const run of runsFor(about)) {
    try {
      const options = JSON.stringify({ players: run.players, seed: run.seed, leavers: run.leavers, joiners: run.joiners });
      const result = JSON.parse(String(vm.runInContext(`${HARNESS_GLOBAL}.play(${JSON.stringify(options)})`, context, { timeout: RUN_MS }))) as { problems?: unknown };
      const problems = Array.isArray(result.problems) ? result.problems : ["The simulator's result couldn't be read."];
      for (const problem of problems) note(String(problem), run);
    } catch (error) {
      if (isTimeout(error)) {
        note(`A Match didn't finish within ${RUN_MS / 1000} seconds: one of the Game's functions loops forever, or takes far too long.`, run);
        break;
      }
      note(`Playing the Game failed: ${describe(context, error)}`, run);
    }
  }
  return [...found].map(([message, runs]) => ({ stage: "play", message: `${whichRuns(runs)}: ${message}` }));
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
