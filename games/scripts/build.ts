/**
 * Builds each Official game into one self-contained bundle, and lists them all in games.json.
 *
 *   npm run build -w @boilergames/games      → games/dist/<id>.js and games/dist/games.json
 *
 * A bundle is one classic script that sets one global, `BoilerGamesGame`, to the Game: the shape the
 * Game frame loads (see the SDK's frame-messages.ts). It holds the Game and the SDK code it uses, and
 * nothing else. Each Game is a folder in src/ with an index.ts whose default export is the Game.
 *
 * Node runs this file as TypeScript directly. It imports nothing from the SDK: Node would get the
 * SDK's built dist/, which may not exist yet. Everything it learns about a Game, it learns from the
 * bundle itself, which is also the proof that the bundle stands alone.
 *
 * Every Game's Look must be readable (the SDK's checkLook). The build refuses one that isn't and
 * prints the problems: the same rule the Playtest will hold generated Games to. The checker is built
 * from the SDK's source by Vite, like a Game, and run the same way.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build, defaultClientConditions, type Plugin } from "vite";

/** The global a bundle sets. The Game frame reads the same name (GAME_GLOBAL in the SDK). */
const GAME_GLOBAL = "BoilerGamesGame";
/** The one thing a Game may import besides its own files: the SDK's public entry. */
const SDK = "@boilergames/sdk/v1";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "src");

/** One line of games.json: what the Lobby needs before it loads a bundle. */
export interface Listing {
  readonly id: string;
  readonly title: string;
  readonly players: { readonly min: number; readonly max: number };
  /** The Game's Look as it wrote it; the site fills the gaps. Left out if the Game set none. */
  readonly look?: unknown;
}

/** The Official games' ids: every folder in src/ with an index.ts. */
async function ids(): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (entry.isDirectory() && (await stat(join(src, entry.name, "index.ts")).catch(() => undefined)) !== undefined) found.push(entry.name);
  }
  return found.sort();
}

/**
 * The bundle's entry: only the Game's default export. Built from index.ts directly, the bundle's
 * global would be an object of all its exports (helpers its tests use), not the Game.
 */
function entry(id: string): Plugin {
  const name = `virtual:official/${id}`;
  return {
    name: "official-game-entry",
    // Vite hands a library entry over as a path under the root, so both forms name it.
    resolveId: (source) => (source === name || source === resolve(root, name) ? `\0${name}` : null),
    load: (loaded) => (loaded === `\0${name}` ? `export { default } from ${JSON.stringify(join(src, id, "index.ts"))};` : null),
  };
}

/** A module whose source is given here, for a library entry: `virtual:<name>`. */
function virtualEntry(name: string, source: string): Plugin {
  const id = `virtual:${name}`;
  return {
    name: `virtual-entry-${name}`,
    // Vite hands a library entry over as a path under the root, so both forms name it.
    resolveId: (asked) => (asked === id || asked === resolve(root, id) ? `\0${id}` : null),
    load: (loaded) => (loaded === `\0${id}` ? source : null),
  };
}

type LookCheck = (look: unknown) => { ok: true } | { ok: false; problems: string[] };

/** The SDK's checkLook, built from its source into a script and loaded in an empty context. */
async function lookChecker(): Promise<LookCheck> {
  const built = await build({
    configFile: false,
    root,
    logLevel: "warn",
    resolve: { conditions: ["@boilergames/source", ...defaultClientConditions] },
    plugins: [virtualEntry("look-checker", `export { checkLook } from "@boilergames/sdk/v1/check";`)],
    build: { write: false, minify: false, lib: { entry: "virtual:look-checker", formats: ["iife"], name: "LookChecker" } },
  });
  const outputs = (Array.isArray(built) ? built : [built]).flatMap((o) => ("output" in o ? o.output : []));
  const code = outputs.find((o) => o.type === "chunk")?.code;
  if (code === undefined) throw new Error("building the SDK's checkLook gave no script");
  const context = vm.createContext({});
  vm.runInContext(code, context);
  // The checker accepts only plain objects of its own context, so each Look goes in as JSON text and
  // the answer comes back the same way.
  return (look) => {
    context["look"] = JSON.stringify(look);
    return JSON.parse(vm.runInContext("JSON.stringify(LookChecker.checkLook(JSON.parse(look)))", context) as string) as ReturnType<LookCheck>;
  };
}

