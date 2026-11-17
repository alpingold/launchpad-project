/**
 * The messages between the Screen page and the Game frame, and between the frame and the worker
 * inside it, where the Engine and the Game run.
 *
 * The Screen sends one message at a time and the frame answers each with exactly one reply. The
 * frame and its worker are the Game's territory: the Game's code shares the worker's global scope
 * with the Engine, so it can patch built-ins or post a made-up reply. So the Screen reads every
 * reply with {@link readFrameReply}, which trusts nothing in it, rather than casting it to a type.
 */
import { endProblem, MAX_SCREEN_VIEW_BYTES, MAX_STATE_BYTES, MAX_TIMER_MS, MAX_VIEW_BYTES, checkPlayers, utf8Length, type MatchSnapshot, type Outcome, type Views } from "./engine.js";
import type { ControllerView, Player, ScreenView } from "./index.js";
import { checkControllerView, checkScreenView, isRecord } from "./validate.js";

/** A Game bundle is one classic script that assigns its Game to this global: `var BoilerGamesGame = ...`. */
export const GAME_GLOBAL = "BoilerGamesGame";

/** How long the frame has to answer a message before the Screen gives up on it and the Match is broken. */
export const FRAME_REPLY_MS = 2_000;

/** What the Screen sends the frame. */
export type ToFrame =
  | { readonly type: "start"; readonly bundle: string; readonly players: readonly Player[]; readonly seed: number }
  | { readonly type: "resume"; readonly bundle: string; readonly snapshot: unknown }
  | { readonly type: "act"; readonly playerId: string; readonly action: unknown }
  | { readonly type: "timerFired" }
  | { readonly type: "setPlayers"; readonly players: readonly Player[] };

/** One reply per message the frame gets. */
export type FrameReply =
  | { readonly type: "result"; readonly outcome: Outcome; readonly views: Views; readonly snapshot: MatchSnapshot }
  /** Only to `start` or `resume`: the Engine wouldn't begin, or the Game's code didn't load. */
  | { readonly type: "couldNotStart"; readonly why: string };

/** What the frame sends: `ready` once, when its page has loaded, then the replies. */
export type FromFrame = { readonly type: "ready" } | FrameReply;

/** The longest `why` or `problem` the Screen keeps; longer text is cut, since it is only shown. */
export const MAX_REASON_LENGTH = 5_000;

/**
 * Reads a reply that came out of the frame. `known` is every Player id the Screen has given the
 * frame; the Players in the Match must be among them. Returns the reply, or what was wrong with it.
 */
export function readFrameReply(data: unknown, known: ReadonlySet<string>): { readonly ok: true; readonly reply: FrameReply } | { readonly ok: false; readonly problem: string } {
  const fail = (problem: string) => ({ ok: false, problem }) as const;
  if (!isRecord(data)) return fail("the reply isn't an object");
  if (data["type"] === "couldNotStart") {
    if (typeof data["why"] !== "string") return fail("couldNotStart has no why");
    return { ok: true, reply: { type: "couldNotStart", why: cut(data["why"]) } };
  }
  if (data["type"] !== "result") return fail(`the reply's type is ${JSON.stringify(String(data["type"]))}`);

  const snapshot = readSnapshot(data["snapshot"], known);
  if (typeof snapshot === "string") return fail(`the snapshot ${snapshot}`);
  const ids = new Set(snapshot.players.map((p) => p.id));
  const outcome = readOutcome(data["outcome"], ids);
  if (typeof outcome === "string") return fail(`the outcome ${outcome}`);
  // Views are checked against every Player the Screen has sent, not only those still in the Match:
  // once a Match ends, its Views stay the last ones drawn, which can include a Player who just left.
  const views = readViews(data["views"], known);
  if (typeof views === "string") return fail(`the views ${views}`);
  return { ok: true, reply: { type: "result", outcome, views, snapshot } };
}

function cut(text: string): string {
  return text.length > MAX_REASON_LENGTH ? `${text.slice(0, MAX_REASON_LENGTH)}...` : text;
}

function readOutcome(value: unknown, ids: ReadonlySet<string>): Outcome | string {
  if (!isRecord(value)) return "isn't an object";
  switch (value["status"]) {
    case "running": {
      const timer = value["timer"];
      if (timer === undefined) return { status: "running" };
      if (timer === null) return { status: "running", timer: null };
      if (typeof timer !== "number" || !Number.isFinite(timer) || timer < 0 || timer > MAX_TIMER_MS) return "has a timer that isn't 0 to 24 hours, null or left out";
      return { status: "running", timer };
    }
    case "ignored":
      return typeof value["why"] === "string" ? { status: "ignored", why: cut(value["why"]) } : "is ignored without a why";
    case "ended": {
      const reason = value["reason"];
      if (reason !== "finished" && reason !== "tooFewPlayers") return "ended for no known reason";
      const problem = endProblem(value["end"], ids);
      if (problem !== null) return `has an end that isn't valid: ${problem}`;
      return { status: "ended", reason, end: value["end"] as Extract<Outcome, { status: "ended" }>["end"] };
    }
    case "broken":
      return typeof value["problem"] === "string" ? { status: "broken", problem: cut(value["problem"]) } : "is broken without a problem";
    default:
      return "has no known status";
  }
}

function readSnapshot(value: unknown, known: ReadonlySet<string>): MatchSnapshot | string {
  if (!isRecord(value)) return "isn't an object";
  const players = checkPlayers(value["players"]);
  if (typeof players === "string") return `has Players that aren't valid: ${players}`;
  for (const p of players) if (!known.has(p.id)) return `has a Player the Screen never sent: ${JSON.stringify(p.id)}`;
  const status = value["status"];
  if (status !== "running" && status !== "ended" && status !== "broken") return "has no known status";
  if (typeof value["timerRunning"] !== "boolean") return "has no timerRunning";
  // The state is the Game's own business, but it is saved in localStorage, so its size matters.
  // Checked against twice the state limit: the snapshot is the state plus a little, and a reply
  // only needs to be refused when it is clearly too big, not measured to the byte.
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return "can't be saved as JSON";
  }
  if (json === undefined || utf8Length(json) > 2 * MAX_STATE_BYTES) return "is too big to save";
  // The rng and version are checked by the Engine when the snapshot is resumed.
  return value as unknown as MatchSnapshot;
}

function readViews(value: unknown, ids: ReadonlySet<string>): Views | string {
  if (!isRecord(value)) return "aren't an object";
  const screen = checkScreenView(value["screen"]);
  if (!screen.ok) return `have a Screen View that isn't valid: ${screen.problems.join("; ")}`;
  if (tooBig(screen.view, MAX_SCREEN_VIEW_BYTES)) return "have a Screen View that is too big";
  const controllers = value["controllers"];
  if (!isRecord(controllers)) return "have no controllers";
  const checked: Record<string, ControllerView<unknown>> = {};
  for (const [id, view] of Object.entries(controllers)) {
    if (!ids.has(id)) return `have a View for ${JSON.stringify(id)}, a Player the Screen never sent`;
    const result = checkControllerView(view);
    if (!result.ok) return `have a View for ${JSON.stringify(id)} that isn't valid: ${result.problems.join("; ")}`;
    if (tooBig(result.view, MAX_VIEW_BYTES)) return `have a View for ${JSON.stringify(id)} that is too big`;
    checked[id] = result.view;
  }
  return { screen: screen.view as ScreenView, controllers: checked };
}

function tooBig(view: unknown, limit: number): boolean {
  return utf8Length(JSON.stringify(view)) > limit;
}
