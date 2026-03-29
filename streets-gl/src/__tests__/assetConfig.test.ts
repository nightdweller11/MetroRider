/**
 * Tests for the asset configuration merge logic.
 * Tests the two-tier config system: server defaults + localStorage overrides.
 */

interface SoundConfig {
	horn: string;
	engine: string;
	rail: string;
	wind: string;
	brake: string;
	doorChime: string;
	stationChime: string;
}

interface AssetConfig {
	trainSlots: string[];
	trackModel: string;
	stationModel: string;
	sounds: SoundConfig;
}

function migrateToSlots(raw: any): string[] | null {
	if (Array.isArray(raw.trainSlots) && raw.trainSlots.length > 0) return raw.trainSlots;
	if (raw.trainModel || raw.locomotiveModel || raw.carCount) {
		const car = raw.trainModel || 'procedural-default';
		const loco = raw.locomotiveModel || 'procedural-default';
		const count = raw.carCount ?? 3;
		if (loco !== 'procedural-default' && loco !== car) return [loco, ...Array(count).fill(car)];
		return Array(count).fill(car);
	}
	return null;
}

const DEFAULT_SLOTS = ['procedural-default', 'procedural-default', 'procedural-default'];

function mergeConfig(serverConfig: any, userOverrides: any): AssetConfig {
	const userSlots = migrateToSlots(userOverrides);
	const serverSlots = migrateToSlots(serverConfig) || [...DEFAULT_SLOTS];
	return {
		trainSlots: userSlots || serverSlots,
		trackModel: userOverrides.trackModel || serverConfig.trackModel,
		stationModel: userOverrides.stationModel || serverConfig.stationModel,
		sounds: {
			...serverConfig.sounds,
			...(userOverrides.sounds || {}),
		},
	};
}

describe('AssetConfig merge logic (slot-based)', () => {
	const defaultServer = {
		trainSlots: ['kenney-subway-a', 'kenney-subway-a', 'kenney-subway-a'],
		trackModel: 'procedural-default',
		stationModel: 'procedural-default',
		sounds: {
			horn: 'metro-horn',
			engine: 'procedural',
			rail: 'procedural',
			wind: 'procedural',
			brake: 'procedural',
			doorChime: 'procedural',
			stationChime: 'procedural',
		},
	};

	test('no overrides -> returns server slots as-is', () => {
		const result = mergeConfig(defaultServer, {});
		expect(result.trainSlots).toEqual(['kenney-subway-a', 'kenney-subway-a', 'kenney-subway-a']);
		expect(result.trackModel).toBe('procedural-default');
		expect(result.sounds.horn).toBe('metro-horn');
	});

	test('user overrides trainSlots', () => {
		const result = mergeConfig(defaultServer, {trainSlots: ['loco-a', 'car-b', 'car-b']});
		expect(result.trainSlots).toEqual(['loco-a', 'car-b', 'car-b']);
		expect(result.trackModel).toBe('procedural-default');
	});

	test('user overrides one sound category', () => {
		const result = mergeConfig(defaultServer, {sounds: {horn: 'jp-horn'}});
		expect(result.sounds.horn).toBe('jp-horn');
		expect(result.sounds.engine).toBe('procedural');
	});

	test('user overrides multiple fields', () => {
		const result = mergeConfig(defaultServer, {
			trainSlots: ['kenney-city-a'],
			stationModel: 'procedural-default',
			sounds: {horn: 'kawasaki-horn', engine: 'some-engine'},
		});
		expect(result.trainSlots).toEqual(['kenney-city-a']);
		expect(result.stationModel).toBe('procedural-default');
		expect(result.sounds.horn).toBe('kawasaki-horn');
		expect(result.sounds.engine).toBe('some-engine');
		expect(result.sounds.rail).toBe('procedural');
	});

	test('backward compat: old trainModel+carCount migrates to slots', () => {
		const oldServer = {
			trainModel: 'subway-a',
			carCount: 4,
			trackModel: 'procedural-default',
			stationModel: 'procedural-default',
			sounds: defaultServer.sounds,
		};
		const result = mergeConfig(oldServer, {});
		expect(result.trainSlots).toEqual(['subway-a', 'subway-a', 'subway-a', 'subway-a']);
	});

	test('backward compat: old locomotiveModel+trainModel migrates to slots', () => {
		const oldServer = {
			trainModel: 'passenger-a',
			locomotiveModel: 'loco-sd40',
			carCount: 2,
			trackModel: 'procedural-default',
			stationModel: 'procedural-default',
			sounds: defaultServer.sounds,
		};
		const result = mergeConfig(oldServer, {});
		expect(result.trainSlots).toEqual(['loco-sd40', 'passenger-a', 'passenger-a']);
	});
});
