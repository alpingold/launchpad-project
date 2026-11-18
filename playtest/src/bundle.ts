/**
 * What "a bundle" is, defined once: the Official games' build (games/scripts/build.ts) and the
 * Playtest both make bundles here.
 *
 * A bundle is one classic script that sets one global, `BoilerGamesGame`, to the Game: the shape the
 * Game frame loads (the SDK's frame-messages.ts). It holds the Game and the SDK code it uses, and
 * nothing else. Built with Vite's library mode, readable (not minified), so a Host who wonders what
 * a Game does can read it.
 */
import { resolve, sep } from "node:path";
import { build, type Plugin } from "vite";
import { sdkConditions, type SdkForm } from "./sdk.js";

/** The global a bundle sets. The Game frame reads the same name (GAME_GLOBAL in the SDK). */
export const GAME_GLOBAL = "BoilerGamesGame";

export interface BundleOptions {
  /**
   * Vite's root. The bundle's comments name each file it holds by its path from here (such as
   * `// ../sdk/src/v1/game.ts`), so the same root gives the same bytes.
   */
  readonly root: string;
  /** The file whose default export is the Game. */
  readonly entry: string;
  /** A name for the bundle's entry, unique to it, such as `official/allotments`. */
  readonly name: string;
  /** Which form of the SDK the bundle is built with. */
  readonly sdk: SdkForm;
  /** The folder of the Game's own files. Only imports made from files in it are checked. */
  readonly folder: string;
  /**
   * Whether the Game's code may import `source`. Refused imports fail the bundle, naming the file
   * and the import. Imports inside the SDK itself aren't asked about.
   */
  readonly mayImport: (source: string, importer: string) => boolean;
  /** Says why an import was refused, for the message. */
  readonly onlyWhat: string;
  /**
   * Resolve the Game's allowed imports as if made from this file. For a Game whose file sits
   * outside the workspace (the Playtest's temp folder), where no node_modules is above it.
   */
  readonly resolveFrom?: string;
}

/** An import the Game's code may not make. */
export class RefusedImport extends Error {
  constructor(
    readonly importer: string,
    readonly source: string,
    onlyWhat: string,
  ) {
    super(`"${source}" can't be imported: ${onlyWhat}`);
  }
}

/**
 * The bundle's entry: only the Game's default export. Built from the file directly, the bundle's
 * global would be an object of all its exports (helpers its tests use), not the Game.
 */
function defaultExportOnly(name: string, entry: string, root: string): Plugin {
  const id = `virtual:${name}`;
  return {
    name: "game-entry",
    // Vite hands a library entry over as a path under the root, so both forms name it.
    resolveId: (source) => (source === id || source === resolve(root, id) ? `\0${id}` : null),
    load: (loaded) => (loaded === `\0${id}` ? `export { default } from ${JSON.stringify(entry)};` : null),
  };
}

function onlyAllowedImports(options: BundleOptions): Plugin {
  const folder = resolve(options.folder) + sep;
  return {
    name: "game-imports",
    enforce: "pre",
    resolveId(source, importer) {
      // Only the Game's own files are asked about: not the entry's re-export, not the SDK's imports.
      if (importer === undefined || !resolve(importer).startsWith(folder)) return null;
      if (!options.mayImport(source, importer)) throw new RefusedImport(importer, source, options.onlyWhat);
      return options.resolveFrom === undefined ? null : this.resolve(source, options.resolveFrom, { skipSelf: true });
    },
  };
}

/** Builds the bundle and returns its text. Throws RefusedImport for an import the Game may not make. */
export async function bundleGame(options: BundleOptions): Promise<string> {
  const entryId = `virtual:${options.name}`;
  const built = await build({
    configFile: false,
    root: options.root,
    // Nothing printed: the Playtest's runner keeps standard output for its one result.
    logLevel: "silent",
    resolve: { conditions: sdkConditions(options.sdk) },
    plugins: [defaultExportOnly(options.name, options.entry, options.root), onlyAllowedImports(options)],
    build: {
      write: false,
      minify: false,
      lib: { entry: entryId, formats: ["iife"], name: GAME_GLOBAL, fileName: () => "game.js" },
    },
  });
  const outputs = (Array.isArray(built) ? built : [built]).flatMap((output) => ("output" in output ? output.output : []));
  const chunk = outputs.find((output) => output.type === "chunk");
  if (chunk === undefined || chunk.type !== "chunk") throw new Error("Vite built no script");
  return chunk.code;
}
