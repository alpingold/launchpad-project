#!/usr/bin/env node
// `npm run generate -- "<game idea>"`: generates a game in the OpenShell sandbox and saves
// it to generator/out/<time>/ for you to read.
//
// Branch iframe-games: switched off. The generator in the sandbox writes block games, which
// this branch no longer runs. It's rewritten for frame games, with the design-first steps,
// in milestone F5 (docs/PLAN.md §13i). The block version is in git history (and on main).

console.error(`npm run generate is switched off on the iframe-games branch.
The generator is being rewritten for frame games (docs/PLAN.md §13, milestone F5).`);
process.exit(2);
