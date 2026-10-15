import { readFileSync } from 'node:fs';
import { frameGameOrThrow } from '../../src/games/frameGame.js';

// Frame games for tests (plan §13c). The server never runs a game file, so tests only need
// valid files: test/fixtures/tap-test.html, or variations of it.

/** The tap test game's file. */
export const TAP_SOURCE = readFileSync(new URL('../fixtures/tap-test.html', import.meta.url), 'utf8');

/** A game file with a different name (e.g. a new version of a generated game). */
export function renamedSource(name, source = TAP_SOURCE) {
  return source.replace('"name": "Tap Test"', `"name": ${JSON.stringify(name)}`);
}

/** The tap test game as a registry entry, under any id and with any info changed. */
export function tapGame(id = 'tap-test', info = {}) {
  return { ...frameGameOrThrow(TAP_SOURCE, id), ...info };
}
