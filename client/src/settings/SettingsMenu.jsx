import { useRef } from 'react';
import { useSettings } from './SettingsContext.jsx';

const THEME_LABELS = [
  ['system', 'Match device'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

/**
 * The ⚙ button in the corner of every page, and the settings panel it opens.
 *
 * A panel instead of a separate /settings page: a phone in the middle of a game can
 * change settings without navigating away (which would briefly drop its connection).
 * Uses the built-in <dialog> element, which handles Esc to close and keeps keyboard
 * focus inside the panel while it's open.
 */
export default function SettingsMenu() {
  const dialogRef = useRef(null);
  const { settings, updateSetting } = useSettings();

  return (
    <>
      <button
        type="button"
        className="settings-button"
        aria-label="Settings"
        title="Settings"
        onClick={() => dialogRef.current.showModal()}
      >
        ⚙
      </button>

      <dialog ref={dialogRef} className="settings-dialog" aria-labelledby="settings-title">
        <h2 id="settings-title">Settings</h2>

        <fieldset className="settings-group">
          <legend>Theme</legend>
          {THEME_LABELS.map(([value, label]) => (
            <label key={value} className="settings-option">
              <input
                type="radio"
                name="theme"
                value={value}
                checked={settings.theme === value}
                onChange={() => updateSetting('theme', value)}
              />
              {label}
            </label>
          ))}
        </fieldset>

        <p className="muted small">Settings are saved on this device.</p>

        <form method="dialog">
          <button type="submit" className="primary-button">
            Done
          </button>
        </form>
      </dialog>
    </>
  );
}
