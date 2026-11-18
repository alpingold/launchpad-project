/**
 * The part of the Playtest that runs beside the Game, in the same `vm` context: it reads the Game's
 * `about` and plays it with the SDK's simulator.
 *
 * Why beside it: the SDK's checkers accept only plain objects of their own JavaScript realm (a
 * `{...}` from another context has another Object.prototype). So the simulator is built from the
 * SDK into one script, loaded into the Game's context, and asked questions in JSON text; the
 * answers come back the same way.
 */
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { sdkConditions, type SdkForm } from "./sdk.js";

/** The global the harness script sets in the Game's context. */
export const HARNESS_GLOBAL = "PlaytestHarness";

/** The harness's source: plain JavaScript over the SDK's own checks and simulator. */
const HARNESS_SOURCE = `
import { MAX_PLAYERS, simulate } from "@boilergames/sdk/v1/engine";
import { checkLook, isRecord } from "@boilergames/sdk/v1/check";

/** A Game's title: as long as the Room's messages allow (protocol, room.match.title). */
const MAX_TITLE = 60;
const REQUIRED = ["start", "onAction", "onLeave", "screen", "controller"];
const OPTIONAL = ["onTimer", "onJoin"];

/** The Game's about, checked: { about } if it can be used, or { problems }. */
export function about() {
  const game = globalThis.BoilerGamesGame;
  if (!isRecord(game)) return JSON.stringify({ problems: ["The file's default export isn't a Game: write export default defineGame({ ... })."] });
  const problems = [];
  for (const name of REQUIRED) if (typeof game[name] !== "function") problems.push("The Game has no " + name + " function.");
  for (const name of OPTIONAL) if (game[name] !== undefined && typeof game[name] !== "function") problems.push(name + " must be a function, or left out.");
  const about = game.about;
  if (!isRecord(about)) return JSON.stringify({ problems: [...problems, "The Game has no about: give it about: { title, players: { min, max } }."] });
  const title = about.title;
  if (typeof title !== "string" || title.trim() === "" || title.length > MAX_TITLE) problems.push("about.title must be text of 1 to " + MAX_TITLE + " characters.");
  const players = about.players;
  const min = isRecord(players) ? players.min : undefined;
  const max = isRecord(players) ? players.max : undefined;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || min > max) problems.push("about.players must be { min, max }, whole numbers with 1 <= min <= max.");
  else if (min > MAX_PLAYERS) problems.push("about.players.min can't be above " + MAX_PLAYERS + ", the most Players a Room holds.");
  if (about.look !== undefined) {
    const look = checkLook(about.look);
    if (!look.ok) for (const problem of look.problems) problems.push("about.look: " + problem);
  }
  if (problems.length > 0) return JSON.stringify({ problems });
  return JSON.stringify({ about: { title, players: { min, max }, ...(about.look === undefined ? {} : { look: about.look }) } });
}

/** One simulated Match: the simulator's result. */
export function play(options) {
  return JSON.stringify(simulate(globalThis.BoilerGamesGame, JSON.parse(options)));
}
`;

/** Builds the harness script from the SDK, in the same form as the Game's bundle. */
export async function harnessScript(form: SdkForm): Promise<string> {
  const id = "virtual:playtest-harness";
  const built = await build({
    configFile: false,
    // This package's folder, so the SDK is found in the node_modules above it, wherever the
    // process was started.
    root: fileURLToPath(new URL("../", import.meta.url)),
    logLevel: "silent",
    resolve: { conditions: sdkConditions(form) },
    plugins: [
      {
        name: "playtest-harness",
        resolveId: (source) => (source === id || source.endsWith(`/${id}`) ? `\0${id}` : null),
        load: (loaded) => (loaded === `\0${id}` ? HARNESS_SOURCE : null),
      },
    ],
    build: { write: false, minify: false, lib: { entry: id, formats: ["iife"], name: HARNESS_GLOBAL, fileName: () => "harness.js" } },
  });
  const outputs = (Array.isArray(built) ? built : [built]).flatMap((output) => ("output" in output ? output.output : []));
  const chunk = outputs.find((output) => output.type === "chunk");
  if (chunk === undefined || chunk.type !== "chunk") throw new Error("Vite built no harness script");
  return chunk.code;
}
