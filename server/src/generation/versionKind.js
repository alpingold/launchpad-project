// VERSION KIND (plan §60): what a version of an AI-made or uploaded game is, and everything that
// follows from it. A version is a new game's (v1), a change (with a plan, or a small fix), a
// "Review again" round (§47), a remix's "Make it your own" design (§45b), a remix's copy (§45) or
// an uploaded file (§57); with its status, that decides its next job, whether the AI (and so a
// key) is needed, whether it holds a whole design, and where it is on the maker's track. Callers
// ask here instead of working it out from kind, status and basedOn themselves; the pages get
// the answers from the server (designKind and track, adminRoutes.js).

/**
 * @typedef {Object} VersionKind
 * @property {'design' | 'build' | 'recheck' | 'check' | null} step  its next job; null: none (waiting for its
 *   creator, ready, or failed)
 * @property {boolean} needsAi  that job uses the AI, so the owner's key (an upload's check doesn't)
 * @property {'whole' | 'plan' | 'none'} designKind  a whole design (a new game's, a remix's own), a
 *   change's plan (null for a small fix), or no design at all (an uploaded file)
 * @property {boolean} startsOver  the game's history starts over here: earlier change requests and
 *   designs don't apply to it or what's built on it
 * @property {{ kind: 'new' | 'change' | 'upload', at: number, state: 'working' | 'yours' | 'failed' }} track
 *   the maker's board: Idea → Design → Build → Play (new), Change → Plan → Build → Play (change),
 *   Upload → Check → Play (upload); `at` is the space (from 0), `state` who it's waiting for
 */

/**
 * @param {import('../db/generatedGames.js').GameVersion} version
 * @returns {VersionKind}
 */
export function versionKind(version) {
  const upload = version.kind === 'upload';
  const designKind = upload ? 'none' : version.basedOn === null || version.kind === 'remix' ? 'whole' : 'plan';
  const step =
    version.status === 'designing' ? 'design'
    : version.status !== 'generating' ? null
    : upload ? 'check'
    : version.kind === 'recheck' ? 'recheck'
    : 'build';
  return {
    step,
    needsAi: step !== null && step !== 'check',
    designKind,
    startsOver: designKind !== 'plan',
    track: upload ? uploadTrack(version) : { kind: designKind === 'whole' ? 'new' : 'change', ...madeTrack(version) },
  };
}

/** Where a version the AI makes is: designing or its design waiting (1), building (2), ready (3). */
function madeTrack(version) {
  switch (version.status) {
    case 'designing':
      return { at: 1, state: 'working' };
    case 'design_ready':
      return { at: 1, state: 'yours' };
    case 'generating':
      return { at: 2, state: 'working' };
    case 'failed':
      return { at: version.design === null ? 1 : 2, state: 'failed' };
    default:
      return { at: 3, state: 'yours' };
  }
}

/** An uploaded file: being checked or failed (1), ready (2). */
function uploadTrack(version) {
  const state = { generating: 'working', failed: 'failed' }[version.status] ?? 'yours';
  return { kind: 'upload', at: version.status === 'ready' ? 2 : 1, state };
}

/**
 * How a game was made, for its label (plan §57): 'ai' when the site's AI built any version;
 * else 'upload' when someone uploaded one; else a remix's is its original's (plan §60); else
 * 'ai' (games from before uploads, and imported ones).
 * @param {import('../db/generatedGames.js').GeneratedGame} game
 * @returns {'ai' | 'upload'}
 */
export function madeBy(game) {
  if (game.versions.some((v) => v.model !== null)) return 'ai';
  if (game.versions.some((v) => v.kind === 'upload')) return 'upload';
  return game.remixOfMadeBy ?? 'ai';
}
