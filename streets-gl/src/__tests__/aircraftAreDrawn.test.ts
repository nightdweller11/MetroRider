import {readFileSync} from 'fs';
import {join} from 'path';

/**
 * Aeroplanes tracked but never drawn.
 *
 * Air traffic was switched off upstream in FIVE separate places — the
 * resource loader skipped the models, the texture pool skipped the texture,
 * the scene never registered the parts, the settings listener was commented
 * out, and the feed it read went empty — and every one of those leaves a
 * system that is perfectly correct in isolation and a sky with nothing in it.
 * Turning four of them back on still drew nothing a player could see, because
 * the generated samples began at "now" while the system draws twenty seconds
 * behind the clock: every aeroplane sat parked on its last sample and leapt a
 * whole interval's flight each update.
 *
 * So two things are pinned here. The behaviour: the vehicle system, fed by
 * the sky generator, puts aircraft into the per-part instance buffers the
 * renderer reads, near the player, MOVING smoothly between updates. And the
 * wiring: every switch that once cut that chain off is still on, and the pass
 * still reads those buffers and draws them.
 */

jest.mock('~/app/systems/SettingsSystem', () => ({__esModule: true, default: class SettingsSystem {}}));
jest.mock('~/app/systems/TerrainSystem', () => ({__esModule: true, default: class TerrainSystem {}}));
jest.mock('~/app/systems/SceneSystem', () => ({__esModule: true, default: class SceneSystem {}}));

/* eslint-disable @typescript-eslint/no-var-requires */
const SettingsSystem = require('~/app/systems/SettingsSystem').default;
const TerrainSystem = require('~/app/systems/TerrainSystem').default;
const SceneSystem = require('~/app/systems/SceneSystem').default;
const VehicleSystem = require('~/app/systems/VehicleSystem').default;
const Vec2 = require('~/lib/math/Vec2').default;
/* eslint-enable @typescript-eslint/no-var-requires */

// Somewhere over Tel Aviv, in the engine's world metres (x north, z east).
const CAMERA = {x: 3785670, y: 90, z: 3885212};

function makeSystem(status: 'on' | 'off' = 'on'): {
	vs: InstanceType<typeof VehicleSystem>;
	setStatus: (s: 'on' | 'off') => void;
} {
	let listener: ((v: {statusValue: string}) => void) | null = null;
	const settings = {
		onChange: (key: string, fn: (v: {statusValue: string}) => void, immediate: boolean): void => {
			if (key !== 'airTraffic') return;
			listener = fn;
			if (immediate) fn({statusValue: status});
		},
	};
	const systems = new Map<unknown, unknown>([
		[SettingsSystem, {settings}],
		[TerrainSystem, {terrainHeightProvider: {getHeightGlobalInterpolated: (): number => 30}}],
		[SceneSystem, {objects: {camera: {
			position: {...CAMERA},
			// Identity: looking down -z.
			matrix: {values: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]},
		}}}],
	]);
	const vs = new VehicleSystem();

	vs.systemManager = {getSystem: (t: unknown) => systems.get(t)};

	// postInit also starts a timer and a key listener; only the settings
	// wiring matters here, and it is the one that was commented out.
	(vs as unknown as {listenToSettings: () => void}).listenToSettings();

	return {vs, setStatus: (s): void => listener?.({statusValue: s})};
}

function frame(vs: InstanceType<typeof VehicleSystem>): Map<number, Float32Array> {
	vs.update(16);
	vs.updateBuffers(new Vec2(Math.floor(CAMERA.x / 10000) * 10000, Math.floor(CAMERA.z / 10000) * 10000));

	return vs.aircraftPartsBuffers;
}

