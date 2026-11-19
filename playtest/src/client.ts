/**
 * How the site asks for a Playtest: `run(source)`, behind one interface with two ways to start the
 * runner (runner.ts):
 *
 * - a child process: development and tests. NO WALL: the Game's code runs as the site's own user,
 *   with the site's network and files. Never used in production (the server's config.ts).
 * - a connection to the Unix socket systemd listens on (PLAYTEST_SOCKET): systemd starts a fresh
 *   runner for each connection, inside the wall of deploy/boilergames-playtest@.service.
 *
 * This file is what the site's process loads: Node's own modules, Zod and the SDK's checks. Not
 * the Playtest itself, nor TypeScript or Vite.
 *
 * The site trusts nothing that comes back. The runner ran a stranger's code, and that code could
 * have made it write anything. So the result is read only up to a size, parsed with a schema, held
 * to the Playtest's limits, its Look checked again, and the site gives up after its own timeout.
 *
 * What a forged result could gain, at most:
 * - A forged "failed" fails the forger's own Upload. Nobody else's.
 * - A forged "ready" gets a Version marked ready with a bundle that never passed the checks. That
 *   bundle only ever runs inside the Game frame, which is a wall of its own (ADR 0004): no network,
 *   no storage, no site. The Screen checks every View, Step and end that comes out of it, as for any
 *   Game. Players see a broken Game, which they could also get from an honest Upload of a Game that
 *   is merely bad at being fun.
 * - Its `about` is held to the same rules as an honest one: a title of 1 to 60 characters, a Player
 *   count, a Look that passes checkLook. It can't put anything on a page that an honest Upload can't.
 */
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { checkLook } from "@boilergames/sdk/v1/check";
import { z } from "zod";
import type { Expect } from "./expect.js";
import { MAX_BUNDLE_BYTES, MAX_PROBLEM_CHARS, MAX_PROBLEMS } from "./limits.js";
import type { PlaytestResult } from "./playtest.js";
import type { Problem } from "./problems.js";

/** The largest source a Playtest takes: the site refuses a larger one before it is queued. */
export { MAX_SOURCE_BYTES } from "./limits.js";
/** What the site's page for Creators (/make) quotes, through /api/config: the Playtest's own numbers. */
export { LOAD_MS, MAX_BUNDLE_BYTES, RUN_MS, SEEDS } from "./limits.js";

/** The runner program, built: playtest/dist/runner.js. The same path from src/ and from dist/. */
export const RUNNER = fileURLToPath(new URL("../dist/runner.js", import.meta.url));

/** How long the site waits for a Playtest, start to finish: a little longer than the service's RuntimeMaxSec (60 s). */
export const PLAYTEST_TIMEOUT_MS = 65_000;

/** The most the site reads back: the largest bundle, written as JSON (which can double it), and room for the rest. */
export const MAX_RESULT_BYTES = MAX_BUNDLE_BYTES * 2 + 256 * 1024;

/** What the Creator is told when the check itself failed, not their Game. The logs get the detail. */
export const CHECK_FAILED = "The check itself failed, not your Game. Try again in a minute.";

/** A Playtest's result, or word that the check itself failed (try again: say nothing about the Game). */
export type RunResult = PlaytestResult | { readonly ok: false; readonly checkFailed: true; readonly problems: readonly [Problem] };

export type { Expect } from "./expect.js";
export { readExpect } from "./expect.js";

export interface RunOptions {
  /** For a Game the site's AI made: the Concept it must match. Never for an Upload. */
  readonly expect?: Expect;
}

export interface PlaytestRunner {
  run(source: string, options?: RunOptions): Promise<RunResult>;
}

const utf8Bytes = (text: string) => Buffer.byteLength(text, "utf8");

const problem = z.strictObject({
  stage: z.enum(["source", "types", "bundle", "play"]),
  message: z.string().min(1).max(MAX_PROBLEM_CHARS),
  line: z.number().int().min(1).optional(),
});

/** What an honest runner writes; a dishonest one is held to the same. */
const result = z.union([
  z.strictObject({
    ok: z.literal(true),
    bundle: z
      .string()
      .min(1)
      .refine((bundle) => utf8Bytes(bundle) <= MAX_BUNDLE_BYTES, "the bundle is over the size"),
    about: z.strictObject({
      title: z.string().min(1).max(60),
      players: z.strictObject({ min: z.number().int().min(1).max(16), max: z.number().int().min(1) }).refine((p) => p.min <= p.max, "min is above max"),
      look: z.unknown().optional(),
    }),
    sdkVersion: z.literal("v1"),
  }),
  z.strictObject({ ok: z.literal(false), problems: z.array(problem).min(1).max(MAX_PROBLEMS) }),
]);

/** The runner's output, read as a result if it is one; why not if it isn't. */
export function readResult(output: string): { readonly ok: true; readonly result: PlaytestResult } | { readonly ok: false; readonly why: string } {
  let json: unknown;
  try {
    json = JSON.parse(output);
  } catch {
    return { ok: false, why: `the runner wrote something that isn't JSON (${utf8Bytes(output)} bytes)` };
  }
  const parsed = result.safeParse(json);
  if (!parsed.success) return { ok: false, why: `the runner's result doesn't fit the schema: ${parsed.error.issues[0]?.message ?? "?"}` };
  const read = parsed.data;
  if (read.ok && read.about.look !== undefined && !checkLook(read.about.look).ok) return { ok: false, why: "the runner's result has a Look that doesn't pass checkLook" };
  return { ok: true, result: read as PlaytestResult };
}

