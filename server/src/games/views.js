import { isPlainObject } from '../protocol/validate.js';

// The screens a game is allowed to show (plan §4a, "declarative views").
//
// Games never send UI code. They send small JSON objects like
//   { view: 'button', label: 'TAP!', action: { tap: true } }
// and the client draws each kind with a trusted React component.
// That's what will let AI-generated games run without running generated code in browsers.
//
// The client has a matching component per kind (M5b). Adding a kind means adding it
// here AND writing its component; it's a reviewed, hand-written change.
//
// Checks are strict: unknown fields are errors. A game that sends `{ view: 'button',
// lable: 'Go' }` should find out in its tests, not render a blank button on 12 phones.

const ASSET_ID_RE = /^[a-z0-9-]{1,40}$/;

// --- Field checks: each returns an error string, or null if fine ---------------------

function text(value, maxLength, { optional = false } = {}) {
  if (value === undefined && optional) return null;
  if (typeof value !== 'string' || value.length === 0) return 'must be a non-empty string';
  if (value.length > maxLength) return `must be at most ${maxLength} characters`;
  return null;
}

function assetId(value) {
  if (value === undefined) return null; // assets are always optional
  return typeof value === 'string' && ASSET_ID_RE.test(value) ? null : 'must be an asset id like "go-sign"';
}

function actionObject(value) {
  return isPlainObject(value) ? null : 'must be an object (sent back to the game when tapped)';
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a number';
}

/** Checks an object has only `allowed` keys, then runs each field check. */
function checkFields(obj, checks) {
  for (const key of Object.keys(obj)) {
    if (!Object.hasOwn(checks, key)) return `unknown field "${key}"`;
  }
  for (const [key, check] of Object.entries(checks)) {
    const problem = check(obj[key]);
    if (problem) return `"${key}" ${problem}`;
  }
  return null;
}

// --- The view kinds ------------------------------------------------------------------

const VIEW_CHECKS = {
  /** Big text, optional smaller text and picture. Phones and host. */
  message: {
    title: (v) => text(v, 100),
    text: (v) => text(v, 500, { optional: true }),
    asset: assetId,
  },

  /** One big tappable button; tapping sends `action` back to the game. Phones. */
  button: {
    label: (v) => text(v, 40),
    action: actionObject,
    asset: assetId,
  },

  /** A list of buttons (1–8). Phones. */
  choice: {
    prompt: (v) => text(v, 200),
    options: (v) => {
      if (!Array.isArray(v) || v.length < 1 || v.length > 8) return 'must be a list of 1–8 options';
      for (const [i, option] of v.entries()) {
        if (!isPlainObject(option)) return `option ${i} must be an object`;
        const problem = checkFields(option, { label: (x) => text(x, 40), action: actionObject, asset: assetId });
        if (problem) return `option ${i}: ${problem}`;
      }
      return null;
    },
  },

  /** A countdown to `endsAt` (server time in ms, see `serverNow` in game:message). */
  countdown: {
    title: (v) => text(v, 100),
    endsAt: finiteNumber,
  },

  /** Scores; names are looked up from room:state by playerId. */
  scoreboard: {
    title: (v) => text(v, 100),
    rows: (v) => {
      if (!Array.isArray(v) || v.length > 12) return 'must be a list of at most 12 rows';
      for (const [i, row] of v.entries()) {
        if (!isPlainObject(row)) return `row ${i} must be an object`;
        const problem = checkFields(row, { playerId: (x) => text(x, 40), score: finiteNumber });
        if (problem) return `row ${i}: ${problem}`;
      }
      return null;
    },
  },
};

/** The names of all view kinds, e.g. for docs and the client-sync test (M5b). */
export const VIEW_KINDS = Object.freeze(Object.keys(VIEW_CHECKS));

/**
 * Checks one view payload a game wants to send.
 * @param {unknown} payload
 * @returns {string | null}  a description of the problem, or null if the view is valid
 */
export function validateView(payload) {
  if (!isPlainObject(payload)) return 'a view must be an object';
  const { view, ...fields } = payload;
  if (typeof view !== 'string' || !Object.hasOwn(VIEW_CHECKS, view)) {
    return `unknown view kind ${JSON.stringify(view)} (known: ${VIEW_KINDS.join(', ')})`;
  }
  const problem = checkFields(fields, VIEW_CHECKS[view]);
  return problem ? `${view} view: ${problem}` : null;
}

/**
 * The actions a (valid) view lets a player send back: the button's action, or each
 * choice option's action. Other views offer nothing. GameRunner uses this to drop any
 * action that isn't on the player's screen right now (plan §11b, "offered actions").
 * @param {object | undefined} view
 * @returns {object[]}
 */
export function offeredActions(view) {
  if (view?.view === 'button') return [view.action];
  if (view?.view === 'choice') return view.options.map((option) => option.action);
  return [];
}

/**
 * Whether two JSON values are the same (same keys and values; key order doesn't matter).
 * Actions arrive as parsed JSON, so plain objects, arrays, strings, numbers, booleans and
 * null are all there is to compare.
 */
export function sameJson(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}
