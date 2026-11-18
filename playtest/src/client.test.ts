// What the site does with what comes back from a runner: a result is held to the schema and the
// limits; a runner that dies, writes nonsense or writes too much is "the check itself failed" for the
// Creator and the detail for the logs; a runner that takes too long is stopped. And the socket way,
// with a socket that starts a runner per connection, as systemd does.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CHECK_FAILED, childProcessRunner, MAX_AT_ONCE, readResult, RUNNER, socketRunner, type RunResult } from "./client.js";
import { ATTACK_TEST_SWITCH, MAX_BUNDLE_BYTES } from "./limits.js";

const GOOD = `import { defineGame } from "@boilergames/sdk/v1";
export default defineGame<{ taps: number }, { type: "tap" }>({
  about: { title: "Three Taps", players: { min: 1, max: 2 } },
  start: () => ({ state: { taps: 0 } }),
  onAction: (state) => (state.taps + 1 >= 3 ? { state: { taps: 3 }, end: {} } : { state: { taps: state.taps + 1 } }),
  onLeave: (state) => ({ state }),
  screen: (state) => ({ parts: [{ kind: "text", text: \`\${state.taps} taps\` }] }),
  controller: () => ({ parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] }),
});
`;

/** A Game that says, by throwing as it loads, whether it was handed Node's `process`. */
const ASKS_FOR_PROCESS = `import { defineGame } from "@boilergames/sdk/v1";
declare const process: unknown;
throw new Error(typeof process === "undefined" ? "no process here" : "process was handed over");
export default defineGame({ about: { title: "x", players: { min: 1, max: 1 } } } as never);
`;

/** A program standing in for a runner, that does `script` (JavaScript) instead. */
const fake = (script: string) => [process.execPath, "-e", script];

