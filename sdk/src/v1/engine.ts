/**
 * The Engine: the one piece of code that runs a Match.
 *
 * It knows nothing about browsers, sockets or real time. It is called with events (a Player acted,
 * the timer ran out, the Seats changed) and returns what happened. The Host's browser, the
 * simulator and the Playtest all run this same code, so the rules of a Match have one definition.
 *
 * It trusts nothing the Game returns. Every Step and every View is checked, and anything wrong
 * ends the Match as "broken" with a problem naming the Game function and what to fix. It never
 * reads a clock and never calls `Math.random`, so the same seed and events always give the same
 * Match. It cannot stop a Game that loops forever: whoever hosts it does.
 */
import type { About, Context, MatchEnd, Player, Rng } from "./game.js";
import type { ControllerView, ScreenView } from "./kit.js";
import { offers } from "./offers.js";
import { createRng, isRngState, restoreRng, type RngState, type SeededRng } from "./rng.js";
import { checkControllerView, checkScreenView, isRecord } from "./validate.js";

/** The most Players a Match may hold, whatever the Game allows: a Room holds at most 16 Seats. */
export const MAX_PLAYERS = 16;
/** The longest the timer may be set for: 24 hours, in milliseconds. */
export const MAX_TIMER_MS = 24 * 60 * 60 * 1000;
/**
 * The largest a Game's state may be, measured as UTF-8 bytes of its JSON. It is saved in the
 * Host's browser after every event, never sent over the network. 1 MB holds a round of 16 of the
 * largest Drawings (about 32 KB each) with room to spare.
 */
export const MAX_STATE_BYTES = 1024 * 1024;
/**
 * The largest one Controller View may be, as UTF-8 bytes of its JSON. Each is sent through the
 * server to one phone, and the server takes no message over 256 KB (`MAX_MESSAGE_BYTES` in
 * protocol), so a View must fit in one message with room for its envelope. 128 KB holds three of
 * the largest Drawings, or seven or so ordinary ones.
 */
export const MAX_VIEW_BYTES = 128 * 1024;
/**
 * The largest the Screen's View may be. It is drawn in the Host's browser and never sent anywhere,
 * so it is capped like the state it is drawn from, not like a message: a Screen showing all 16
 * Players' drawings at once can need 500 KB.
 */
export const MAX_SCREEN_VIEW_BYTES = MAX_STATE_BYTES;
/** The version of the snapshot's own shape, so an old saved Match can be told apart later. */
export const SNAPSHOT_VERSION = 1;

/**
 * Any Game, whatever its State and Action types, as the Engine sees it: functions that take data
 * and return something it must check. Every `Game<State, Action>` fits this without a cast, and
 * the Engine can't lean on a Game's types, because it trusts none of what the Game returns.
 */
export interface AnyGame {
  readonly about: About;
  start(ctx: Context): unknown;
  onAction(state: unknown, player: Player, action: unknown, ctx: Context): unknown;
  onTimer?(state: unknown, ctx: Context): unknown;
  onLeave(state: unknown, player: Player, ctx: Context): unknown;
  onJoin?(state: unknown, player: Player, ctx: Context): unknown;
  screen(state: unknown, players: readonly Player[]): unknown;
  controller(state: unknown, player: Player, players: readonly Player[]): unknown;
}

/** What happened after one event. */
export type Outcome =
  /** The Match goes on. `timer`: start it (milliseconds), stop it (null), or left out: unchanged. */
  | { readonly status: "running"; readonly timer?: number | null }
  /** Nothing changed, and `why` says why. A phone may send anything, so this is normal. */
  | { readonly status: "ignored"; readonly why: string }
  | { readonly status: "ended"; readonly reason: "finished" | "tooFewPlayers"; readonly end: MatchEnd }
  /** The Game did something invalid. `problem` names the function and what was wrong. */
  | { readonly status: "broken"; readonly problem: string };

/** What every screen shows now: the Screen's View and each Player's Controller View, by Player id. */
export interface Views {
  readonly screen: ScreenView;
  readonly controllers: Readonly<Record<string, ControllerView<unknown>>>;
}

/** A Match as plain data, to save in localStorage and resume after the Screen reloads. */
export interface MatchSnapshot {
  readonly version: typeof SNAPSHOT_VERSION;
  readonly status: "running" | "ended" | "broken";
  readonly state: unknown;
  readonly rng: RngState;
  readonly players: readonly Player[];
  readonly timerRunning: boolean;
}

