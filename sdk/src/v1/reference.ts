/**
 * The reference text: the rules a Game's file must follow (the ones the Playtest enforces) and the
 * SDK's types as text. One home for both, so the page for Creators' own AIs (/make, in `client`) and
 * the site's own AI's Build prompt (in `server`) can never disagree.
 *
 *   import { fileRules, playtestSteps, SDK_TYPES } from "@boilergames/sdk/v1/reference";
 *
 * Text only: nothing here runs in a Game, and a Game can't import it (the Playtest lets a Game
 * import `@boilergames/sdk/v1` and nothing else). Every number comes from the caller, which takes it
 * from the Playtest's and the site's own limits (/api/config on a page, GAME_LIMITS on the server):
 * this file holds none, so the text can't quote a limit the site doesn't enforce.
 */
export { SDK_TYPES } from "./reference-types.js";

/** The limits a Game is held to, as /api/config gives them (server/src/games.ts, GAME_LIMITS). */
export interface GameLimits {
  readonly maxSourceBytes: number;
  readonly maxBundleBytes: number;
  readonly loadMs: number;
  readonly runMs: number;
  readonly seeds: number;
  readonly uploadsPerHour: number;
  readonly uploadsPerDay: number;
}

const kb = (bytes: number) => `${Math.floor(bytes / 1024)} KB`;
const seconds = (ms: number) => `${ms / 1000} ${ms === 1000 ? "second" : "seconds"}`;

/** What the file must be. Each is one sentence. */
export function fileRules(limits: GameLimits): string[] {
  return [
    "A Game is one TypeScript file (.ts).",
    'Its only import is "@boilergames/sdk/v1", with import, never require(). It can\'t import other files, packages or Node\'s modules.',
    "It ends with export default defineGame({ ... }), the Game itself: its about, start, onAction, onLeave, screen and controller (onTimer and onJoin if it uses them).",
    `The file is at most ${kb(limits.maxSourceBytes)}, and its bundle (the file with the SDK code it uses) at most ${kb(limits.maxBundleBytes)}.`,
    "It uses only the SDK's types and the language itself: there is no page, network, console, timer (setTimeout) or storage. A Game asks for time with its Step's timer, and for randomness with ctx.rng.",
    "No /// <reference> lines, and no globals of its own: everything stays inside the file.",
    "Its state and its Actions are plain data (JSON): no functions, Maps, Sets, Dates or classes.",
  ];
}

/** What the Playtest does with the file, in order. Each is one sentence. */
export function playtestSteps(limits: GameLimits): string[] {
  return [
    "It type-checks the file with strict TypeScript against the SDK's types and nothing else. Every problem it finds is reported with its line.",
    `It bundles the file, loads it (its top-level code must finish within ${seconds(limits.loadMs)}) and reads its about: the title, the Player count and the Look, whose colours must be readable.`,
    `It plays simulated Matches to their end: with the fewest Players, with the most, with the most and half of them leaving, and with the fewest and more joining, each with ${limits.seeds} different random seeds. Each Match must finish within ${seconds(limits.runMs)}, every Player must be offered something to do, and the Match must end.`,
    `If anything fails, the Version is marked failed, with every problem found. You can upload ${limits.uploadsPerHour} times an hour and ${limits.uploadsPerDay} times a day, so fix all you can before uploading again.`,
  ];
}
