/** The Playtest's limits, each named once. */

/** The most a Game's source may be, in bytes of UTF-8. */
export const MAX_SOURCE_BYTES = 256 * 1024;
/** The most a Game's bundle may be, in bytes of UTF-8. */
export const MAX_BUNDLE_BYTES = 1024 * 1024;
/** The most problems one Playtest reports. A Creator fixes the first ones first. */
export const MAX_PROBLEMS = 50;
/** How long tsc may take on one Game. */
export const TYPES_MS = 30_000;
/** How long loading the bundle (its top-level code) and reading its `about` may take. */
export const LOAD_MS = 2_000;
/** How long one simulated Match may take. A Game that loops forever is stopped here. */
export const RUN_MS = 3_000;
/** The seeds each kind of run is played with. */
export const SEEDS = [1, 2, 3] as const;