export interface Match {
  /** A Player used their Controller. Ignored unless their current View offers exactly this Action. */
  act(playerId: string, action: unknown): Outcome;
  /** The host's real timer ran out. Ignored if the timer isn't running. */
  timerFired(): Outcome;
  /** The Room's Seats changed. Players gone leave the Match; new ones join it if the Game takes latecomers. */
  setPlayers(players: unknown): Outcome;
  /** The Views after the last event. Unchanged once the Match is over. */
  views(): Views;
  snapshot(): MatchSnapshot;
}

/** Starting or resuming either gives a Match and the Outcome of its first Step, or says why not. */
export type Begun = { readonly ok: true; readonly match: Match; readonly outcome: Outcome } | { readonly ok: false; readonly why: string };

/** Starts a Match: checks the Players fit the Game, then calls `game.start`. */
export function startMatch(game: AnyGame, options: { readonly players: unknown; readonly seed: number }): Begun {
  const range = playerRange(game);
  if (typeof range === "string") return { ok: false, why: range };
  const players = checkPlayers(options.players);
  if (typeof players === "string") return { ok: false, why: players };
  if (players.length < range.min || players.length > range.max) {
    return { ok: false, why: `this Game needs ${range.min} to ${range.max} Players; there are ${players.length}` };
  }
  if (!Number.isSafeInteger(options.seed)) return { ok: false, why: "the seed must be a whole number" };

  const match = new EngineMatch(game, range, createRng(options.seed), players);
  return { ok: true, match, outcome: match.begin() };
}

/** Continues a saved Match. `snapshot` comes back from storage, so it is checked like anything else. */
export function resumeMatch(game: AnyGame, snapshot: unknown): Begun {
  const range = playerRange(game);
  if (typeof range === "string") return { ok: false, why: range };
  if (!isRecord(snapshot) || snapshot["version"] !== SNAPSHOT_VERSION) return { ok: false, why: "this isn't a saved Match the Engine can read" };
  if (snapshot["status"] !== "running") return { ok: false, why: "this saved Match is already over" };
  const rng = snapshot["rng"];
  if (!isRngState(rng)) return { ok: false, why: "the saved Match's random-number state is damaged" };
  const players = checkPlayers(snapshot["players"]);
  if (typeof players === "string") return { ok: false, why: `the saved Match's Players are damaged: ${players}` };
  if (players.length > range.max) return { ok: false, why: "the saved Match holds more Players than the Game allows" };
  if (typeof snapshot["timerRunning"] !== "boolean") return { ok: false, why: "the saved Match's timer is damaged" };
  const state = plainCopy(snapshot["state"], "the saved Match's state");
  if (typeof state === "string") return { ok: false, why: state };

  const match = new EngineMatch(game, range, restoreRng(rng), players, state.value, snapshot["timerRunning"]);
  return { ok: true, match, outcome: match.resume() };
}

// ---------------------------------------------------------------------------------------------

/** What applying one Step did. */
type Stop = Extract<Outcome, { status: "ended" | "broken" }>;
type Applied = { readonly kind: "ok"; readonly timer: number | null | undefined } | { readonly kind: "stop"; readonly outcome: Stop };

const NO_VIEWS: Views = { screen: { parts: [] }, controllers: {} };

class EngineMatch implements Match {
  #status: "running" | "ended" | "broken" = "running";
  #state: unknown;
  #players: Player[];
  #timerRunning: boolean;
  #views: Views = NO_VIEWS;

  constructor(
    private readonly game: AnyGame,
    private readonly range: { readonly min: number; readonly max: number },
    private readonly rng: SeededRng,
    players: readonly Player[],
    state: unknown = null,
    timerRunning = false,
  ) {
    this.#players = [...players];
    this.#state = state;
    this.#timerRunning = timerRunning;
  }

  /** Calls `start` and draws the first Views. */
  begin(): Outcome {
    const applied = this.#run("start", (ctx) => this.game.start(ctx));
    return this.#finish(applied.kind === "ok" ? applied.timer : applied.outcome);
  }

  /** Draws the Views of a resumed Match. The host restarts its own timer from the deadline it saved. */
  resume(): Outcome {
    return this.#finish(undefined);
  }

