/**
 * The rules a Game's file must follow, the ones the Playtest enforces, for the page that tells
 * Creators how to write a Game with any AI or by hand (/make), and for the prompt it offers.
 *
 * Every number comes from the site (/api/config), which takes them from the Playtest and the
 * Upload limits themselves: this file holds none, so the page can't quote a limit the site doesn't
 * enforce (rules.test.ts gives it unusual numbers and finds each one in the text).
 */

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

/** Where the Creator's idea goes in the prompt. */
export const IDEA_PLACEHOLDER = "[Describe your Game here: what the Players do on their phones, what the Screen shows, and how it ends.]";

/**
 * The ready-made prompt: what the Game is for, the rules, the SDK's types and a place for the
 * Creator's idea. No example Game: an example is what every Game then copies (the owner's rule for
 * the site's own AI, which holds here too).
 */
export function promptText(limits: GameLimits, sdkTypes: string): string {
  return [
    "Write a party game for BoilerGames, a site where a group plays on one shared screen (the Screen) and each Player uses their own phone (the Controller).",
    "",
    "The rules the file must follow (the site checks every one):",
    ...fileRules(limits).map((rule) => `- ${rule}`),
    "",
    "What the site does with the file:",
    ...playtestSteps(limits).map((step) => `- ${step}`),
    "",
    'Here are the SDK\'s types, everything "@boilergames/sdk/v1" offers. Use only these:',
    "",
    "```ts",
    sdkTypes.trim(),
    "```",
    "",
    "My idea for the Game:",
    IDEA_PLACEHOLDER,
    "",
    "Answer with the whole file, in one TypeScript code block.",
  ].join("\n");
}
