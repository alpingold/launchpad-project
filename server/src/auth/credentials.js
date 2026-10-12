// Rules for usernames and passwords (decision D15).

export const USERNAME_RULES = 'Usernames are 3–20 letters, numbers, or underscores.';
export const PASSWORD_RULES = 'Passwords are 8–128 characters.';

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

/** Usernames are shown on the host screen, so keep them simple and unambiguous. */
export function isValidUsername(value) {
  return typeof value === 'string' && USERNAME_RE.test(value);
}

/**
 * At least 8 characters. At most 128: scrypt's work grows with the input, so an enormous
 * "password" could be used to make the server do pointless work.
 * Length is counted in code points, so emoji and accents count as one character each.
 */
export function isValidPassword(value) {
  if (typeof value !== 'string') return false;
  const length = [...value].length;
  return length >= 8 && length <= 128;
}