  act(playerId: string, action: unknown): Outcome {
    if (this.#status !== "running") return ignored("the Match is over");
    const player = this.#players.find((p) => p.id === playerId);
    if (player === undefined) return ignored(`${String(playerId)} isn't a Player in this Match`);
    const view = this.#views.controllers[player.id];
    if (view === undefined || !offers(view, action)) return ignored(`${player.name}'s Controller doesn't offer that action`);
    // A copy the Game can't change, made the way the phone's own copy was: through JSON.
    const copy: unknown = deepFreeze(JSON.parse(JSON.stringify(action)));
    const applied = this.#run(`onAction (for ${player.name})`, (ctx) => this.game.onAction(this.#state, frozenPlayer(player), copy, ctx));
    return this.#finish(applied.kind === "ok" ? applied.timer : applied.outcome);
  }

  timerFired(): Outcome {
    if (this.#status !== "running") return ignored("the Match is over");
    if (!this.#timerRunning) return ignored("the timer isn't running");
    this.#timerRunning = false;
    const onTimer = this.game.onTimer;
    // Caught when the timer is started, too; this guards a Match resumed from an old snapshot.
    if (onTimer === undefined) return this.#break("the Game started the timer but has no onTimer to call when it runs out");
    const applied = this.#run("onTimer", (ctx) => onTimer.call(this.game, this.#state, ctx));
    return this.#finish(applied.kind === "ok" ? applied.timer : applied.outcome);
  }

  setPlayers(list: unknown): Outcome {
    if (this.#status !== "running") return ignored("the Match is over");
    const next = checkPlayers(list);
    if (typeof next === "string") return ignored(next);
    const nextById = new Map(next.map((p) => [p.id, p]));
    let changed = false;
    let timer: number | null | undefined;

    // A renamed Player is not an event: the new name is simply used from now on.
    this.#players = this.#players.map((p) => {
      const renamed = nextById.get(p.id);
      if (renamed === undefined || renamed.name === p.name) return p;
      changed = true;
      return { id: p.id, name: renamed.name };
    });

    // Each Player gone, in order: remove them, tell the Game, and end the Match if too few are left.
    for (const gone of this.#players.filter((p) => !nextById.has(p.id))) {
      changed = true;
      this.#players = this.#players.filter((p) => p.id !== gone.id);
      const applied = this.#run(`onLeave (for ${gone.name})`, (ctx) => this.game.onLeave(this.#state, frozenPlayer(gone), ctx));
      if (applied.kind !== "ok") return this.#finish(applied.outcome);
      if (applied.timer !== undefined) timer = applied.timer;
      if (this.#players.length < this.range.min) return this.#finish({ status: "ended", reason: "tooFewPlayers", end: {} });
    }

    // Each new Player joins if the Game takes latecomers and has room; otherwise they wait for the next Match.
    const onJoin = this.game.onJoin;
    for (const newcomer of next) {
      if (this.#players.some((p) => p.id === newcomer.id)) continue;
      if (onJoin === undefined || this.#players.length >= this.range.max) continue;
      changed = true;
      this.#players = [...this.#players, newcomer];
      const applied = this.#run(`onJoin (for ${newcomer.name})`, (ctx) => onJoin.call(this.game, this.#state, frozenPlayer(newcomer), ctx));
      if (applied.kind !== "ok") return this.#finish(applied.outcome);
      if (applied.timer !== undefined) timer = applied.timer;
    }

    if (!changed) return ignored("nothing changed for the Players in this Match");
    return this.#finish(timer);
  }

  views(): Views {
    return this.#views;
  }

  snapshot(): MatchSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      status: this.#status,
      state: this.#state,
      rng: this.rng.state(),
      players: this.#players.map((p) => ({ id: p.id, name: p.name })),
      timerRunning: this.#timerRunning,
    };
  }

  // -------------------------------------------------------------------------------------------

  /**
   * Calls one Game logic function and applies the Step it returns. The function gets its own
   * `ctx`, whose `rng` stops working once it returns: a Game that kept it and used it later (in a
   * view function, say) would make a resumed Match differ from the original.
   */
  #run(label: string, call: (ctx: Context) => unknown): Applied {
    let live = true;
    const use = <T>(f: () => T): T => {
      if (!live) throw new Error("ctx.rng was used after the function it was given to had returned; use it only during that call");
      return f();
    };
    const rng: Rng = Object.freeze({
      next: () => use(() => this.rng.next()),
      int: (min: number, max: number) => use(() => this.rng.int(min, max)),
      pick: <T>(items: readonly T[]) => use(() => this.rng.pick(items)),
      shuffle: <T>(items: readonly T[]) => use(() => this.rng.shuffle(items)),
    });
    const ctx: Context = Object.freeze({ players: this.#frozenPlayers(), rng });

    let step: unknown;
    try {
      step = call(ctx);
    } catch (error) {
      return stop(this.#break(`${label} threw ${describeError(error)}`));
    } finally {
      live = false;
    }
    return this.#apply(label, step);
  }

  /** Checks a Step and, if it is valid, makes it the Match's new state. */
  #apply(label: string, step: unknown): Applied {
    if (!isRecord(step)) return stop(this.#break(`${label} must return a Step: { state, timer?, end? }. It returned ${describeValue(step)}`));
    for (const key of Object.keys(step)) {
      if (key !== "state" && key !== "timer" && key !== "end") return stop(this.#break(`${label} returned a Step with an unknown field "${key}"; a Step is { state, timer?, end? }`));
    }
    if (!Object.hasOwn(step, "state")) return stop(this.#break(`${label} returned a Step with no "state"; return { state } even when nothing changed`));

    const timer = step["timer"];
    if (timer !== undefined && timer !== null) {
      if (typeof timer !== "number" || !Number.isFinite(timer) || timer < 0 || timer > MAX_TIMER_MS) {
        return stop(this.#break(`${label} returned timer ${describeValue(timer)}; it must be milliseconds from 0 to ${MAX_TIMER_MS} (24 hours), null to stop the timer, or left out`));
      }
      if (this.game.onTimer === undefined) return stop(this.#break(`${label} started the timer, but the Game has no onTimer to call when it runs out`));
    }

    const state = plainCopy(step["state"], `${label}'s state`);
    if (typeof state === "string") return stop(this.#break(state));

    const end = step["end"];
    if (end !== undefined) {
      const problem = endProblem(end, new Set(this.#players.map((p) => p.id)));
      if (problem !== null) return stop(this.#break(`${label} returned an end that isn't valid: ${problem}`));
    }

    this.#state = state.value;
    if (timer === null) this.#timerRunning = false;
    if (typeof timer === "number") this.#timerRunning = true;
    if (end !== undefined) {
      const copy = deepFreeze(JSON.parse(JSON.stringify(end)) as MatchEnd);
      return stop({ status: "ended", reason: "finished", end: copy });
    }
    return { kind: "ok", timer: timer as number | null | undefined };
  }

  /**
   * After an event: if the Match goes on, draws and checks every View and reports the timer change;
   * if it ended or broke, records that. Views are built once per event, after all its Steps.
   */
  #finish(result: number | null | undefined | Stop): Outcome {
    if (typeof result === "object" && result !== null) {
      if (result.status === "ended") this.#status = "ended";
      return result;
    }
    const drawn = this.#draw();
    if (typeof drawn === "string") return this.#break(drawn);
    this.#views = drawn;
    return result === undefined ? { status: "running" } : { status: "running", timer: result };
  }

  /** Calls `screen` and `controller` for every Player and checks what they return, or says what's wrong. */
  #draw(): Views | string {
    const players = this.#frozenPlayers();
    let screen: unknown;
    try {
      screen = this.game.screen(this.#state, players);
    } catch (error) {
      return `screen threw ${describeError(error)}`;
    }
    const screenCheck = checkScreenView(screen);
    if (!screenCheck.ok) return `screen returned a View the site can't show: ${screenCheck.problems.join("; ")}`;
    const screenCopy = sizedCopy(screenCheck.view, MAX_SCREEN_VIEW_BYTES, "screen returned a View", "screen");
    if (typeof screenCopy === "string") return screenCopy;

    const controllers: Record<string, ControllerView<unknown>> = {};
    for (const player of players) {
      let view: unknown;
      try {
        view = this.game.controller(this.#state, player, players);
      } catch (error) {
        return `controller (for ${player.name}) threw ${describeError(error)}`;
      }
      const check = checkControllerView(view);
      if (!check.ok) return `controller (for ${player.name}) returned a View the site can't show: ${check.problems.join("; ")}`;
      const copy = sizedCopy(check.view, MAX_VIEW_BYTES, `controller (for ${player.name}) returned a View`, `controller (for ${player.name})`);
      if (typeof copy === "string") return copy;
      controllers[player.id] = copy;
    }
    return { screen: screenCopy, controllers };
  }

  #break(problem: string): Stop {
    this.#status = "broken";
    return { status: "broken", problem };
  }

  /** The Engine's own list, as a fresh frozen copy: a Game can read it but never change the real one. */
  #frozenPlayers(): readonly Player[] {
    return Object.freeze(this.#players.map(frozenPlayer));
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers

function stop(outcome: Stop): Applied {
  return { kind: "stop", outcome };
}

function ignored(why: string): Outcome {
  return { status: "ignored", why };
}

function frozenPlayer(p: Player): Player {
  return Object.freeze({ id: p.id, name: p.name });
}

/** The Game's `about.players`, capped at {@link MAX_PLAYERS}, or why it can't be used. */
function playerRange(game: AnyGame): { min: number; max: number } | string {
  const range: unknown = isRecord(game) && isRecord(game.about) ? game.about["players"] : undefined;
  if (!isRecord(range)) return "the Game's about.players is missing";
  const { min, max } = range;
  if (!Number.isInteger(min) || !Number.isInteger(max) || (min as number) < 1 || (min as number) > (max as number)) {
    return "the Game's about.players must be whole numbers with 1 <= min <= max";
  }
  if ((min as number) > MAX_PLAYERS) return `the Game's about.players.min is above the site's ${MAX_PLAYERS}`;
  return { min: min as number, max: Math.min(max as number, MAX_PLAYERS) };
}

/**
 * Why `end` isn't a valid MatchEnd, or null if it is. Scores and winners must name Players in the
 * Match. Also used by the Screen, which can't trust an end that comes out of the Game frame.
 */
export function endProblem(end: unknown, ids: ReadonlySet<string>): string | null {
  if (!isRecord(end)) return "it must be an object: { scores?, winners? }";
  for (const key of Object.keys(end)) if (key !== "scores" && key !== "winners") return `it has an unknown field "${key}"; an end is { scores?, winners? }`;
  const scores = end["scores"];
  if (scores !== undefined) {
    if (!isRecord(scores)) return "scores must be an object of numbers by Player id";
    for (const [id, score] of Object.entries(scores)) {
      if (!ids.has(id)) return `scores has "${id}", which isn't a Player in the Match`;
      if (typeof score !== "number" || !Number.isFinite(score)) return `the score for "${id}" must be a finite number`;
    }
  }
  const winners = end["winners"];
  if (winners !== undefined) {
    if (!Array.isArray(winners)) return "winners must be a list of Player ids";
    const seen = new Set<unknown>();
    for (const id of winners) {
      if (typeof id !== "string" || !ids.has(id)) return `winners has ${describeValue(id)}, which isn't a Player in the Match`;
      if (seen.has(id)) return `winners has "${id}" twice`;
      seen.add(id);
    }
  }
  return null;
}

/** A list of Players as the host sends it: `{ id, name }` each, ids unique. Returns why not, if not. */
export function checkPlayers(value: unknown): Player[] | string {
  if (!Array.isArray(value)) return "the Players must be a list";
  if (value.length > MAX_PLAYERS) return `a Match holds at most ${MAX_PLAYERS} Players`;
  const players: Player[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item["id"] !== "string" || item["id"] === "" || typeof item["name"] !== "string") {
      return "each Player must be { id, name } with a non-empty id";
    }
    if (ids.has(item["id"])) return `two Players have the id "${item["id"]}"`;
    ids.add(item["id"]);
    players.push({ id: item["id"], name: item["name"] });
  }
  return players;
}

/**
 * A frozen copy of `value` made through JSON, if JSON keeps it whole (an object field set to
 * `undefined` is simply dropped, as JSON drops it) and it fits within
 * {@link MAX_STATE_BYTES}; otherwise what's wrong with it, starting with `what`. Keeping the copy,
 * not the original, means a live Match and one resumed from a save run on exactly the same data.
 */
function plainCopy(value: unknown, what: string): { value: unknown } | string {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    // JSON.stringify throws a TypeError on a bigint or a cycle, and a RangeError when nesting
    // overflows the stack. Look for something nameable first (the walk itself overflows on a cycle).
    try {
      const problem = jsonProblem(value, "state");
      if (problem !== null) return `${what} must be plain data that JSON keeps whole, but ${problem}`;
    } catch {
      // A cycle or deep nesting: said below.
    }
    if (error instanceof TypeError) return `${what} refers to itself (an object inside it contains it), which JSON can't save`;
    if (error instanceof RangeError) return `${what} is nested too deeply to save as JSON`;
    return `${what} could not be saved as JSON: ${describeError(error)}`;
  }
  try {
    const problem = jsonProblem(value, "state");
    if (problem !== null) return `${what} must be plain data that JSON keeps whole, but ${problem}`;
    const bytes = utf8Length(json);
    if (bytes > MAX_STATE_BYTES) {
      return `${what} is ${Math.ceil(bytes / 1024)} KB as JSON; the most is ${MAX_STATE_BYTES / 1024} KB. Keep less in the state`;
    }
    return { value: deepFreeze(JSON.parse(json)) };
  } catch (error) {
    // The walk above recursing too deep for the stack, or a getter that throws on a second read.
    return `${what} could not be saved as JSON: ${describeError(error)}`;
  }
}

/** Where `value` holds something JSON would drop or change, or null if nowhere. */
function jsonProblem(value: unknown, path: string): string | null {
  switch (typeof value) {
    case "string":
    case "boolean":
      return null;
    case "number":
      return Number.isFinite(value) ? null : `${path} is ${String(value)}, which JSON turns into null`;
    case "undefined":
      // An object's field set to undefined never reaches here (see below). This is the state
      // itself, or an item in a list, which JSON would turn into null.
      return `${path} is undefined; use null instead`;
    case "function":
      return `${path} is a function`;
    case "bigint":
    case "symbol":
      return `${path} is a ${typeof value}`;
  }
  if (value === null) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) return `${path}[${i}] is an empty slot, which JSON turns into null`;
      const problem = jsonProblem(value[i], `${path}[${i}]`);
      if (problem !== null) return problem;
    }
    return null;
  }
  // Every primitive returned above; TypeScript can't follow the switch on typeof, hence the cast.
  if (!isRecord(value)) return `${path} is a ${kindOf(value as object)}, not a plain object`;
  for (const key of Object.keys(value)) {
    // `{ ...state, winner: undefined }` is ordinary TypeScript. JSON drops the field, and the Engine
    // keeps only its JSON copy, so a live Match and a resumed one both see it gone: nothing to refuse.
    if (value[key] === undefined) continue;
    const problem = jsonProblem(value[key], `${path}.${key}`);
    if (problem !== null) return problem;
  }
  return null;
}

/** "Set", "Map", "Date", or a class's own name: what kind of object something is, for a problem message. */
function kindOf(value: object): string {
  try {
    const name: unknown = (Object.getPrototypeOf(value) as { constructor?: { name?: unknown } } | null)?.constructor?.name;
    if (typeof name === "string" && name !== "" && name !== "Object") return name;
    return Object.prototype.toString.call(value).slice(8, -1);
  } catch {
    return "special object";
  }
}

/** UTF-8 bytes of a string, counted by hand: the SDK has no TextEncoder (it targets no platform). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4; // a surrogate pair: one character outside the Basic Multilingual Plane
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * A frozen plain copy of a checked View, so the Game can't change it after it was checked, or why
 * it is too big: `what` starts the problem, which names the function and the Player.
 */
function sizedCopy<T>(view: T, limit: number, what: string, fn: string): T | string {
  try {
    const json = JSON.stringify(view);
    const bytes = utf8Length(json);
    if (bytes > limit) return `${what} of ${Math.ceil(bytes / 1024)} KB as JSON; the most is ${limit / 1024} KB. Show less at once`;
    return deepFreeze(JSON.parse(json) as T);
  } catch (error) {
    // Only a View that reads differently the second time (a getter) can get here: it passed the check.
    return `${fn} returned a View that changed while it was being read: ${describeError(error)}. Return plain objects`;
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function describeError(error: unknown): string {
  try {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : `${describeValue(error)}`;
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  } catch {
    return "something that couldn't be read";
  }
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return isRecord(value) ? "an object" : `a ${kindOf(value)}`;
  if (typeof value === "string") return JSON.stringify(value.length > 60 ? `${value.slice(0, 60)}...` : value);
  return String(value);
}
