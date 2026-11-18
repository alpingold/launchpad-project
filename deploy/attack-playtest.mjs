// The attacks on the Playtest's wall. Run by deploy/attack-playtest.sh, as the site's user, on a
// THROWAWAY server whose runner has the --attack-test switch (deploy/attack-test.conf): each Game
// here is handed Node's `process` and `require`, and uses them to try one thing.
//
// Each attack says what it tries and what "contained" means. A Game reports what it saw by throwing
// as it loads, `REPORT:<json>`, which comes back as the Playtest's first problem; the judging is
// done here, never by the Game. Attacks that end the runner (memory, a loop, a huge or forged
// result) are judged by what the site gets back, and by what is left on the server afterwards.
import { execFileSync } from "node:child_process";

const { socketRunner, readResult } = await import(`${process.env.RELEASE_DIR}/playtest/dist/client.js`);
const SOCKET = process.env.PLAYTEST_SOCKET;
const logged = [];
const runner = (timeoutMs) => socketRunner(SOCKET, { timeoutMs, log: (line) => logged.push(line) });

/** A Game that runs `body` (JavaScript, with `process`, `require` and a `report(value)` that ends the load) as it loads. */
function attackGame(body) {
  return `import { defineGame } from "@boilergames/sdk/v1";
declare const process: any;
declare const require: any;
function report(value: unknown): never { throw new Error("REPORT:" + JSON.stringify(value)); }
function attempt(what: () => unknown): string { try { const result = what(); return "DONE " + String(result).slice(0, 200); } catch (error) { return "FAILED " + String((error as { code?: string }).code ?? (error as Error).message).slice(0, 200); } }
${body}
export default defineGame({ about: { title: "attack", players: { min: 1, max: 1 } } } as never);
`;
}

/**
 * Runs a little Node program in a child process, inside the same wall, and returns what it printed.
 * Its time is short: the Game's whole load, this included, must finish within the Playtest's
 * 2 seconds (LOAD_MS), or the report never comes back. In a namespace with no network, a connection
 * fails at once; a timeout here would only mean something answered slowly, which is reported as such.
 */
const inChild = (script) => `attempt(() => require("node:child_process").execFileSync(process.execPath, ["-e", ${JSON.stringify(script)}], { encoding: "utf8", timeout: 1500 }).trim())`;
const tcp = (host, port) => inChild(`const s = require("node:net").connect({ host: ${JSON.stringify(host)}, port: ${port}, timeout: 1000 }); s.on("connect", () => { console.log("CONNECTED"); process.exit(0); }); s.on("timeout", () => { console.log("TIMEOUT"); process.exit(0); }); s.on("error", (e) => { console.log("ERROR " + e.code); process.exit(0); });`);

/** What the Game reported, or null if it didn't get that far. */
function reported(result) {
  const message = result.ok ? "" : (result.problems[0]?.message ?? "");
  const at = message.indexOf("REPORT:");
  return at < 0 ? null : JSON.parse(message.slice(at + "REPORT:".length));
}

/** No sign of a connection: a refusal, an error, a timeout. Anything that says CONNECTED is not contained. */
const noConnection = (seen) => typeof seen === "string" && !seen.includes("CONNECTED");
const failed = (seen) => typeof seen === "string" && seen.startsWith("FAILED");

async function siteAnswers() {
  try {
    return (await fetch("http://127.0.0.1:3000/api/config")).ok;
  } catch {
    return false;
  }
}