describe('aircraft reach the instance buffers the renderer draws', () => {
	let now = 1_800_000_000_000;

	beforeEach(() => {
		jest.spyOn(Date, 'now').mockImplementation(() => now);
		(globalThis as unknown as {window: unknown}).window = globalThis;
	});

	afterEach(() => jest.restoreAllMocks());

	test('switched on, the sky has aircraft in it, in instance buffers, near the player', async () => {
		const {vs} = makeSystem('on');

		await vs.fetchData();

		const buffers = frame(vs);
		let instances = 0;

		for (const buffer of buffers.values()) {
			expect(buffer.length % 6).toBe(0);
			instances += buffer.length / 6;

			for (let i = 0; i < buffer.length; i += 6) {
				// Relative to the instance origin, so within a few tens of km.
				expect(Math.abs(buffer[i])).toBeLessThan(80000);
				expect(Math.abs(buffer[i + 2])).toBeLessThan(80000);
				// In the air, not under the ground and not in orbit.
				expect(buffer[i + 1]).toBeGreaterThan(250);
				expect(buffer[i + 1]).toBeLessThan(16000);
			}
		}

		expect(instances).toBeGreaterThanOrEqual(5);
	});

	test('between updates they FLY — no parking on the last sample', async () => {
		const {vs} = makeSystem('on');

		await vs.fetchData();

		const positions = (): number[][] => {
			const out: number[][] = [];
			for (const buffer of frame(vs).values()) {
				for (let i = 0; i < buffer.length; i += 6) out.push([buffer[i], buffer[i + 1], buffer[i + 2]]);
			}
			return out;
		};

		const a = positions();
		now += 1000;
		const b = positions();
		now += 1000;
		const c = positions();

		expect(a.length).toBe(b.length);

		for (let i = 0; i < a.length; i++) {
			const step1 = Math.hypot(b[i][0] - a[i][0], b[i][2] - a[i][2]);
			const step2 = Math.hypot(c[i][0] - b[i][0], c[i][2] - b[i][2]);

			// 250 km/h at the slowest; the mercator-scaled world stretches a bit.
			expect(step1).toBeGreaterThan(60);
			expect(step1).toBeLessThan(400);
			expect(step2).toBeCloseTo(step1, -1);
		}
	});

	test('the next update continues the track instead of jumping it', async () => {
		const {vs} = makeSystem('on');

		await vs.fetchData();

		const before = [...frame(vs).values()].map(b => Array.from(b));

		await vs.fetchData();

		const after = [...frame(vs).values()].map(b => Array.from(b));

		expect(after).toEqual(before);
	});

	test('switched off, the sky empties at once', async () => {
		const {vs, setStatus} = makeSystem('on');

		await vs.fetchData();
		expect(frame(vs).size).toBeGreaterThan(0);

		setStatus('off');

		expect(frame(vs).size).toBe(0);
	});
});

describe('every switch that once cut air traffic off is on', () => {
	const src = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8')
		// Commented-out code is the exact failure: strip comments before looking.
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^\s*\/\/.*$/gm, '');

	test('the resource loader loads the aircraft models and textures', () => {
		expect(src('app/world/ResourceLoader.ts')).not.toMatch(/startsWith\(['"]aircraft['"]\)/);
	});

	test('the texture pool builds the aircraft texture', () => {
		expect(src('app/render/TexturePool.ts')).toMatch(/textures\.set\(['"]aircraft['"]/);
	});

	test('the scene registers every aircraft part and puts it in the scene graph', () => {
		const scene = src('app/systems/SceneSystem.ts');

		for (const part of [
			'B777Body', 'A321Body', 'Cessna208Body', 'ERJ135Body', 'HelicopterBody',
			'HelicopterRotorSpinning', 'HelicopterRotorStatic',
			'HelicopterTailRotorSpinning', 'HelicopterTailRotorStatic',
		]) {
			expect(scene).toContain(`AircraftPartType.${part}`);
		}

		// In the wrapper, so RenderSystem's walk builds each part's mesh.
		expect(scene).toMatch(/\.\.\.this\.objects\.instancedAircraftParts\.values\(\)/);
	});

	test('the vehicle system listens to the Aeroplanes setting', () => {
		expect(src('app/systems/VehicleSystem.ts')).toMatch(/onChange\(['"]airTraffic['"]/);
	});

	test('the G-buffer pass draws what the vehicle system buffers', () => {
		const pass = src('app/render/passes/GBufferPass.ts');

		expect(pass).toMatch(/this\.renderAircraft\(/);
		expect(pass).toMatch(/vehicleSystem\.updateBuffers\(/);
		expect(pass).toMatch(/aircraftPartsBuffers/);
		expect(pass).toMatch(/object\.mesh\.draw\(\)/);
	});
});
