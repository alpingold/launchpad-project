/**
 * Makes the SDK's types as one text: everything a Game may import from `@boilergames/sdk/v1`, as
 * declarations. It is half of the SDK's reference text (`@boilergames/sdk/v1/reference`), which the
 * page for Creators' own AIs (/make) and the site's own AI both read.
 *
 *   npm run sdk-types -w @boilergames/client   → sdk/src/v1/reference-types.ts
 *
 * Made from the SDK's own declarations, by TypeScript's compiler, so the text can't say something
 * the SDK doesn't. It is kept in the repository as a module holding one string, so neither a build,
 * the tests nor the server as it runs need the compiler or a file of their own; a test makes it again
 * and fails if the SDK has changed since (client/src/make/sdk-types.test.ts). The script lives with
 * the client because the client's tests are where Node and the compiler are at hand.
 *
 * The SDK's public entry (sdk/src/v1/index.ts) is two files: kit.ts, which needs nothing, and
 * game.ts, which needs kit.ts. The text is kit's declarations, then game's without its import of
 * kit: one file that declares the module by itself. Anything more in the entry stops this script,
 * rather than leave something out.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SDK_V1 = fileURLToPath(new URL("../../sdk/src/v1/", import.meta.url));
/** Where the text is kept: a module of the SDK's, holding it as one string. */
export const SDK_TYPES_FILE = fileURLToPath(new URL("../../sdk/src/v1/reference-types.ts", import.meta.url));

/** What the SDK's entry must say, comments aside: the two files this script joins. */
const ENTRY = ['export * from "./game.js";', 'export type * from "./kit.js";'];

/** TypeScript's `tsc`: the typescript package's own command, run by this Node. Throws with its output if it fails. */
export function tsc(args: readonly string[], cwd: string): void {
  const require = createRequire(import.meta.url);
  const command = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  const ran = spawnSync(process.execPath, [command, ...args], { cwd, encoding: "utf8", timeout: 60_000 });
  if (ran.status !== 0) throw new Error(`tsc failed:\n${ran.stdout}${ran.stderr}`);
}

const withoutComments = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => line !== "");

export function makeSdkTypes(): string {
  const entry = withoutComments(readFileSync(join(SDK_V1, "index.ts"), "utf8"));
  if (entry.join("\n") !== ENTRY.join("\n")) throw new Error(`sdk/src/v1/index.ts exports more than game.ts and kit.ts; teach client/scripts/sdk-types.ts about it:\n${entry.join("\n")}`);
  const out = mkdtempSync(join(tmpdir(), "sdk-types-"));
  try {
    // --ignoreConfig: only these settings, whatever tsconfig.json is in the folder it runs from.
    tsc([
      "--ignoreConfig",
      join(SDK_V1, "index.ts"),
      "--declaration",
      "--emitDeclarationOnly",
      "--outDir",
      out,
      "--rootDir",
      SDK_V1,
      "--target",
      "ES2024",
      "--lib",
      "ES2024",
      "--module",
      "preserve",
      "--moduleResolution",
      "bundler",
      "--types",
      "",
      "--strict",
      "--skipLibCheck",
    ], out);
    // `export {};`, which the compiler adds to mark a file as a module, means nothing in the joined text.
    const read = (file: string) => readFileSync(join(out, file), "utf8").replace(/^export \{\};\n/gm, "");
    const kit = read("kit.d.ts");
    const game = read("game.d.ts");
    const kitImport = /^import type \{[^}]*\} from "\.\/kit\.js";\n/m;
    if (!kitImport.test(game)) throw new Error("game.d.ts no longer imports kit.js as expected; teach client/scripts/sdk-types.ts about it");
    const text = `// The SDK's types: everything a Game may import from "@boilergames/sdk/v1".\n// Made from the SDK's own declarations (client/scripts/sdk-types.ts).\n\n${kit.trim()}\n\n${game.replace(kitImport, "").trim()}\n`;
    const otherImport = /^\s*(import|export)\b[^\n]*\bfrom\s+"/m.exec(text);
    if (otherImport !== null) throw new Error(`The types still import from elsewhere: ${otherImport[0]}`);
    return text;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/**
 * The module that holds the text: one JSON string per line, joined, so a change to the SDK shows as
 * a change to the lines it touched.
 */
export function typesModule(text: string): string {
  const lines = text.split("\n").map((line) => `  ${JSON.stringify(line)},`);
  return [
    "// The SDK's types as text: half of the reference text (reference.ts). Made by client/scripts/sdk-types.ts",
    "// from the SDK's own declarations; don't edit it by hand: run `npm run sdk-types -w @boilergames/client`.",
    "export const SDK_TYPES: string = [",
    ...lines,
    '].join("\\n");',
    "",
  ].join("\n");
}

if (import.meta.main) {
  writeFileSync(SDK_TYPES_FILE, typesModule(makeSdkTypes()));
  console.log(`Wrote ${SDK_TYPES_FILE}`);
}
