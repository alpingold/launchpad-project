// Display-name rules. validate.js only checked "is it a short string"; this decides
// whether it's an acceptable name and produces the cleaned-up version we store.

export const NAME_MIN_LENGTH = 1;
export const NAME_MAX_LENGTH = 16;

// \p{C} = Unicode "Other" characters: control characters (\u0000, newlines), invisible
// formatting characters (zero-width spaces, right-to-left overrides), and unassigned or
// private-use code points. None of these belong in a name shown on a TV.
const INVISIBLE_OR_CONTROL = /\p{C}/u;

/**
 * Cleans up a raw name the way a person would expect:
 * - NFC normalization: "é" typed as e + accent becomes the single "é" character,
 *   so two names that look identical are also identical as strings
 * - trims leading/trailing spaces and collapses runs of whitespace into one space
 * @param {string} raw
 */
export function normalizeName(raw) {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/**
 * Checks a raw name.
 * @param {string} raw
 * @returns {{ ok: true, name: string, nameKey: string } | { ok: false }}
 *   name:    what everyone sees
 *   nameKey: lowercase version used to check uniqueness ("Alex" and "ALEX" clash)
 */
export function validateName(raw) {
  if (typeof raw !== 'string') return { ok: false };
  const name = normalizeName(raw);

  // Count code points, not UTF-16 units, so an emoji counts as 1 character, not 2.
  const length = [...name].length;
  if (length < NAME_MIN_LENGTH || length > NAME_MAX_LENGTH) return { ok: false };
  if (INVISIBLE_OR_CONTROL.test(name)) return { ok: false };

  return { ok: true, name, nameKey: name.toLowerCase() };
}
