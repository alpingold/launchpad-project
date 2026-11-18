/**
 * The Playtest: given a Game's source text, says whether it is a working Game, and if so hands back
 * its bundle and its `about`. The same check for an Upload now and for the AI's Games in milestone
 * 3, so it knows nothing of accounts, HTTP or the database.
 *
 * Three stages, each only if the one before passed:
 * 1. Types: strict tsc against the SDK's types and nothing else (types.ts).
 * 2. Bundle: the same bundling the Official games get (bundle.ts); it must set one global, to a Game
 *    whose `about` is valid and whose Look is readable (play.ts, load).
 * 3. Play: the simulator, with the fewest Players, the most, the most with leavers and the fewest
 *    with joiners, each on 3 seeds (play.ts, playAll).
 *
 * It runs code a stranger wrote. Nothing in this package is a wall: on the server it runs inside
 * the operating system's (Step 13).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleGame, RefusedImport } from "./bundle.js";
import { harnessScript } from "./harness.js";
import { MAX_BUNDLE_BYTES, MAX_SOURCE_BYTES } from "./limits.js";
import { load, playAll, type About } from "./play.js";
import { capped, type Problem } from "./problems.js";
import { SDK_IMPORT, sdkForm, type SdkForm } from "./sdk.js";
import { checkTypes, GAME_FILE } from "./types.js";

export type PlaytestResult =
  | { readonly ok: true; readonly bundle: string; readonly about: About; readonly sdkVersion: "v1" }
  | { readonly ok: false; readonly problems: Problem[] };

export interface PlaytestOptions {
  /** The SDK's source or its built output; whichever is there unless told (sdk.ts). */
  readonly sdk?: SdkForm;
  /**
   * For the attack script only (runner.ts, --attack-test): globals handed to the Game, such as
   * Node's `process`, so a hostile Game can try the operating system's wall directly.
   */
  readonly giveTheGame?: Readonly<Record<string, unknown>>;
}

const utf8Bytes = (text: string) => Buffer.byteLength(text, "utf8");

/** Vite's error, for a Creator: the common case said plainly, any other without its colours and frames. */
function bundleError(message: string): string {
  if (/MISSING_EXPORT/.test(message) && /"default" is not exported/.test(message)) {
    return "The file has no default export: end it with export default defineGame({ ... }).";
  }
  const plain = message.replace(/\u001b\[[0-9;]*m/g, "").split("\n").slice(0, 3).join(" ").trim();
  return `The Game couldn't be bundled: ${plain.slice(0, 500)}`;
}

export async function playtest(source: string, options: PlaytestOptions = {}): Promise<PlaytestResult> {
  const failed = (problems: Problem[]): PlaytestResult => ({ ok: false, problems: capped(problems) });
  if (utf8Bytes(source) > MAX_SOURCE_BYTES) {
    return failed([{ stage: "source", message: `The Game's source is ${Math.ceil(utf8Bytes(source) / 1024)} KB; the most it may be is ${MAX_SOURCE_BYTES / 1024} KB.` }]);
  }
  const form = sdkForm(options.sdk);
  // An empty folder of its own, for the source and tsc's settings. On the server, /tmp is private
  // to this one Playtest and gone when it ends.
  const folder = await mkdtemp(join(tmpdir(), "playtest-"));
  try {
    const typeProblems = await checkTypes(source, folder, form);
    if (typeProblems.length > 0) return failed(typeProblems);

    let bundle: string;
    try {
      bundle = await bundleGame({
        root: folder,
        // No file paths in an Upload's bundle: the same source gives the same bytes on any machine.
        fileComments: "none",
        entry: join(folder, GAME_FILE),
        name: "playtest/game",
        sdk: form,
        folder,
        mayImport: (imported) => imported === SDK_IMPORT,
        onlyWhat: `a Game may import only ${SDK_IMPORT}.`,
        // The temp folder has no node_modules above it: the SDK is found from this package.
        resolveFrom: fileURLToPath(import.meta.url),
      });
    } catch (error) {
      if (error instanceof RefusedImport) return failed([{ stage: "bundle", message: error.message }]);
      return failed([{ stage: "bundle", message: bundleError((error as Error).message) }]);
    }
    if (utf8Bytes(bundle) > MAX_BUNDLE_BYTES) {
      return failed([{ stage: "bundle", message: `The Game's bundle is ${Math.ceil(utf8Bytes(bundle) / 1024)} KB; the most it may be is ${MAX_BUNDLE_BYTES / 1024} KB.` }]);
    }

    const loaded = load(bundle, await harnessScript(form), options.giveTheGame);
    if (!loaded.ok) return failed(loaded.problems);
    const playProblems = playAll(loaded.context, loaded.about);
    if (playProblems.length > 0) return failed(playProblems);
    return { ok: true, bundle, about: loaded.about, sdkVersion: "v1" };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
