import {
	fetchSettingsFromLocalStorage,
	saveSettingsToLocalStorage,
	makeSettingsMatchSchema,
} from '~/app/settings/SettingsUtils';
import {SettingsObject, SettingsObjectEntry} from '~/app/settings/SettingsObject';
import {SettingsSchema} from '~/app/settings/SettingsSchema';
import SettingsContainer from '~/app/settings/SettingsContainer';
import SettingsStorageDecorator from '~/app/settings/SettingsStorageDecorator';
import SettingsEventEmitter from '~/app/settings/SettingsEventEmitter';

const TEST_SCHEMA: SettingsSchema = {
	shadows: {
		label: 'Shadows',
		status: ['off', 'low', 'medium', 'high'],
		statusLabels: ['Disabled', 'Low', 'Medium', 'High'],
		statusDefault: 'medium',
		category: 'graphics',
	},
	taa: {
		label: 'TAA',
		status: ['off', 'on'],
		statusLabels: ['Disabled', 'Enabled'],
		statusDefault: 'on',
		category: 'graphics',
	},
	bloom: {
		label: 'Bloom',
		status: ['off', 'on'],
		statusLabels: ['Disabled', 'Enabled'],
		statusDefault: 'on',
		category: 'graphics',
	},
	fov: {
		label: 'FOV',
		selectRange: [5, 120, 1],
		selectRangeDefault: 40,
		category: 'general',
	},
	performanceMode: {
		label: 'Performance mode',
		status: ['off', 'on'],
		statusLabels: ['Standard', 'Low memory'],
		statusDefault: 'off',
		category: 'general',
	},
};

// Mock localStorage
const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: jest.fn((key: string) => store[key] ?? null),
		setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
		removeItem: jest.fn((key: string) => { delete store[key]; }),
		clear: jest.fn(() => { store = {}; }),
		get _store() { return store; },
	};
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// Mock document.cookie for cookie fallback
let cookieStore = '';
if (typeof document === 'undefined') {
	(global as any).document = {};
}
Object.defineProperty(document, 'cookie', {
	get: () => cookieStore,
	set: (val: string) => {
		const eqIdx = val.indexOf('=');
		const scIdx = val.indexOf(';');
		const name = val.substring(0, eqIdx);
		const value = scIdx > -1 ? val.substring(eqIdx + 1, scIdx) : val.substring(eqIdx + 1);
		const existing = cookieStore.split('; ').filter(c => c && !c.startsWith(name + '='));
		existing.push(`${name}=${value}`);
		cookieStore = existing.join('; ');
	},
	configurable: true,
});

beforeEach(() => {
	localStorageMock.clear();
	cookieStore = '';
	jest.clearAllMocks();
});

describe('saveSettingsToLocalStorage / fetchSettingsFromLocalStorage round-trip', () => {
	test('saves and loads settings correctly', () => {
		const settings: SettingsObject = {
			shadows: {statusValue: 'high'},
			taa: {statusValue: 'off'},
			fov: {numberValue: 90},
		};

		saveSettingsToLocalStorage(settings);

		expect(localStorageMock.setItem).toHaveBeenCalledWith('settings', JSON.stringify(settings));

		const loaded = fetchSettingsFromLocalStorage();
		expect(loaded).toEqual(settings);
	});

	test('returns empty object when localStorage is empty', () => {
		const loaded = fetchSettingsFromLocalStorage();
		expect(loaded).toEqual({});
	});

	test('returns empty object on corrupt JSON', () => {
		localStorageMock.setItem('settings', '{broken json!!!');
		const loaded = fetchSettingsFromLocalStorage();
		expect(loaded).toEqual({});
	});

	test('preserves all setting keys through round-trip', () => {
		const settings: SettingsObject = {
			shadows: {statusValue: 'low'},
			taa: {statusValue: 'on'},
			bloom: {statusValue: 'off'},
			fov: {numberValue: 75},
			performanceMode: {statusValue: 'on'},
		};

		saveSettingsToLocalStorage(settings);
		const loaded = fetchSettingsFromLocalStorage();

		expect(loaded.shadows.statusValue).toBe('low');
		expect(loaded.taa.statusValue).toBe('on');
		expect(loaded.bloom.statusValue).toBe('off');
		expect(loaded.fov.numberValue).toBe(75);
		expect(loaded.performanceMode.statusValue).toBe('on');
	});
});

