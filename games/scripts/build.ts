/**
 * Builds each Official game into one self-contained bundle, and lists them all in games.json.
 *
 *   npm run build -w @boilergames/games      → games/dist/<id>.js and games/dist/games.json
 *
 * What a bundle is, and how one is made, is defined once, in the Playtest's package
 * (playtest/src/bundle.ts): the Official games and every Upload get the same. Each Game is a folder
 * in src/ with an index.ts whose default export is the Game; it may import only its own files and
 * the SDK's public entry.
 *
 * Every bundle is then loaded the way the Playtest loads one (in an empty context, with the SDK's
 * own checks beside it): it must set exactly the one global, to a Game whose `about` is valid and
 * whose Look is readable. The build refuses one that isn't, printing the problems: the same rule
 * the Playtest holds every Upload to.
 *
 * Node runs this file as TypeScript directly. It imports the Playtest's built dist/, so the root
 * build compiles that first (tsconfig.build.json).
 */
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleGame, harnessScript, load, SDK_IMPORT } from "@boilergames/playtest";

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

/** Builds every Official game into `outDir`, with games.json, and returns the listing. */
export async function buildOfficialGames(outDir: string): Promise<Listing[]> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  // The SDK's source, as everywhere else in the workspace (see tsconfig.base.json).
  const harness = await harnessScript("source");
  const listing: Listing[] = [];
  const refused: string[] = [];
  for (const id of await ids()) {
    const folder = join(src, id) + sep;
    const code = await bundleGame({
      root,
      // The paths in a bundle's comments are from here (games/), wherever the build is run: keep
      // it, and the bundles keep their bytes.
      fileComments: { pathsFrom: root },
      entry: join(src, id, "index.ts"),
      name: `official/${id}`,
      sdk: "source",
      folder,
      mayImport: (source, importer) => source === SDK_IMPORT || ((source.startsWith("./") || source.startsWith("../")) && resolve(importer, "..", source).startsWith(folder)),
      onlyWhat: `an Official game may import only its own files and ${SDK_IMPORT}`,
    }).catch((error: unknown) => {
      throw new Error(`${relative(root, (error as { importer?: string }).importer ?? id)}: ${(error as Error).message}`, { cause: error });
    });
    const loaded = load(code, harness);
    if (!loaded.ok) {
      refused.push(`${id}:\n${loaded.problems.map((problem) => `  ${problem.message}`).join("\n")}`);
      continue;
    }
    await writeFile(join(outDir, `${id}.js`), code);
    const { title, players, look } = loaded.about;
    listing.push({ id, title, players, ...(look === undefined ? {} : { look }) });
  }
  if (refused.length > 0) throw new Error(`These Games can't be used:\n${refused.join("\n")}`);
  await writeFile(join(outDir, "games.json"), `${JSON.stringify(listing, null, 2)}\n`);
  return listing;
}

if (import.meta.main) {
  const listing = await buildOfficialGames(join(root, "dist"));
  console.log(`Built ${listing.map((game) => game.id).join(", ")} into games/dist/`);
}
