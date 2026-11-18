/**
 * The runner: one Playtest, in a process of its own. It reads one request from standard input, runs
 * the Playtest, writes one result to standard output and exits. Nothing a Game leaves behind is there
 * for the next one, because the next one is another process.
 *
 *   node playtest/dist/runner.js < request.json > result.json
 *
 * The request is JSON: { "v": 1, "source": "<the Game's TypeScript>" }. The result is the Playtest's
 * result as JSON (playtest.ts). If the Playtest itself breaks, the runner writes nothing, says why on
 * standard error (the journal, on the server) and exits with 1; whoever started it tells the Creator
 * the check itself failed.
 *
 * On the server, systemd starts one per connection to its socket, with the connection as standard
 * input and output, inside the wall of deploy/boilergames-playtest@.service. Started any other way
 * (development, tests), there is no wall.
 *
 * `--attack-test` is for the attack script only (deploy/attack-playtest.sh), on a throwaway server:
 * it hands the Game Node's `process` and `require`, so a hostile Game can try the wall without first
 * having to get out of the `vm`. It is read from the command line, which only the service file sets;
 * nothing in a request can turn it on.
 *
 * This file is a program, not a module: importing it runs it. Its constants are in limits.ts.
 */
import { createRequire } from "node:module";
import { ATTACK_TEST_SWITCH, MAX_REQUEST_BYTES } from "./limits.js";
import { playtest } from "./playtest.js";

async function readRequest(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new Error(`the request is over ${MAX_REQUEST_BYTES} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function write(text: string): Promise<void> {
  return new Promise((resolve, reject) => process.stdout.write(text, (error) => (error ? reject(error) : resolve())));
}

async function main(): Promise<void> {
  const attackTest = process.argv.includes(ATTACK_TEST_SWITCH);
  const request: unknown = JSON.parse(await readRequest());
  const source = (request as { v?: unknown; source?: unknown } | null)?.source;
  if ((request as { v?: unknown } | null)?.v !== 1 || typeof source !== "string") throw new Error('the request must be { "v": 1, "source": "..." }');
  const result = await playtest(source, attackTest ? { giveTheGame: { process, require: createRequire(import.meta.url) } } : {});
  await write(`${JSON.stringify(result)}\n`);
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(`The Playtest's runner failed: ${(error as Error).stack ?? String(error)}`);
  process.exit(1);
}
