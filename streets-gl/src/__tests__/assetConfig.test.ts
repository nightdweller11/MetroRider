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
	trainModel: string;
	trackModel: string;
	stationModel: string;
	sounds: SoundConfig;
}

function mergeConfig(serverConfig: AssetConfig, userOverrides: Partial<AssetConfig>): AssetConfig {
	return {
		trainModel: (userOverrides as any).trainModel || serverConfig.trainModel,
		trackModel: (userOverrides as any).trackModel || serverConfig.trackModel,
		stationModel: (userOverrides as any).stationModel || serverConfig.stationModel,
		sounds: {
			...serverConfig.sounds,
			...((userOverrides as any).sounds || {}),
		},
	};
}

describe('AssetConfig merge logic', () => {
	const defaultServer: AssetConfig = {
		trainModel: 'kenney-subway-a',
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

	test('no overrides -> returns server config as-is', () => {
		const result = mergeConfig(defaultServer, {});
		expect(result.trainModel).toBe('kenney-subway-a');
		expect(result.trackModel).toBe('procedural-default');
		expect(result.sounds.horn).toBe('metro-horn');
	});

	test('user overrides trainModel', () => {
		const result = mergeConfig(defaultServer, {trainModel: 'kenney-bullet-a'});
		expect(result.trainModel).toBe('kenney-bullet-a');
		expect(result.trackModel).toBe('procedural-default');
		expect(result.sounds.horn).toBe('metro-horn');
	});

	test('user overrides one sound category', () => {
		const result = mergeConfig(defaultServer, {sounds: {horn: 'jp-horn'} as any});
		expect(result.sounds.horn).toBe('jp-horn');
		expect(result.sounds.engine).toBe('procedural');
	});

	test('user overrides multiple fields', () => {
		const result = mergeConfig(defaultServer, {
			trainModel: 'kenney-city-a',
			stationModel: 'procedural-default',
			sounds: {horn: 'kawasaki-horn', engine: 'some-engine'} as any,
		});
		expect(result.trainModel).toBe('kenney-city-a');
		expect(result.stationModel).toBe('procedural-default');
		expect(result.sounds.horn).toBe('kawasaki-horn');
		expect(result.sounds.engine).toBe('some-engine');
		expect(result.sounds.rail).toBe('procedural');
	});

	test('empty strings are treated as falsy (falls back to server)', () => {
		const result = mergeConfig(defaultServer, {trainModel: ''});
		expect(result.trainModel).toBe('kenney-subway-a');
	});
});