describe('makeSettingsMatchSchema', () => {
	test('uses stored values when they are valid', () => {
		const stored = {
			shadows: {statusValue: 'high'},
			taa: {statusValue: 'off'},
			bloom: {statusValue: 'off'},
			fov: {numberValue: 90},
			performanceMode: {statusValue: 'on'},
		};

		const result = makeSettingsMatchSchema(stored, TEST_SCHEMA);

		expect(result.shadows.statusValue).toBe('high');
		expect(result.taa.statusValue).toBe('off');
		expect(result.bloom.statusValue).toBe('off');
		expect(result.fov.numberValue).toBe(90);
		expect(result.performanceMode.statusValue).toBe('on');
	});

	test('falls back to defaults for missing keys', () => {
		const stored = {};

		const result = makeSettingsMatchSchema(stored, TEST_SCHEMA);

		expect(result.shadows.statusValue).toBe('medium');
		expect(result.taa.statusValue).toBe('on');
		expect(result.bloom.statusValue).toBe('on');
		expect(result.fov.numberValue).toBe(40);
		expect(result.performanceMode.statusValue).toBe('off');
	});

	test('falls back to defaults for invalid status values', () => {
		const stored = {
			shadows: {statusValue: 'ultra'},
			taa: {statusValue: 'broken'},
		};

		const result = makeSettingsMatchSchema(stored, TEST_SCHEMA);

		expect(result.shadows.statusValue).toBe('medium');
		expect(result.taa.statusValue).toBe('on');
	});

	test('falls back to defaults for out-of-range number values', () => {
		const stored = {
			fov: {numberValue: 999},
		};

		const result = makeSettingsMatchSchema(stored, TEST_SCHEMA);

		expect(result.fov.numberValue).toBe(40);
	});

	test('falls back to defaults when statusValue is undefined', () => {
		const stored = {
			shadows: {},
		};

		const result = makeSettingsMatchSchema(stored, TEST_SCHEMA);

		expect(result.shadows.statusValue).toBe('medium');
	});

	test('preserves non-default values through full pipeline', () => {
		const original: SettingsObject = {
			shadows: {statusValue: 'high'},
			taa: {statusValue: 'off'},
			bloom: {statusValue: 'off'},
			fov: {numberValue: 90},
			performanceMode: {statusValue: 'on'},
		};

		saveSettingsToLocalStorage(original);
		const loaded = fetchSettingsFromLocalStorage();
		const result = makeSettingsMatchSchema(loaded, TEST_SCHEMA);

		expect(result.shadows.statusValue).toBe('high');
		expect(result.taa.statusValue).toBe('off');
		expect(result.bloom.statusValue).toBe('off');
		expect(result.fov.numberValue).toBe(90);
		expect(result.performanceMode.statusValue).toBe('on');
	});
});