/** Where a runner's failures are reported: never to the Creator, always to the logs. */
export type Log = (line: string) => void;

const checkFailed = (): RunResult => ({ ok: false, checkFailed: true, problems: [{ stage: "play", message: CHECK_FAILED }] });
const tookTooLong = (ms: number): RunResult => ({
  ok: false,
  problems: [{ stage: "play", message: `The check didn't finish within ${Math.round(ms / 1000)} seconds: something in the Game loops forever, or takes far too long.` }],
});

/**
 * What one exchange with a runner came to: its output when it ended cleanly, or why not. Shared by
 * both ways, which differ only in how the runner is reached.
 */
function settle(outcome: { kind: "output"; text: string } | { kind: "timeout" } | { kind: "broken"; why: string }, timeoutMs: number, log: Log): RunResult {
  if (outcome.kind === "timeout") {
    log(`Playtest: the runner didn't finish within ${timeoutMs} ms and was stopped`);
    return tookTooLong(timeoutMs);
  }
  if (outcome.kind === "broken") {
    log(`Playtest: the check itself failed: ${outcome.why}`);
    return checkFailed();
  }
  const read = readResult(outcome.text);
  if (!read.ok) {
    log(`Playtest: the check itself failed: ${read.why}`);
    return checkFailed();
  }
  return read.result;
}

/** The runner's request. An Upload's has no expect key at all: the same request as always. */
const request = (source: string, options: RunOptions = {}) => `${JSON.stringify(options.expect === undefined ? { v: 1, source } : { v: 1, source, expect: options.expect })}\n`;

/**
 * The child-process way. NO WALL: development and tests only. `command` is the runner by default;
 * a test can name another program, to see what the site does with a broken runner.
 */
export function childProcessRunner(options: { readonly timeoutMs?: number; readonly log?: Log; readonly command?: readonly string[] } = {}): PlaytestRunner {
  const timeoutMs = options.timeoutMs ?? PLAYTEST_TIMEOUT_MS;
  const log = options.log ?? ((line) => console.error(line));
  const [program = process.execPath, ...args] = options.command ?? [process.execPath, RUNNER];
  return {
    run(source, runOptions) {
      return new Promise((resolve) => {
        const child = spawn(program, args, { stdio: ["pipe", "pipe", "pipe"] });
        const chunks: Buffer[] = [];
        let size = 0;
        let errors = "";
        let done = false;
        const finish = (outcome: Parameters<typeof settle>[0]) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          child.kill("SIGKILL");
          resolve(settle(outcome, timeoutMs, log));
        };
        const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
        child.stdout.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESULT_BYTES) return finish({ kind: "broken", why: `the runner wrote more than ${MAX_RESULT_BYTES} bytes` });
          chunks.push(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => (errors = (errors + chunk.toString("utf8")).slice(-4_000)));
        child.on("error", (error) => finish({ kind: "broken", why: `the runner couldn't start: ${error.message}` }));
        child.on("close", (code, signal) => {
          if (code === 0) return finish({ kind: "output", text: Buffer.concat(chunks).toString("utf8") });
          finish({ kind: "broken", why: `the runner exited with ${signal ?? String(code)}${errors === "" ? "" : `: ${errors.trim()}`}` });
        });
        child.stdin.on("error", () => undefined);
        child.stdin.end(request(source, runOptions));
      });
    },
  };
}

/**
 * The socket way: one connection to the socket systemd listens on (PLAYTEST_SOCKET), which starts a
 * fresh runner, inside its wall, for that connection alone. The request is sent and the sending side
 * closed, which is the runner's end of input; the result is everything read until the runner closes
 * the connection.
 *
 * systemd runs at most two at once (MaxConnections=2) and refuses, rather than queues, a third, so
 * the site keeps its own queue: never more than MAX_AT_ONCE here.
 */
export const MAX_AT_ONCE = 2;

export function socketRunner(path: string, options: { readonly timeoutMs?: number; readonly log?: Log } = {}): PlaytestRunner {
  const timeoutMs = options.timeoutMs ?? PLAYTEST_TIMEOUT_MS;
  const log = options.log ?? ((line) => console.error(line));
  let running = 0;
  const waiting: (() => void)[] = [];
  const once = (source: string, runOptions?: RunOptions) =>
    new Promise<RunResult>((resolve) => {
      const socket = connect(path);
      const chunks: Buffer[] = [];
      let size = 0;
      let done = false;
      const finish = (outcome: Parameters<typeof settle>[0]) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(settle(outcome, timeoutMs, log));
      };
      const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
      socket.on("connect", () => socket.end(request(source, runOptions)));
      socket.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESULT_BYTES) return finish({ kind: "broken", why: `the runner wrote more than ${MAX_RESULT_BYTES} bytes` });
        chunks.push(chunk);
      });
      socket.on("error", (error) => finish({ kind: "broken", why: `the Playtest's socket: ${error.message}` }));
      socket.on("close", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        // A runner that died writes nothing: systemd closes the connection all the same.
        finish(text === "" ? { kind: "broken", why: "the runner closed the connection without a result (see its journal)" } : { kind: "output", text });
      });
    });
  return {
    async run(source, runOptions) {
      // A run that finishes hands its place straight to the next one waiting, so there are never
      // more than MAX_AT_ONCE, even for a moment.
      if (running >= MAX_AT_ONCE) await new Promise<void>((go) => waiting.push(go));
      else running += 1;
      try {
        return await once(source, runOptions);
      } finally {
        const next = waiting.shift();
        if (next === undefined) running -= 1;
        else next();
      }
    },
  };
}
