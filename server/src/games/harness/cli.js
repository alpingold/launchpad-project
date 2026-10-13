#!/usr/bin/env node
// `npm run check-game -- <file> [--json]`: runs the game test harness on a game file.
//
// The game's code really runs (in a separate, limited process). For AI-generated code
// that nobody has read yet, run this only inside the OpenShell sandbox (plan §11).

import path from 'node:path';
import { checkGameFile, formatReport } from './index.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const files = args.filter((a) => !a.startsWith('--'));

if (files.length === 0) {
  console.error('Usage: npm run check-game -- <game file> [more files] [--json]');
  process.exit(2);
}

// npm runs scripts from the repo root; resolve paths from where the command was typed.
const base = process.env.INIT_CWD || process.cwd();
let allOk = true;
for (const file of files) {
  const report = await checkGameFile(path.resolve(base, file));
  allOk &&= report.ok;
  console.log(json ? JSON.stringify(report) : formatReport(report, file));
}
process.exit(allOk ? 0 : 1);
