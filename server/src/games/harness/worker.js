// The process that actually runs a game under test. Started by index.js, never directly.
//
// It reads the game's source from stdin, runs every check, and writes the report as one
// JSON line to stdout. Progress goes to stderr, so if this process has to be killed
// (an infinite loop never returns), the parent still knows what it was doing.
//
// index.js starts it with Node's permission model (--permission): it can read only the
// harness code and the art manifest, and can't write files or start other processes.
// That's an extra seat belt, not the security boundary (Node 24 can't block network
// access this way). The real boundary is the OpenShell sandbox around the generator.

import { checkGameSource } from './check.js';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const source = Buffer.concat(chunks).toString('utf8');
const sourceName = process.argv[2] || 'game.js';

// A game's own console output must not get mixed into the report on stdout.
console.log = console.info = console.warn = console.error = () => {};

const report = await checkGameSource(source, {
  sourceName,
  onProgress: (text) => process.stderr.write(`STEP ${text}\n`),
});
process.stdout.write(`${JSON.stringify(report)}\n`);
