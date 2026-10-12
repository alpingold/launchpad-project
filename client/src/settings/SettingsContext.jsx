import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { STORAGE_KEY, loadSettings, saveSettings, isValidSetting } from './settings.js';
import { useApplyTheme } from './theme.js';

const SettingsContext = createContext(null);

/**
 * Holds the settings for the whole app, so any component can read or change them with
 * useSettings(). Also applies the theme, and keeps tabs in sync: changing the theme in one
 * tab updates every other open BoilerGames tab (the browser's 'storage' event).
 */
export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(loadSettings);

  const updateSetting = useCallback((key, value) => {
    if (!isValidSetting(key, value)) return;
    setSettings((current) => {
      const next = { ...current, [key]: value };
      saveSettings(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === STORAGE_KEY) setSettings(loadSettings());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useApplyTheme(settings.theme);

  return <SettingsContext.Provider value={{ settings, updateSetting }}>{children}</SettingsContext.Provider>;
}

/** @returns {{ settings: { theme: 'system' | 'light' | 'dark' }, updateSetting: (key: string, value: unknown) => void }} */
export function useSettings() {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside <SettingsProvider>');
  return value;
}
