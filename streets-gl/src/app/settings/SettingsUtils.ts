import {SettingsObject, SettingsObjectEntry} from "~/app/settings/SettingsObject";
import {SettingsSchema} from "~/app/settings/SettingsSchema";

const COOKIE_NAME = 'metrorider_settings';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year

function saveToCookie(json: string): void {
	try {
		const encoded = encodeURIComponent(json);
		document.cookie = `${COOKIE_NAME}=${encoded};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`;
	} catch (e) {
		console.error('[Settings] Failed to save cookie:', e);
	}
}

function loadFromCookie(): string | null {
	try {
		const prefix = COOKIE_NAME + '=';
		const cookies = document.cookie.split(';');
		for (const c of cookies) {
			const trimmed = c.trim();
			if (trimmed.startsWith(prefix)) {
				return decodeURIComponent(trimmed.substring(prefix.length));
			}
		}
	} catch (e) {
		console.error('[Settings] Failed to read cookie:', e);
	}
	return null;
}

export function fetchSettingsFromLocalStorage(): Record<string, any> {
	const json: Record<string, any> = {};

	let storageValue = localStorage.getItem('settings');
	let source = 'localStorage';

	if (!storageValue) {
		storageValue = loadFromCookie();
		source = 'cookie';
	}

	if (storageValue) {
		try {
			Object.assign(json, JSON.parse(storageValue));
			console.log(`[Settings] Loaded ${Object.keys(json).length} keys from ${source}`);
		} catch (e) {
			console.error(`[Settings] Failed to parse settings from ${source}:`, e);
		}
	} else {
		console.log('[Settings] No saved settings found (localStorage or cookie)');
	}

	return json;
}

export function saveSettingsToLocalStorage(settings: SettingsObject): void {
	const json = JSON.stringify(settings);

	localStorage.setItem('settings', json);
	saveToCookie(json);

	console.log('[Settings] Saved (' + json.length + ' chars):', Object.keys(settings).map(
		k => `${k}=${settings[k]?.statusValue ?? settings[k]?.numberValue}`
	).join(', '));
}

export function makeSettingsMatchSchema(stored: Record<string, any>, schema: SettingsSchema): SettingsObject {
	const settingsObject: SettingsObject = {};

	for (const [key, config] of Object.entries(schema)) {
		const value: SettingsObjectEntry = {};

		if (config.status) {
			const prev = stored[key]?.statusValue;

			if (config.status.includes(prev)) {
				value.statusValue = prev;
			} else {
				value.statusValue = config.statusDefault;
			}
		}

		if (config.selectRange) {
			const prev = +stored[key]?.numberValue;

			if (prev >= config.selectRange[0] && prev <= config.selectRange[1]) {
				value.numberValue = prev;
			} else {
				value.numberValue = config.selectRangeDefault;
			}
		}

		settingsObject[key] = value;
	}

	return settingsObject;
}