function logged(): { log: (line: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { log: (line) => lines.push(line), lines };
}

const checkFailed: RunResult = { ok: false, checkFailed: true, problems: [{ stage: "play", message: CHECK_FAILED }] };

describe("a runner that misbehaves", () => {
  test.each([
    ["dies", "process.exit(3)", "exited with 3"],
    ["is killed", "process.kill(process.pid, 'SIGKILL')", "exited with SIGKILL"],
    ["writes nonsense", "process.stdout.write('nonsense')", "isn't JSON"],
    ["writes JSON that isn't a result", "process.stdout.write(JSON.stringify({ ok: 'sure' }))", "doesn't fit the schema"],
    ["writes nothing and exits cleanly", "", "isn't JSON"],
  ])("one that %s: the Creator hears the check failed; the logs hear why", async (_what, script, why) => {
    const { log, lines } = logged();
    expect(await childProcessRunner({ log, command: fake(script) }).run(GOOD)).toEqual(checkFailed);
    expect(lines.join("\n")).toContain(why);
  });

  test("one that writes far too much is cut off, and the site holds none of it", async () => {
    const { log, lines } = logged();
    const flood = "const chunk = 'x'.repeat(1 << 20); (function more() { if (process.stdout.write(chunk)) setImmediate(more); else process.stdout.once('drain', more); })();";
    expect(await childProcessRunner({ log, command: fake(flood) }).run(GOOD)).toEqual(checkFailed);
    expect(lines.join("\n")).toMatch(/wrote more than \d+ bytes/);
  });

  test("one that takes too long is stopped, and the Creator hears the Game may loop forever", async () => {
    const { log, lines } = logged();
    const result = await childProcessRunner({ log, timeoutMs: 500, command: fake("setInterval(() => {}, 1000)") }).run(GOOD);
    expect(result).toEqual({ ok: false, problems: [{ stage: "play", message: "The check didn't finish within 1 seconds: something in the Game loops forever, or takes far too long." }] });
    expect(lines.join("\n")).toContain("didn't finish within 500 ms");
  });

  test("the real runner, stopped by the site's timeout while a Game loops", async () => {
    const looping = GOOD.replace(/onAction: .*\n/, "onAction: (state) => { while (state.taps >= 0) state = { taps: state.taps + 1 }; return { state }; },\n");
    const result = await childProcessRunner({ timeoutMs: 1_500, log: () => undefined }).run(looping);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.problems[0]?.message).toMatch(/didn't finish within/);
  });
});

describe("a result is held to the schema and the limits", () => {
  const ready = { ok: true, bundle: "var BoilerGamesGame = 1;", about: { title: "T", players: { min: 1, max: 4 } }, sdkVersion: "v1" };
  test("an honest-looking ready result is read", () => {
    expect(readResult(JSON.stringify(ready))).toEqual({ ok: true, result: ready });
  });
  test.each([
    ["a bundle over the size", { ...ready, bundle: "x".repeat(MAX_BUNDLE_BYTES + 1) }],
    ["a title too long", { ...ready, about: { ...ready.about, title: "x".repeat(61) } }],
    ["a Player count upside down", { ...ready, about: { ...ready.about, players: { min: 5, max: 2 } } }],
    ["an unreadable Look", { ...ready, about: { ...ready.about, look: { colors: { background: "#ffffff", text: "#ffffff" } } } }],
    ["another SDK version", { ...ready, sdkVersion: "v9" }],
    ["a field of its own", { ...ready, admin: true }],
    ["no problems on a failure", { ok: false, problems: [] }],
    ["too many problems", { ok: false, problems: Array.from({ length: 51 }, () => ({ stage: "play", message: "x" })) }],
  ])("a forged result with %s is refused", (_what, forged) => {
    expect(readResult(JSON.stringify(forged)).ok).toBe(false);
  });
});

describe(`the attack switch (${ATTACK_TEST_SWITCH})`, () => {
  test("off: the Game has no process, whatever the request says", async () => {
    const result = await new Promise<string>((resolve) => {
      const child = spawn(process.execPath, [RUNNER], { stdio: ["pipe", "pipe", "inherit"] });
      let out = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.on("close", () => resolve(out));
      // Fields a hostile request might hope would turn it on.
      child.stdin.end(JSON.stringify({ v: 1, source: ASKS_FOR_PROCESS, attackTest: true, "--attack-test": true, argv: [ATTACK_TEST_SWITCH], giveTheGame: { process: true } }));
    });
    expect(result).toContain("no process here");
  });

  test("on, from the command line only: the Game is handed Node's process", async () => {
    const result = await childProcessRunner({ command: [process.execPath, RUNNER, ATTACK_TEST_SWITCH] }).run(ASKS_FOR_PROCESS);
    expect(result.ok ? "" : result.problems[0]?.message).toBe("The Game threw while loading: process was handed over");
  });
});

describe("the socket way", () => {
  let folder: string;
  let server: Server;
  let path: string;
  /** How many runners are running now, and the most at once. */
  const running = { now: 0, most: 0 };

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), "playtest-socket-"));
    path = join(folder, "playtest.sock");
    // As systemd does with Accept=yes: a fresh runner for each connection, the connection as its
    // standard input and output. Half-open, as systemd's is: the site's end of sending is the
    // runner's end of input, and the runner can still answer.
    // The connection itself is the runner's standard input and output, one socket for both, as
    // systemd's StandardInput=socket and StandardOutput=socket give it.
    server = createServer({ allowHalfOpen: true, pauseOnConnect: true }, (connection: Socket) => {
      spawn(process.execPath, [RUNNER], { stdio: [connection, connection, "ignore"] });
      // The runner has its own copy of the connection; this process lets go of its own.
      connection.destroy();
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(folder, { recursive: true, force: true });
  });

  test("a Playtest through the socket", async () => {
    const result = await socketRunner(path).run(GOOD);
    expect(result.ok && result.about.title).toBe("Three Taps");
  });

  test(`never more than ${MAX_AT_ONCE} at once: the rest wait their turn rather than being refused`, async () => {
    // Counted by a stand-in that pipes the connection through the runner, so its count drops before
    // the site hears the result: with the connection handed over whole, the runner's exit and the
    // site's next connection reach this one test process in no fixed order.
    const counted = join(folder, "counted.sock");
    const counting = createServer({ allowHalfOpen: true }, (connection: Socket) => {
      running.now += 1;
      running.most = Math.max(running.most, running.now);
      const child = spawn(process.execPath, [RUNNER], { stdio: ["pipe", "pipe", "ignore"] });
      connection.pipe(child.stdin);
      child.stdout.pipe(connection, { end: false });
      child.on("close", () => {
        running.now -= 1;
        connection.end();
      });
    });
    await new Promise<void>((resolve) => counting.listen(counted, resolve));
    running.most = 0;
    const runner = socketRunner(counted);
    const results = await Promise.all(Array.from({ length: 5 }, () => runner.run(GOOD)));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(running.most).toBe(MAX_AT_ONCE);
    await new Promise((resolve) => counting.close(resolve));
  });

  test.skipIf(!existsSync("/usr/bin/systemd-socket-activate"))("through systemd's own socket activation (Accept=yes, the connection as standard input and output)", async () => {
    const activated = join(folder, "activated.sock");
    // systemd's own tool for trying a socket-activated program: --inetd hands each connection over as
    // standard input and output, as boilergames-playtest@.service's StandardInput=socket does.
    const activator = spawn("/usr/bin/systemd-socket-activate", ["--accept", "--inetd", "-l", activated, process.execPath, RUNNER], { stdio: "ignore" });
    try {
      for (let tries = 0; tries < 100 && !existsSync(activated); tries++) await new Promise((resolve) => setTimeout(resolve, 20));
      const result = await socketRunner(activated).run(GOOD);
      expect(result.ok && result.about.title).toBe("Three Taps");
    } finally {
      activator.kill();
    }
  });

  test("no socket there: the check itself failed", async () => {
    const { log, lines } = logged();
    expect(await socketRunner(join(folder, "missing.sock"), { log }).run(GOOD)).toEqual(checkFailed);
    expect(lines.join("\n")).toContain("ENOENT");
  });
});
