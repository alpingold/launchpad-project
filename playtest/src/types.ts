/**
 * The Playtest's first stage: strict `tsc` on the Game's one file, against the SDK's types and
 * nothing else. No DOM, no Node, no other package: what isn't declared can't be used, so a Game that
 * reaches for `fetch`, `document` or `process` fails here, with its line.
 *
 * TypeScript 7's compiler is a native program, one per kind of machine, in the package
 * `@typescript/typescript-<platform>-<arch>`. The `typescript` package's own `tsc` is a Node script
 * that only starts it; the Playtest starts it directly, found the same way, and saves a second Node.
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { TYPES_MS } from "./limits.js";
import type { Problem } from "./problems.js";
import { SDK_IMPORT, sdkTypes, type SdkForm } from "./sdk.js";

/** The file name the Game's source is written to, and named by in every problem. */
export const GAME_FILE = "game.ts";

/** The strict settings every package in the workspace uses (tsconfig.base.json), for one file. */
function settings(form: SdkForm): object {
  return {
    compilerOptions: {
      target: "ES2024",
      lib: ["ES2024"],
      module: "preserve",
      moduleResolution: "bundler",
      types: [],
      strict: true,
      noUncheckedIndexedAccess: true,
      noImplicitOverride: true,
      noFallthroughCasesInSwitch: true,
      isolatedModules: true,
      verbatimModuleSyntax: true,
      skipLibCheck: true,
      noEmit: true,
      paths: { [SDK_IMPORT]: [sdkTypes(form)] },
    },
    files: [GAME_FILE],
  };
}

/** The native compiler for this machine. */
export function compilerPath(): string {
  const require = createRequire(import.meta.url);
  const name = `@typescript/typescript-${process.platform}-${process.arch}`;
  let packageJson: string;
  try {
    packageJson = require.resolve(`${name}/package.json`);
  } catch {
    throw new Error(`TypeScript's compiler for this machine (${name}) isn't installed`);
  }
  return join(dirname(packageJson), "lib", process.platform === "win32" ? "tsc.exe" : "tsc");
}

/** The end of the message for an import the type check refused, after the import's name in quotes. */
const REFUSED_IMPORT_ENDING = `can't be imported: a Game may import only ${SDK_IMPORT}.`;

/** Names a Game might reach for that it doesn't have, and why not. */
const NOT_FOR_GAMES: Readonly<Record<string, string>> = {
  fetch: "a Game has no network",
  XMLHttpRequest: "a Game has no network",
  WebSocket: "a Game has no network",
  EventSource: "a Game has no network",
  document: "a Game has no page",
  window: "a Game has no page",
  navigator: "a Game has no page",
  location: "a Game has no page",
  localStorage: "a Game keeps nothing between Matches but what it returns as its state",
  sessionStorage: "a Game keeps nothing between Matches but what it returns as its state",
  indexedDB: "a Game keeps nothing between Matches but what it returns as its state",
  process: "a Game doesn't run in Node",
  require: `a Game doesn't run in Node; it may import only ${SDK_IMPORT}, with import, never with require()`,
  Buffer: "a Game doesn't run in Node",
  setTimeout: "a Game asks for time with its Step's timer, which calls onTimer",
  setInterval: "a Game asks for time with its Step's timer, which calls onTimer",
  console: "a Game has no console; what it shows goes in its Views",
};

/**
 * tsc's words, made right for a Game. Its hints about installing Node's types or changing the
 * library would lead a Creator the wrong way, so they go, and say instead why the name is missing.
 */
function forAGame(code: number, message: string): string {
  if (code === 2307) {
    const what = /'([^']+)'/.exec(message)?.[1] ?? "That";
    return `"${what}" ${REFUSED_IMPORT_ENDING}`;
  }
  const missing = /^Cannot find name '([^']+)'\./.exec(message);
  // tsc reports an import of one of Node's own modules ("node:fs") as a missing name.
  if (missing?.[1]?.startsWith("node:") === true) return `"${missing[1]}" ${REFUSED_IMPORT_ENDING}`;
  if (missing !== null) {
    const name = missing[1] ?? "";
    const why = NOT_FOR_GAMES[name];
    return why ? `Cannot find name '${name}': ${why}.` : `Cannot find name '${name}'.`;
  }
  return message;
}

