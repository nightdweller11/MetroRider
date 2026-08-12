import {SettingsObject, SettingsObjectEntry} from "~/app/settings/SettingsObject";
import SettingsEventEmitter from "~/app/settings/SettingsEventEmitter";
import {saveSettingsToLocalStorage} from "~/app/settings/SettingsUtils";

export default class SettingsContainer {
	private readonly emitter: SettingsEventEmitter = new SettingsEventEmitter();
	private readonly settingsObject: SettingsObject;

	public constructor(settingsObject: SettingsObject) {
		this.settingsObject = settingsObject;
	}

	public get(key: string): SettingsObjectEntry {
		return this.settingsObject[key];
	}

	/**
	 * @param persist When false, the change is applied and broadcast but NOT
	 * written to localStorage — used by the auto-quality governor so its
	 * transient tuning never overwrites the user's saved preferences.
	 */
	public update(key: string, value: SettingsObjectEntry, persist: boolean = true): void {
		if (!value || (value.statusValue === undefined && value.numberValue === undefined)) {
			console.error(`[Settings] Refusing to save invalid value for key "${key}":`, value);
			console.trace('[Settings] Caller of invalid update:');
			return;
		}
		this.settingsObject[key] = value;
		if (persist) {
			this.saveSettings();
		}

		this.emitter.updateSetting(key, value);
	}

	public onChange(
		key: string,
		callback: (value: SettingsObjectEntry) => void,
		isImmediate: boolean = true
	): void {
		this.emitter.onChange(key, callback);

		if (isImmediate) {
			callback(this.settingsObject[key]);
		}
	}

	public removeOnChangeListener(
		key: string,
		callback: (value: SettingsObjectEntry) => void
	): void {
		this.emitter.removeOnChangeListener(key, callback);
	}

	private saveSettings(): void {
		saveSettingsToLocalStorage(this.settingsObject);
	}
}