describe('SettingsContainer', () => {
	test('update() saves to localStorage', () => {
		const initial = makeSettingsMatchSchema({}, TEST_SCHEMA);
		const container = new SettingsContainer(initial);

		expect(container.get('shadows').statusValue).toBe('medium');

		container.update('shadows', {statusValue: 'high'});

		expect(container.get('shadows').statusValue).toBe('high');

		const stored = JSON.parse(localStorageMock._store['settings']);
		expect(stored.shadows.statusValue).toBe('high');
	});

	test('update() notifies listeners', () => {
		const initial = makeSettingsMatchSchema({}, TEST_SCHEMA);
		const container = new SettingsContainer(initial);
		const listener = jest.fn();

		container.onChange('shadows', listener, false);
		container.update('shadows', {statusValue: 'low'});

		expect(listener).toHaveBeenCalledWith({statusValue: 'low'});
	});

	test('onChange with isImmediate fires immediately with current value', () => {
		const initial = makeSettingsMatchSchema({}, TEST_SCHEMA);
		const container = new SettingsContainer(initial);
		const listener = jest.fn();

		container.onChange('shadows', listener, true);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({statusValue: 'medium'});
	});

	test('multiple updates save the latest value', () => {
		const initial = makeSettingsMatchSchema({}, TEST_SCHEMA);
		const container = new SettingsContainer(initial);

		container.update('shadows', {statusValue: 'low'});
		container.update('shadows', {statusValue: 'high'});
		container.update('shadows', {statusValue: 'off'});

		expect(container.get('shadows').statusValue).toBe('off');

		const stored = JSON.parse(localStorageMock._store['settings']);
		expect(stored.shadows.statusValue).toBe('off');
	});

	test('updating one key does not corrupt other keys', () => {
		const initial = makeSettingsMatchSchema({}, TEST_SCHEMA);
		const container = new SettingsContainer(initial);

		container.update('shadows', {statusValue: 'high'});

		expect(container.get('taa').statusValue).toBe('on');
		expect(container.get('bloom').statusValue).toBe('on');
		expect(container.get('fov').numberValue).toBe(40);

		const stored = JSON.parse(localStorageMock._store['settings']);
		expect(stored.taa.statusValue).toBe('on');
		expect(stored.bloom.statusValue).toBe('on');
		expect(stored.fov.numberValue).toBe(40);
	});
});

describe('SettingsStorageDecorator', () => {
	test('setStateFieldValue triggers localStorage save', () => {
		const initial = makeSettingsMatchSchema({}, TEST_SCHEMA);
		const container = new SettingsContainer(initial);
		const decorator = new SettingsStorageDecorator(container);

		decorator.setStateFieldValue('shadows', {statusValue: 'high'});

		expect(container.get('shadows').statusValue).toBe('high');

		const stored = JSON.parse(localStorageMock._store['settings']);
		expect(stored.shadows.statusValue).toBe('high');
	});

	test('getStateFieldValue returns current value from container', () => {
		const initial = makeSettingsMatchSchema({}, TEST_SCHEMA);
		const container = new SettingsContainer(initial);
		const decorator = new SettingsStorageDecorator(container);

		container.update('taa', {statusValue: 'off'});
		const value = decorator.getStateFieldValue('taa');

		expect(value.statusValue).toBe('off');
	});

	test('addStateFieldListener immediately fires with current value', () => {
		const initial = makeSettingsMatchSchema({}, TEST_SCHEMA);
		const container = new SettingsContainer(initial);
		const decorator = new SettingsStorageDecorator(container);
		const listener = jest.fn();

		decorator.addStateFieldListener('shadows', listener);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({statusValue: 'medium'});
	});

	test('removeStateFieldListener stops notifications', () => {
		const initial = makeSettingsMatchSchema({}, TEST_SCHEMA);
		const container = new SettingsContainer(initial);
		const decorator = new SettingsStorageDecorator(container);
		const listener = jest.fn();

		decorator.addStateFieldListener('shadows', listener);
		listener.mockClear();

		decorator.removeStateFieldListener('shadows', listener);
		container.update('shadows', {statusValue: 'high'});

		expect(listener).not.toHaveBeenCalled();
	});
});