const stray = () => {
  try {
    return execFileSync("pgrep", ["-f", "attack-sleeper"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

const GOOD = `import { defineGame } from "@boilergames/sdk/v1";
export default defineGame<{ n: number }, { type: "tap" }>({
  about: { title: "Fine", players: { min: 1, max: 1 } },
  start: () => ({ state: { n: 0 } }),
  onAction: (s) => (s.n >= 2 ? { state: s, end: {} } : { state: { n: s.n + 1 } }),
  onLeave: (s) => ({ state: s }),
  screen: () => ({ parts: [{ kind: "text", text: "fine" }] }),
  controller: () => ({ parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] }),
});`;
/** After an attack that ends the runner, the next Playtest must work as if nothing happened. */
const nextOneWorks = async () => (await runner(70_000).run(GOOD)).ok === true;

const attacks = [
  {
    name: "connect to an outside address (IPv4)",
    tries: "TCP to 1.1.1.1:443, from a program it starts",
    contained: "no connection (no network: a private network namespace, IPAddressDeny, AF_UNIX only)",
    source: attackGame(`report({ v4: ${tcp("1.1.1.1", 443)} });`),
    judge: (seen) => noConnection(seen?.v4),
  },
  {
    name: "connect to an outside address (IPv6)",
    tries: "TCP to [2606:4700:4700::1111]:443, from a program it starts",
    contained: "no connection",
    source: attackGame(`report({ v6: ${tcp("2606:4700:4700::1111", 443)} });`),
    judge: (seen) => noConnection(seen?.v6),
  },
  {
    name: "connect to the site itself",
    tries: "TCP to 127.0.0.1:3000, where the site's Node listens",
    contained: "no connection (its loopback is its own and empty)",
    source: attackGame(`report({ site: ${tcp("127.0.0.1", 3000)} });`),
    judge: (seen) => noConnection(seen?.site),
  },
  {
    name: "connect to the game domain's server",
    tries: "TCP to 127.0.0.1:3001, where the Game frame is served",
    contained: "no connection",
    source: attackGame(`report({ frame: ${tcp("127.0.0.1", 3001)} });`),
    judge: (seen) => noConnection(seen?.frame),
  },
  {
    name: "reach the AWS metadata address",
    tries: "TCP to 169.254.169.254:80, where the server's role credentials are served",
    contained: "no connection",
    source: attackGame(`report({ metadata: ${tcp("169.254.169.254", 80)} });`),
    judge: (seen) => noConnection(seen?.metadata),
  },
  {
    name: "look up a name",
    tries: "DNS for example.com",
    contained: "the lookup fails",
    source: attackGame(`report({ dns: ${inChild(`require("node:dns").lookup("example.com", (e, a) => { console.log(e ? "ERROR " + e.code : "RESOLVED " + a); process.exit(0); });`)} });`),
    judge: (seen) => typeof seen?.dns === "string" && !seen.dns.includes("RESOLVED"),
  },
  {
    name: "read the database",
    tries: "read /var/lib/boilergames/boilergames.db, and list its folder",
    contained: "both fail: the folder isn't there for it (InaccessiblePaths)",
    source: attackGame(`const fs = require("node:fs"); report({ file: attempt(() => fs.readFileSync("/var/lib/boilergames/boilergames.db").length), folder: attempt(() => fs.readdirSync("/var/lib/boilergames").join(",")) });`),
    judge: (seen) => failed(seen?.file) && failed(seen?.folder),
  },
  {
    name: "read the site's settings",
    tries: "read /etc/boilergames.env",
    contained: "the read fails",
    source: attackGame(`report({ env: attempt(() => require("node:fs").readFileSync("/etc/boilergames.env", "utf8")) });`),
    judge: (seen) => failed(seen?.env),
  },
  {
    name: "read another process's environment",
    tries: "read /proc/1/environ, and list the processes it can see",
    contained: "the read fails, and it sees no process but its own (ProtectProc=invisible)",
    source: attackGame(`const fs = require("node:fs"); const mine = new Set([String(process.pid), String(process.ppid)]); report({ environ: attempt(() => fs.readFileSync("/proc/1/environ", "utf8")), others: fs.readdirSync("/proc").filter((n: string) => /^\\d+$/.test(n) && !mine.has(n)).length });`),
    // Its own children (none here) would also be visible; anything else is someone else's.
    judge: (seen) => failed(seen?.environ) && seen?.others === 0,
  },
  {
    name: "write outside /tmp",
    tries: "write a file in the release, /var/tmp, /etc, /home and /dev/shm (and, for comparison, /tmp)",
    contained: "every write fails but /tmp's, which is its own, empty and gone after the run",
    source: attackGame(`const fs = require("node:fs"); const w = (p: string) => attempt(() => fs.writeFileSync(p, "x")); report({ release: w("/opt/boilergames/current/attack"), varTmp: w("/var/tmp/attack"), etc: w("/etc/attack"), home: w("/home/attack"), shm: w("/dev/shm/attack"), tmp: w("/tmp/attack") });`),
    judge: (seen) => ["release", "varTmp", "etc", "home", "shm"].every((place) => failed(seen?.[place])),
  },
  {
    name: "start another program",
    tries: "run /bin/sh, which then tries the settings file, the database's folder and the network",
    contained: "the shell can start (the runner must start tsc, so programs can't be forbidden), but it is inside the same wall: its user is neither root nor the site's, and every one of its tries fails",
    // bash, not /bin/sh: Ubuntu's sh is dash, which has no /dev/tcp, and its network try would pass for nothing.
    source: attackGame(`report({ shell: attempt(() => require("node:child_process").execFileSync("/bin/bash", ["-c", "echo uid=$(id -u); cat /etc/boilergames.env >/dev/null 2>&1 && echo READ-ENV; ls /var/lib/boilergames >/dev/null 2>&1 && echo LISTED-DB; timeout 1 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443' >/dev/null 2>&1 && echo NETWORK; echo ran-to-the-end"], { encoding: "utf8", timeout: 1500 })) });`),
    judge: (seen) => {
      const uid = Number(/uid=(\d+)/.exec(seen?.shell ?? "")?.[1] ?? -1);
      // It ran to the end, so each try really happened; its user isn't root and isn't this script's (the site's).
      return /ran-to-the-end/.test(seen.shell) && uid > 0 && uid !== process.getuid() && !/READ-ENV|LISTED-DB|NETWORK/.test(seen.shell);
    },
  },
  {
    name: "use more memory than the cap",
    tries: "fill 2 GB, a megabyte at a time",
    contained: "the runner is killed at its cap (MemoryMax=400M) and the site hears the check failed; the site still answers; the next Playtest works",
    source: attackGame(`const kept = []; for (let i = 0; i < 2048; i++) kept.push(new Uint8Array(1 << 20).fill(1)); report({ filled: kept.length });`),
    end: async (result) => "checkFailed" in result && (await siteAnswers()) && (await nextOneWorks()),
  },
  {
    name: "loop forever, where the vm's timeout can't stop it",
    tries: "a loop that never ends, started outside the vm (process.nextTick)",
    contained: "systemd stops the runner after RuntimeMaxSec (60 s), the site hears the check failed rather than waiting for ever, and the next Playtest works",
    source: attackGame(`process.nextTick(() => { for (;;) {} });`),
    timeoutMs: 90_000,
    end: async (result) => "checkFailed" in result && (await nextOneWorks()),
  },
  {
    name: "start processes until refused",
    tries: "start `sleep` processes, one after another, until one is refused",
    contained: "refused within TasksMax (64, threads included); none is left running after the run ends",
    // A refused spawn doesn't throw: it has no pid (and reports the error later). argv0 names the
    // sleepers, so the script can look for any left behind.
    source: attackGame(`const cp = require("node:child_process"); let started = 0; let refusal = ""; for (; started < 1000; started++) { try { const child = cp.spawn("/bin/sleep", ["120"], { argv0: "attack-sleeper", stdio: "ignore", detached: true }); child.on("error", () => {}); if (child.pid === undefined) { refusal = "no pid"; break; } } catch (error) { refusal = String((error as { code?: string }).code ?? error); break; } } report({ started, refusal });`),
    judge: (seen) => typeof seen?.started === "number" && seen.started < 64 && seen.refusal !== "",
    after: async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return stray() === "";
    },
  },
  {
    name: "write a huge result",
    tries: "write 200 MB to standard output, the connection back to the site",
    contained: "the site stops reading at its limit, hears the check failed, and holds none of it",
    // Written synchronously to the connection (fd 1): with process.stdout, exiting could drop most of it.
    source: attackGame(`const fs = require("node:fs"); const chunk = "x".repeat(1 << 20); try { for (let i = 0; i < 200; i++) fs.writeSync(1, chunk); } catch { /* the site hung up: that is the containment */ } process.exit(0);`),
    end: async (result) => "checkFailed" in result && logged.some((line) => /wrote more than/.test(line)),
  },
  {
    name: "write a forged \"ready\" result and exit early",
    tries: "write results the Playtest never made, then exit: one that fits every rule, and ones that break them",
    contained: "a forged result that breaks a rule (a bundle over 1 MB, an unreadable Look, a field of its own) is refused as the check failing; one that fits every rule is accepted, which is the most a forgery can get: a bundle that runs only inside the Game frame (playtest/src/client.ts says why that is acceptable)",
    source: attackGame(`try { require("node:fs").writeSync(1, JSON.stringify({ ok: true, bundle: "x".repeat(2 * 1024 * 1024), about: { title: "forged", players: { min: 1, max: 1 } }, sdkVersion: "v1" })); } catch { /* the site hung up */ } process.exit(0);`),
    end: async (result) =>
      "checkFailed" in result &&
      !readResult(JSON.stringify({ ok: true, bundle: "var BoilerGamesGame = 1;", about: { title: "forged", players: { min: 1, max: 1 }, look: { colors: { background: "#ffffff", text: "#ffffff" } } }, sdkVersion: "v1" })).ok &&
      !readResult(JSON.stringify({ ok: true, bundle: "var BoilerGamesGame = 1;", about: { title: "forged", players: { min: 1, max: 1 } }, sdkVersion: "v1", admin: true })).ok &&
      readResult(JSON.stringify({ ok: true, bundle: "var BoilerGamesGame = 1;", about: { title: "forged", players: { min: 1, max: 1 } }, sdkVersion: "v1" })).ok,
  },
];

// The switch must be on, or the attacks would only test the vm.
const probe = await runner(30_000).run(attackGame(`report({ process: typeof process });`));
if (reported(probe)?.process !== "object") {
  console.error("The runner wasn't started with --attack-test (deploy/attack-test.conf), or the Playtest isn't working:");
  console.error(JSON.stringify(probe).slice(0, 500));
  process.exit(1);
}

let failures = 0;
for (const attack of attacks) {
  logged.length = 0;
  const started = Date.now();
  const result = await runner(attack.timeoutMs ?? 30_000).run(attack.source);
  const seen = reported(result);
  let contained;
  if (attack.judge !== undefined) contained = seen !== null && attack.judge(seen);
  else contained = await attack.end(result);
  if (contained && attack.after !== undefined) contained = await attack.after();
  if (!contained) failures += 1;
  console.log(`${contained ? "CONTAINED    " : "NOT CONTAINED"}  ${attack.name}  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  console.log(`    tried: ${attack.tries}`);
  console.log(`    contained means: ${attack.contained}`);
  console.log(`    saw: ${seen !== null ? JSON.stringify(seen) : JSON.stringify(result).slice(0, 300)}${logged.length > 0 ? `; site's log: ${logged.join(" | ").slice(0, 300)}` : ""}`);
}

console.log(failures === 0 ? `\nEvery attack (${attacks.length}) was contained.` : `\n${failures} of ${attacks.length} attacks were NOT contained. The live site must not accept Uploads.`);
process.exit(failures === 0 ? 0 : 1);
