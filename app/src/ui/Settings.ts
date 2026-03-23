const STORAGE_KEY = 'metrorider_settings';

export interface AppSettings {
  googleApiKey: string;
  lastMapName: string;
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        googleApiKey: parsed.googleApiKey ?? '',
        lastMapName: parsed.lastMapName ?? '',
      };
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
  return { googleApiKey: '', lastMapName: '' };
}

export function saveSettings(settings: Partial<AppSettings>): void {
  try {
    const current = loadSettings();
    const merged = { ...current, ...settings };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}