describe('Full persistence pipeline: simulates page reload', () => {
	test('settings survive simulated reload', () => {
		// --- Session 1: user changes settings ---
		const stored1 = fetchSettingsFromLocalStorage();
		const matched1 = makeSettingsMatchSchema(stored1, TEST_SCHEMA);
		const container1 = new SettingsContainer(matched1);
		const decorator1 = new SettingsStorageDecorator(container1);

		expect(container1.get('shadows').statusValue).toBe('medium');
		expect(container1.get('taa').statusValue).toBe('on');

		decorator1.setStateFieldValue('shadows', {statusValue: 'high'});
		decorator1.setStateFieldValue('taa', {statusValue: 'off'});
		decorator1.setStateFieldValue('bloom', {statusValue: 'off'});
		decorator1.setStateFieldValue('fov', {numberValue: 90});

		// --- Session 2: page reload (new instances, same localStorage) ---
		const stored2 = fetchSettingsFromLocalStorage();
		const matched2 = makeSettingsMatchSchema(stored2, TEST_SCHEMA);
		const container2 = new SettingsContainer(matched2);

		expect(container2.get('shadows').statusValue).toBe('high');
		expect(container2.get('taa').statusValue).toBe('off');
		expect(container2.get('bloom').statusValue).toBe('off');
		expect(container2.get('fov').numberValue).toBe(90);
		expect(container2.get('performanceMode').statusValue).toBe('off');
	});

	test('decorator addStateFieldListener does NOT overwrite with defaults', () => {
		// Pre-populate localStorage with non-default values
		saveSettingsToLocalStorage({
			shadows: {statusValue: 'high'},
			taa: {statusValue: 'off'},
			bloom: {statusValue: 'off'},
			fov: {numberValue: 90},
			performanceMode: {statusValue: 'on'},
		});

		// Simulate app init
		const stored = fetchSettingsFromLocalStorage();
		const matched = makeSettingsMatchSchema(stored, TEST_SCHEMA);
		const container = new SettingsContainer(matched);
		const decorator = new SettingsStorageDecorator(container);

		// Simulate bidirectionalSyncEffect: addStateFieldListener fires immediately
		const listeners: Record<string, jest.Mock> = {};
		for (const key of Object.keys(TEST_SCHEMA)) {
			listeners[key] = jest.fn();
			decorator.addStateFieldListener(key, listeners[key]);
		}

		// Verify the immediate callback received the STORED values, not defaults
		expect(listeners['shadows']).toHaveBeenCalledWith({statusValue: 'high'});
		expect(listeners['taa']).toHaveBeenCalledWith({statusValue: 'off'});
		expect(listeners['bloom']).toHaveBeenCalledWith({statusValue: 'off'});
		expect(listeners['fov']).toHaveBeenCalledWith({numberValue: 90});
		expect(listeners['performanceMode']).toHaveBeenCalledWith({statusValue: 'on'});

		// Verify localStorage was NOT overwritten during this process
		const finalStored = JSON.parse(localStorageMock._store['settings']);
		expect(finalStored.shadows.statusValue).toBe('high');
		expect(finalStored.taa.statusValue).toBe('off');
		expect(finalStored.bloom.statusValue).toBe('off');
	});

	test('simulated bidirectionalSyncEffect write-back does not corrupt', () => {
		// Pre-populate with non-default values
		saveSettingsToLocalStorage({
			shadows: {statusValue: 'low'},
			taa: {statusValue: 'off'},
			bloom: {statusValue: 'on'},
			fov: {numberValue: 60},
			performanceMode: {statusValue: 'off'},
		});

		const stored = fetchSettingsFromLocalStorage();
		const matched = makeSettingsMatchSchema(stored, TEST_SCHEMA);
		const container = new SettingsContainer(matched);
		const decorator = new SettingsStorageDecorator(container);

		// Simulate what bidirectionalSyncEffect does:
		// 1. getStateFieldValue (trigger='get')
		const initialValue = decorator.getStateFieldValue('shadows');
		expect(initialValue.statusValue).toBe('low');

		// 2. Simulate Recoil onSet writing back the SAME value
		//    (this happens if setSelf triggers onSet)
		decorator.setStateFieldValue('shadows', initialValue);

		// 3. Verify value is still correct
		expect(container.get('shadows').statusValue).toBe('low');
		const afterWriteBack = JSON.parse(localStorageMock._store['settings']);
		expect(afterWriteBack.shadows.statusValue).toBe('low');

		// 4. Simulate user changing the value via Recoil
		decorator.setStateFieldValue('shadows', {statusValue: 'high'});

		expect(container.get('shadows').statusValue).toBe('high');
		const afterUserChange = JSON.parse(localStorageMock._store['settings']);
		expect(afterUserChange.shadows.statusValue).toBe('high');

		// 5. Other keys should be unaffected
		expect(afterUserChange.taa.statusValue).toBe('off');
		expect(afterUserChange.fov.numberValue).toBe(60);
	});
});

