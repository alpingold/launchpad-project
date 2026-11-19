/** The Playtest's limits, each named once. */

/** The most a Game's source may be, in bytes of UTF-8. */
export const MAX_SOURCE_BYTES = 256 * 1024;
/** The most a Game's bundle may be, in bytes of UTF-8. */
export const MAX_BUNDLE_BYTES = 1024 * 1024;
/** The most problems one Playtest reports. A Creator fixes the first ones first. */
export const MAX_PROBLEMS = 50;
/** The longest one problem's message may be; a longer one (tsc can write pages) is cut short. */
export const MAX_PROBLEM_CHARS = 2_000;
/** How long tsc may take on one Game. */
export const TYPES_MS = 30_000;
/** How long loading the bundle (its top-level code) and reading its `about` may take. */
export const LOAD_MS = 2_000;
/** How long one simulated Match may take. A Game that loops forever is stopped here. */
export const RUN_MS = 3_000;
/** The seeds each kind of run is played with. */
export const SEEDS = [1, 2, 3] as const;

/** The most a runner's request may be: the largest source, written as JSON (which can double it), and room for the rest (a Concept's expect included). */
export const MAX_REQUEST_BYTES = MAX_SOURCE_BYTES * 2 + 4096;
/** The runner's command-line switch that hands a Game Node's own objects (runner.ts). Never on the live server. */
export const ATTACK_TEST_SWITCH = "--attack-test";
