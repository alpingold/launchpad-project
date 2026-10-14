import { isPlainObject } from '../../protocol/validate.js';

// A tiny schema language for block fields (plan §12d). Each helper returns a FIELD:
//
//   { type: 'text, at most 100 characters', optional: boolean, check(value) → problem | null }
//
// `check` only runs when the value is present (missing optional fields are fine; missing
// required ones are reported by checkFields). `type` is plain English: it appears in error
// messages now, and in the generated kit reference (KIT.md, the /kit page) later.
//
// Why not a library (zod, ajv)? It would be a new dependency for about 100 lines, and these
// checks need to read well in error messages that get fed back to the AI.

const ASSET_ID_RE = /^[a-z0-9-]{1,40}$/;

function field(type, check, { optional = false } = {}) {
  return { type, optional, check };
}

export function text({ max, optional } = {}) {
  return field(
    `text, at most ${max} characters`,
    (v) => {
      if (typeof v !== 'string' || v.length === 0) return 'must be a non-empty string';
      if (v.length > max) return `must be at most ${max} characters (got ${v.length})`;
      return null;
    },
    { optional },
  );
}

export function number({ min = -Infinity, max = Infinity, integer = false, optional } = {}) {
  const range = [min !== -Infinity && `≥ ${min}`, max !== Infinity && `≤ ${max}`].filter(Boolean).join(', ');
  return field(
    `${integer ? 'whole number' : 'number'}${range ? ` (${range})` : ''}`,
    (v) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a number';
      if (integer && !Number.isInteger(v)) return 'must be a whole number';
      if (v < min || v > max) return `must be ${range}`;
      return null;
    },
    { optional },
  );
}

export function oneOf(values, { optional } = {}) {
  const list = values.map((v) => JSON.stringify(v)).join(' | ');
  return field(list, (v) => (values.includes(v) ? null : `must be one of ${list}`), { optional });
}

export function boolean({ optional } = {}) {
  return field('true | false', (v) => (typeof v === 'boolean' ? null : 'must be true or false'), { optional });
}

/** An id from the art library (client/public/game-assets/manifest.json). */
export function asset({ optional } = {}) {
  return field(
    'asset id from the art library, e.g. "go-sign"',
    (v) => (typeof v === 'string' && ASSET_ID_RE.test(v) ? null : 'must be an asset id like "go-sign"'),
    { optional },
  );
}

/** A player id from ctx.players. */
export function playerId({ optional } = {}) {
  return field('player id from ctx.players', (v) => (typeof v === 'string' && v.length > 0 && v.length <= 40 ? null : 'must be a player id'), {
    optional,
  });
}

/** Any plain object; it's sent back to the game unchanged when the player uses the control. */
export function action() {
  return field('object, sent back to onAction unchanged', (v) => (isPlainObject(v) ? null : 'must be an object'));
}

export function list(item, { min = 0, max, optional } = {}) {
  return field(
    `list of ${min}–${max} × (${item.type})`,
    (v) => {
      if (!Array.isArray(v)) return 'must be a list';
      if (v.length < min || v.length > max) return `must have ${min}–${max} items (got ${v.length})`;
      for (const [i, x] of v.entries()) {
        const problem = item.check(x);
        if (problem) return `item ${i}: ${problem}`;
      }
      return null;
    },
    { optional },
  );
}

/** A plain object with exactly these fields. */
export function object(fields) {
  const type = `{ ${Object.entries(fields)
    .map(([k, f]) => `${k}${f.optional ? '?' : ''}`)
    .join(', ')} }`;
  return field(type, (v) => (isPlainObject(v) ? checkFields(v, fields) : 'must be an object'));
}

/**
 * Child blocks of a layout block. The schema only checks it's a list of the right length;
 * screen.js walks into each child (it knows the blocks, this file doesn't).
 */
export function children({ min = 1, max }) {
  return { ...field(`list of ${min}–${max} blocks`, (v) => (Array.isArray(v) && v.length >= min && v.length <= max ? null : `must be a list of ${min}–${max} blocks`)), children: true };
}

/**
 * Checks an object against its fields: no unknown fields (a typo like "lable" is an error,
 * not a silently missing label), every required field present, every present field valid.
 * @returns {string | null}
 */
export function checkFields(obj, fields) {
  for (const key of Object.keys(obj)) {
    if (!Object.hasOwn(fields, key)) return `unknown field "${key}" (allowed: ${Object.keys(fields).join(', ') || 'none'})`;
  }
  for (const [key, f] of Object.entries(fields)) {
    if (obj[key] === undefined) {
      if (!f.optional) return `"${key}" is missing (${f.type})`;
      continue;
    }
    const problem = f.check(obj[key]);
    if (problem) return `"${key}" ${problem}`;
  }
  return null;
}