/** Refuses any import from a Game's code that isn't its own file or the SDK's public entry. */
function onlyItsOwnFilesAndTheSdk(id: string): Plugin {
  const folder = join(src, id) + sep;
  return {
    name: "official-game-imports",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer === undefined || !resolve(importer).startsWith(folder)) return null;
      if (source === SDK) return null;
      if ((source.startsWith("./") || source.startsWith("../")) && resolve(importer, "..", source).startsWith(folder)) return null;
      throw new Error(`${relative(root, importer)} imports "${source}": an Official game may import only its own files and ${SDK}`);
    },
  };
}

/**
 * Runs a built bundle in an empty context, as the frame's worker would but with nothing else
 * there: no `self`, no network, no SDK. It must load, and set exactly one global, a Game.
 */
function load(id: string, code: string): Listing {
  const context = vm.createContext({});
  vm.runInContext(`"use strict";\n${code}`, context, { filename: `${id}.js` });
  const globals = Object.getOwnPropertyNames(context);
  if (globals.length !== 1 || globals[0] !== GAME_GLOBAL) throw new Error(`${id}.js sets the globals ${JSON.stringify(globals)}; it must set only ${GAME_GLOBAL}`);
  // Copied out as JSON: the objects belong to the bundle's own context.
  const about = JSON.parse(JSON.stringify((context[GAME_GLOBAL] as { about?: unknown } | undefined)?.about ?? null)) as Partial<Listing> | null;
  if (about === null || typeof about.title !== "string" || typeof about.players?.min !== "number" || typeof about.players.max !== "number") {
    throw new Error(`${id}.js doesn't set ${GAME_GLOBAL} to a Game with a title and a Player count`);
  }
  return { id, title: about.title, players: { min: about.players.min, max: about.players.max }, ...(about.look === undefined ? {} : { look: about.look }) };
}

/** Builds every Official game into `outDir`, with games.json, and returns the listing. */
export async function buildOfficialGames(outDir: string): Promise<Listing[]> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const listing: Listing[] = [];
  const checkLook = await lookChecker();
  const unreadable: string[] = [];
  for (const id of await ids()) {
    await build({
      configFile: false,
      root,
      logLevel: "warn",
      // The SDK's TypeScript source, as everywhere else in the workspace (see tsconfig.base.json).
      resolve: { conditions: ["@boilergames/source", ...defaultClientConditions] },
      plugins: [entry(id), onlyItsOwnFilesAndTheSdk(id)],
      build: {
        outDir,
        emptyOutDir: false,
        // Readable: a Host who wonders what a Game does can read its bundle.
        minify: false,
        lib: { entry: `virtual:official/${id}`, formats: ["iife"], name: GAME_GLOBAL, fileName: () => `${id}.js` },
      },
    });
    const game = load(id, await readFile(join(outDir, `${id}.js`), "utf8"));
    if (game.look !== undefined) {
      const checked = checkLook(game.look);
      if (!checked.ok) unreadable.push(`${id}:\n${checked.problems.map((p) => `  ${p}`).join("\n")}`);
    }
    listing.push(game);
  }
  if (unreadable.length > 0) throw new Error(`These Games' Looks aren't readable:\n${unreadable.join("\n")}`);
  await writeFile(join(outDir, "games.json"), `${JSON.stringify(listing, null, 2)}\n`);
  return listing;
}

if (import.meta.main) {
  const listing = await buildOfficialGames(join(root, "dist"));
  console.log(`Built ${listing.map((game) => game.id).join(", ")} into games/dist/`);
}