/**
 * tsc's codes for "X implicitly has an 'any' type" (a variable, a parameter, a member, a rest
 * parameter, a destructured name). Under a refused import they are noise: what the import would have
 * given is unknown, so every parameter typed by it loses its type, one line each, all caused by the
 * one import. The Official games' test file gives 3 refused imports and 4 such lines; the SDK's test
 * Game with its import uncorrected gives 1 and 17.
 */
const IMPLICIT_ANY = new Set([7005, 7006, 7008, 7019, 7031]);

/**
 * tsc's plain output: `game.ts(3,7): error TS2322: Type ...`, with any further lines indented under
 * it. If an import was refused, the refused imports come first and the "implicitly has an 'any'
 * type" lines are left out. Every other problem stays: a Creator has 10 Uploads an hour, and each
 * hidden problem would cost one more.
 */
export function parseCompilerOutput(output: string): Problem[] {
  const found: { problem: Problem; refusedImport: boolean; implicitAny: boolean }[] = [];
  for (const line of output.split(/\r?\n/)) {
    const error = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line);
    if (error !== null) {
      const [, file = "", lineNumber = "0", , code = "0", message = ""] = error;
      const inGame = file.endsWith(GAME_FILE);
      const said = inGame ? forAGame(Number(code), message) : `In the SDK's ${file}: ${message}`;
      found.push({
        problem: { stage: "types", message: said, ...(inGame ? { line: Number(lineNumber) } : {}) },
        refusedImport: inGame && said.endsWith(REFUSED_IMPORT_ENDING),
        implicitAny: IMPLICIT_ANY.has(Number(code)),
      });
    } else if (line.startsWith(" ") && line.trim() !== "" && found.length > 0) {
      // The rest of the last error: tsc indents what explains it.
      const last = found[found.length - 1];
      if (last !== undefined) last.problem = { ...last.problem, message: `${last.problem.message} ${line.trim()}` };
    } else if (/^error TS\d+: /.test(line)) {
      found.push({ problem: { stage: "types", message: line.replace(/^error TS\d+: /, "") }, refusedImport: false, implicitAny: false });
    }
  }
  if (!found.some((each) => each.refusedImport)) return found.map((each) => each.problem);
  return [...found.filter((each) => each.refusedImport), ...found.filter((each) => !each.refusedImport && !each.implicitAny)].map((each) => each.problem);
}

/**
 * A `/// <reference ...>` line could pull in the DOM's or Node's types and declare what a Game
 * doesn't have. The type check would then pass a Game that can't run, so such lines are refused.
 */
function referenceLines(source: string): Problem[] {
  const problems: Problem[] = [];
  source.split(/\r?\n/).forEach((text, index) => {
    if (/^\s*\/\/\/\s*<reference\b/.test(text)) {
      problems.push({ stage: "types", line: index + 1, message: "A Game can't use a /// <reference> line: it gets the SDK's types and nothing else." });
    }
  });
  return problems;
}

/** Writes the source and its settings into `folder` (empty, private to this Playtest) and type-checks it. */
export async function checkTypes(source: string, folder: string, form: SdkForm): Promise<Problem[]> {
  const references = referenceLines(source);
  if (references.length > 0) return references;
  await writeFile(join(folder, GAME_FILE), source);
  await writeFile(join(folder, "tsconfig.json"), JSON.stringify(settings(form), null, 2));
  const { code, output } = await run(compilerPath(), ["-p", join(folder, "tsconfig.json"), "--pretty", "false"], folder);
  if (code === 0) return [];
  const problems = parseCompilerOutput(output);
  // tsc failed without saying why in a way read above: say what it said.
  return problems.length > 0 ? problems : [{ stage: "types", message: `The type check failed: ${output.trim().slice(0, 500) || `tsc exited with ${String(code)}`}` }];
}

function run(program: string, args: string[], cwd: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: TYPES_MS, killSignal: "SIGKILL" });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code, signal) => (signal === "SIGKILL" ? reject(new Error(`tsc took longer than ${TYPES_MS / 1000} seconds`)) : resolve({ code, output })));
  });
}
