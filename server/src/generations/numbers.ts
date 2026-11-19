/**
 * Every number the AI maker uses, in one file, each with the reason it has (BUILD-PLAN, "Milestone 3:
 * the AI", "Defaults waiting for the owner's yes"). **None of them is confirmed by the owner yet.** The
 * experiment's numbers behind several of them are weak evidence: it had a different SDK, a Playtest
 * that stopped at the first problem, and an eval that began at Build. The eval set will tell.
 */

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;

// --- The model (default 1) -------------------------------------------------------------------

/**
 * What the experiment measured, and what the README suggests setting. They are settings
 * (GENAI_MODEL, GENAI_BASE_URL), never defaults: the maker is off unless both are set.
 */
export const SUGGESTED_MODEL = "qwen3.8:27b";
export const SUGGESTED_BASE_URL = "https://genai.rcac.purdue.edu/api";

/** The longest one model call may take. GenAI Studio writes nothing until its whole answer is ready, which can take 12 minutes. */
export const COMPLETION_TIMEOUT_MS = 15 * MINUTE_MS;
/** How long checking a key may take: one quick list of the models. */
export const KEY_CHECK_TIMEOUT_MS = 5 * SECOND_MS;
/** The largest answer read from the model. A Game's source is at most 256 KB; an answer is that and some words. */
export const MAX_ANSWER_BYTES = 2 * 1024 * 1024;

// --- The caps on one Generation (default 2) ---------------------------------------------------

/** Builds per Generation: the experiment needed 2 to 4 for every Game. */
export const MAX_BUILDS = 4;
/** Type fixes per Build: type errors are cheap to fix and don't use up a Build. */
export const MAX_TYPE_FIXES_PER_BUILD = 4;
/** Invalid Concepts per draft before the Generation fails. */
export const MAX_INVALID_CONCEPTS = 3;
/** Model calls in all, for one Generation or Revision: so nothing can spend a Creator's key without end. */
export const MAX_MODEL_CALLS = 16;

// --- The queue and the daily limits (default 3) -------------------------------------------------

/** Generations an account may start in a day. A Generation takes 4 to 14 minutes and holds a Playtest slot. */
export const GENERATIONS_PER_DAY = 5;
/** Revisions an account may ask for in a day. */
export const REVISIONS_PER_DAY = 10;
/** Generations or Revisions running at once on the whole site. */
export const RUNNING_AT_ONCE = 2;
/** Waiting in the queue, in all, before the site says it is busy. */
export const MAX_WAITING_GENERATIONS = 20;

/** The waits when GenAI Studio is down or busy, before the Generation fails as unavailable. */
export const UNAVAILABLE_WAITS_MS = [30 * SECOND_MS, 60 * SECOND_MS, 120 * SECOND_MS, 240 * SECOND_MS] as const;

// --- Keys (default 4) --------------------------------------------------------------------------

/** Saving a key: at most this many tries in KEY_SAVES_WINDOW_MS per account. */
export const KEY_SAVES = 10;
export const KEY_SAVES_WINDOW_MS = 15 * MINUTE_MS;

// --- Concepts (default 7) -----------------------------------------------------------------------

/** A Concept waiting for its Creator this long is cancelled, so the list doesn't fill with abandoned drafts. */
export const REVIEW_EXPIRES_MS = 7 * 24 * 60 * MINUTE_MS;

// --- What a Creator types ------------------------------------------------------------------------

/** The longest idea for a Generation, in characters. */
export const MAX_IDEA_CHARS = 2_000;
/** The longest request for a Revision, in characters. */
export const MAX_REQUEST_CHARS = 1_000;