describe('SettingsEventEmitter edge cases', () => {
	test('removing a listener that was never added is a no-op', () => {
		const emitter = new SettingsEventEmitter();
		const fn = jest.fn();
		emitter.removeOnChangeListener('nonexistent', fn);
	});

	test('removing wrong function reference is a no-op', () => {
		const emitter = new SettingsEventEmitter();
		const fn1 = jest.fn();
		const fn2 = jest.fn();

		emitter.onChange('key', fn1);
		emitter.removeOnChangeListener('key', fn2);

		emitter.updateSetting('key', {statusValue: 'test'});
		expect(fn1).toHaveBeenCalled();
	});

	test('listener is not called after removal', () => {
		const emitter = new SettingsEventEmitter();
		const fn = jest.fn();

		emitter.onChange('key', fn);
		emitter.removeOnChangeListener('key', fn);
		emitter.updateSetting('key', {statusValue: 'test'});

		expect(fn).not.toHaveBeenCalled();
	});
});

describe('Direct action flow (bypasses Recoil onSet)', () => {
	test('actions.updateSetting writes to container and localStorage', () => {
		const initial = makeSettingsMatchSchema({}, TEST_SCHEMA);
		const container = new SettingsContainer(initial);

		expect(container.get('shadows').statusValue).toBe('medium');

		// Simulate what actions.updateSetting does
		container.update('shadows', {statusValue: 'high'});

		// Verify container updated
		expect(container.get('shadows').statusValue).toBe('high');

		// Verify localStorage updated
		const stored = JSON.parse(localStorageMock._store['settings']);
		expect(stored.shadows.statusValue).toBe('high');
	});

	test('container.update triggers listeners (simulates Recoil setSelf)', () => {
		const initial = makeSettingsMatchSchema({}, TEST_SCHEMA);
		const container = new SettingsContainer(initial);
		const decorator = new SettingsStorageDecorator(container);

		const recoilSetSelf = jest.fn();
		decorator.addStateFieldListener('shadows', recoilSetSelf);
		recoilSetSelf.mockClear();

		// Simulate actions.updateSetting -> container.update
		container.update('shadows', {statusValue: 'low'});

		// Verify the listener was called (this is what would update the Recoil atom)
		expect(recoilSetSelf).toHaveBeenCalledWith({statusValue: 'low'});

		// Verify localStorage was saved
		const stored = JSON.parse(localStorageMock._store['settings']);
		expect(stored.shadows.statusValue).toBe('low');
	});

	test('full cycle: action -> container -> localStorage -> reload -> restore', () => {
		// Session 1: init + user changes settings via action
		const stored1 = fetchSettingsFromLocalStorage();
		const matched1 = makeSettingsMatchSchema(stored1, TEST_SCHEMA);
		const container1 = new SettingsContainer(matched1);

		container1.update('shadows', {statusValue: 'high'});
		container1.update('taa', {statusValue: 'off'});
		container1.update('fov', {numberValue: 90});

		// Session 2: page reload
		const stored2 = fetchSettingsFromLocalStorage();
		const matched2 = makeSettingsMatchSchema(stored2, TEST_SCHEMA);
		const container2 = new SettingsContainer(matched2);

		expect(container2.get('shadows').statusValue).toBe('high');
		expect(container2.get('taa').statusValue).toBe('off');
		expect(container2.get('fov').numberValue).toBe(90);
	});
});

describe('localStorage key isolation', () => {
	test('settings key does not interfere with other keys', () => {
		localStorageMock.setItem('otherKey', 'otherValue');

		const settings: SettingsObject = {
			shadows: {statusValue: 'high'},
		};
		saveSettingsToLocalStorage(settings);

		expect(localStorageMock.getItem('otherKey')).toBe('otherValue');
		expect(localStorageMock.getItem('settings')).toBe(JSON.stringify(settings));
	});

	test('useOverpassForBuildings persists independently', () => {
		localStorageMock.setItem('useOverpassForBuildings', 'true');

		const settings: SettingsObject = {
			shadows: {statusValue: 'high'},
		};
		saveSettingsToLocalStorage(settings);

		expect(localStorageMock.getItem('useOverpassForBuildings')).toBe('true');
		expect(JSON.parse(localStorageMock.getItem('settings')!).shadows.statusValue).toBe('high');
	});
});
