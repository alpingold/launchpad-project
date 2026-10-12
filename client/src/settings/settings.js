// Site settings, saved per device in localStorage (plan M6b).
//
// Why localStorage and not sessionStorage (which holds room tokens)? Settings should
// survive closing the tab and apply to every tab; a room spot should not.
// Accounts (M7) could later sync these to the server; for now they're per device.
//
// To add a setting: add its default to DEFAULT_SETTINGS and a check to IS_VALID.
// Anything stored that fails its check (old versions, hand-edited storage) falls back
// to the default, so a bad value can never break the page.

export const STORAGE_KEY = 'boilergames.settings';

/** 'system' follows the device's light/dark preference. */
export const THEME_CHOICES = Object.freeze(['system', 'light', 'dark']);

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system',
});

const IS_VALID = {
  theme: (value) => THEME_CHOICES.includes(value),
};

/** Reads saved settings, keeping only known keys with valid values. */
export function loadSettings() {
  let stored = null;
  try {
    stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Unavailable storage or corrupt JSON: use defaults.
  }
  const settings = { ...DEFAULT_SETTINGS };
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (Object.hasOwn(stored, key) && IS_VALID[key](stored[key])) settings[key] = stored[key];
    }
  }
  return settings;
}

export function saveSettings(settings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (some private modes): the setting works until the page closes.
  }
}

/** True if `value` is allowed for `key` (used before saving a change). */
export function isValidSetting(key, value) {
  return Object.hasOwn(IS_VALID, key) && IS_VALID[key](value);
}
