/**
 * What a Playtest may also be asked to check, for a Game the site's AI made: the Concept it was made
 * from (BUILD-PLAN, "How the Playtest sees a Concept's phases"). An Upload's request never carries
 * it, and without it the Playtest does exactly what it always did.
 *
 * Read by hand, not with a schema library, so the runner loads nothing it didn't load before.
 */

/** The Concept, as the Playtest checks a Game against it. */
export interface Expect {
  /** The ids of the Concept's phases. The Game's state.phase must only ever be one of them, and each must be reached. */
  readonly phases: readonly string[];
  /** Whether the Concept has scoring: then a finished Match must tell its Players apart. */
  readonly scoring: boolean;
  /** The Concept's Player count, which the Game's about.players must be. */
  readonly players: { readonly min: number; readonly max: number };
}

/** The most phases, and the longest id. At least as loose as a Concept (server: CONCEPT_LIMITS), so every valid Concept fits. */
export const MAX_EXPECTED_PHASES = 8;
export const MAX_PHASE_ID = 40;
/** The most Players a Room holds. */
const ROOM_SIZE = 16;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));
const whole = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/** An Expect, checked field by field, or what is wrong with it. */
export function readExpect(value: unknown): { readonly ok: true; readonly expect: Expect } | { readonly ok: false; readonly why: string } {
  const wrong = (why: string) => ({ ok: false as const, why: `expect${why}` });
  if (!isRecord(value) || !onlyKeys(value, ["phases", "scoring", "players"])) return wrong(" must be { phases, scoring, players }");
  const { phases, scoring, players } = value;
  if (!Array.isArray(phases) || phases.length < 1 || phases.length > MAX_EXPECTED_PHASES) return wrong(`.phases must be a list of 1 to ${MAX_EXPECTED_PHASES} ids`);
  const idRule = new RegExp(`^[a-z]{1,${MAX_PHASE_ID}}$`);
  if (!phases.every((id) => typeof id === "string" && idRule.test(id))) return wrong(`.phases must each be 1 to ${MAX_PHASE_ID} lower-case letters`);
  if (new Set(phases).size !== phases.length) return wrong(".phases must all be different");
  if (typeof scoring !== "boolean") return wrong(".scoring must be true or false");
  if (!isRecord(players) || !onlyKeys(players, ["min", "max"]) || !whole(players["min"], 1, ROOM_SIZE) || !whole(players["max"], 1, ROOM_SIZE) || players["min"] > players["max"]) {
    return wrong(`.players must be { min, max }, whole numbers from 1 to ${ROOM_SIZE}, min not above max`);
  }
  return { ok: true, expect: { phases: [...(phases as string[])], scoring, players: { min: players["min"], max: players["max"] } } };
}
