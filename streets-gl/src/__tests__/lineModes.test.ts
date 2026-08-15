import {
	parseLineMode, lineModeInfo, inferLineMode, type LineMode,
} from '../app/game/data/LineModes';
import {buildSpeedProfile} from '../app/game/limits/SpeedProfile';
import {createTrainPhysicsState, updateTrainPhysics} from '../app/game/physics/TrainPhysics';

/**
 * The mode keys here are not invented: they were read off three published
 * MetroDreamin maps before this module was written (London Underground, a
 * large all-modes US map, SEPTA Regional Rail). Between them they used
 * BUS, TRAM, LIGHT, RAPID, REGIONAL, HSR, FERRY, GONDOLA, AIR — and left the
 * field absent on 30 of London's 56 lines.
 */
describe('parseLineMode — the keys real maps actually use', () => {
	const cases: [string, LineMode][] = [
		['BUS', 'bus'],
		['TRAM', 'tram'],
		['LIGHT', 'light'],
		['RAPID', 'rapid'],
		['REGIONAL', 'regional'],
		['HSR', 'hsr'],
		['FERRY', 'ferry'],
		['GONDOLA', 'gondola'],
		['AIR', 'air'],
	];

	test.each(cases)('%s reads as %s', (raw, expected) => {
		expect(parseLineMode(raw)).toBe(expected);
	});

	it('treats an absent mode as a metro, which is what those lines are', () => {
		// 30 of London Underground's lines carry no mode at all, and they are
		// the Underground lines themselves.
		expect(parseLineMode(undefined)).toBe('rapid');
		expect(parseLineMode(null)).toBe('rapid');
		expect(parseLineMode('')).toBe('rapid');
	});

	it('does not throw on a key it has never seen', () => {
		expect(parseLineMode('MONORAIL')).toBe('rapid');
		expect(parseLineMode('  hsr  ')).toBe('hsr');
	});
});

describe('lineModeInfo', () => {
	it('gives every mode a top speed above its floor', () => {
		const modes: LineMode[] = [
			'bus', 'tram', 'light', 'rapid', 'regional', 'hsr', 'ferry', 'gondola', 'air',
		];

		for (const mode of modes) {
			const info = lineModeInfo(mode);

			expect(info.floorKmh).toBeLessThan(info.topKmh);
			expect(info.label.length).toBeGreaterThan(0);
			expect(info.icon.length).toBeGreaterThan(0);
			expect(info.dwellSec).toBeGreaterThan(0);
		}
	});

	it('orders the modes by speed the way the real services are', () => {
		expect(lineModeInfo('bus').topKmh).toBeLessThan(lineModeInfo('tram').topKmh);
		expect(lineModeInfo('tram').topKmh).toBeLessThan(lineModeInfo('rapid').topKmh);
		expect(lineModeInfo('rapid').topKmh).toBeLessThan(lineModeInfo('regional').topKmh);
		expect(lineModeInfo('regional').topKmh).toBeLessThan(lineModeInfo('hsr').topKmh);
	});

	it('falls back rather than returning undefined for a missing mode', () => {
		expect(lineModeInfo(undefined).label).toBe('Metro');
	});

	it('gives a rail service a SET of cars rather than one', () => {
		expect(lineModeInfo('rapid').consist.length).toBeGreaterThan(1);
		expect(lineModeInfo('hsr').consist.length).toBeGreaterThan(1);
		expect(lineModeInfo('regional').consist.length).toBeGreaterThan(1);
	});

	it('runs a boat on a ferry, not a train', () => {
		// The catalog has no boat, so the game builds one: waiting for a model
		// left the mode with nothing to run, and a train on the water is worse
		// than either.
		expect(lineModeInfo('ferry').consist).toEqual(['procedural-ferry']);
	});

	it('still states no opinion where there is genuinely nothing to run', () => {
		// No aircraft, procedural or otherwise. Leaving the player's own choice
		// alone beats flying a boat.
		expect(lineModeInfo('air').consist).toEqual([]);
	});

	it('gives a bus ONE vehicle — a three-car bus would be a road train', () => {
		expect(lineModeInfo('bus').consist).toEqual(['generic-town-bus']);
	});

	it('only names models that are actually in the shipped catalog', () => {
		// A mode naming a model that does not exist would render grey boxes.
		const catalog: {models: {trains: {id: string}[]}} =
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			require('../../data-seed/assets/catalog.json');
		// Procedural vehicles are built in code and are never in the catalog;
		// TrainRenderingSystem knows them by these ids.
		const procedural = new Set(['procedural-default', 'procedural-ferry']);
		const known = new Set([...catalog.models.trains.map(e => e.id), ...procedural]);
		const modes: LineMode[] = [
			'bus', 'tram', 'light', 'rapid', 'regional', 'hsr', 'ferry', 'gondola', 'air',
		];

		for (const mode of modes) {
			for (const id of lineModeInfo(mode).consist) {
				expect(known.has(id)).toBe(true);
			}
		}
	});
});

describe('inferLineMode — the fallback for maps with no modes', () => {
	it('reads the name when the name says', () => {
		expect(inferLineMode('Ferry to the island', 8000, 4)).toBe('ferry');
		expect(inferLineMode('Bus 42', 8000, 20)).toBe('bus');
		expect(inferLineMode('Tram 8', 8000, 20)).toBe('tram');
		expect(inferLineMode('Docklands Light Rail', 20000, 20)).toBe('light');
	});

	it('reads station spacing when the name says nothing', () => {
		// 400 m apart is a tram; 1.2 km is a metro; 5 km is a main line.
		expect(inferLineMode('Green', 4000, 11)).toBe('tram');
		expect(inferLineMode('Green', 12000, 11)).toBe('rapid');
		expect(inferLineMode('Green', 50000, 11)).toBe('regional');
	});
});

/**
 * The point of the whole feature: a bus route drives like a bus route.
 *
 * This is the defect it fixes — a town-centre bus route has metro-like station
 * spacing, so before the mode was threaded through it was posted at the metro
 * ceiling and driven at 90 km/h.
 */
describe('mode caps what the speed profile posts', () => {
	/** A gently curving line, ~5 km, points every 50 m. */
	const points = Array.from({length: 100}, (_, i) => ({
		x: i * 50,
		y: Math.sin(i / 30) * 400,
	}));
	const cumDist = points.map((_, i) => i * 50);

	function profileFor(mode: LineMode): number[] {
		const info = lineModeInfo(mode);

		return buildSpeedProfile(points, cumDist, false, {
			lineMax: info.topKmh / 3.6,
			floor: Math.min(info.floorKmh, info.topKmh) / 3.6,
		}).map(s => s.limit * 3.6);
	}

	it('never posts a bus above bus speed', () => {
		const limits = profileFor('bus');

		expect(limits.length).toBeGreaterThan(0);
		expect(Math.max(...limits)).toBeLessThanOrEqual(lineModeInfo('bus').topKmh);
	});

	it('posts the same track faster for a train than for a bus', () => {
		const bus = Math.max(...profileFor('bus'));
		const regional = Math.max(...profileFor('regional'));

		expect(regional).toBeGreaterThan(bus);
	});

	it('keeps the floor below the ceiling, so no stop is posted above the line max', () => {
		// The profile's default floor is 40 km/h — ABOVE a bus route's 50 only
		// by a little, but above a cable car's 25 outright. Left at the default
		// a gondola would have been posted faster than it can go.
		for (const mode of ['bus', 'gondola', 'ferry'] as LineMode[]) {
			const limits = profileFor(mode);

			expect(Math.max(...limits)).toBeLessThanOrEqual(lineModeInfo(mode).topKmh);
		}
	});
});

/**
 * Modes must FEEL different, not just stop at different numbers.
 *
 * Before this, every mode reached its own top speed at exactly the same rate,
 * so the only difference between driving a tram and driving a bullet train was
 * where the needle stopped.
 */
describe('how a mode pulls away and stops', () => {
	const modes: LineMode[] = [
		'bus', 'tram', 'light', 'rapid', 'regional', 'hsr', 'ferry', 'gondola', 'air',
	];

	it('gives every mode a positive pull and a positive brake', () => {
		for (const mode of modes) {
			const info = lineModeInfo(mode);

			expect(info.accelScale).toBeGreaterThan(0);
			expect(info.brakeScale).toBeGreaterThan(0);
		}
	});

	it('makes the light, slow services brisk and the heavy, fast ones patient', () => {
		// A tram gets away from a stop faster than a main-line train, which in
		// turn gets away faster than a high-speed set.
		expect(lineModeInfo('tram').accelScale).toBeGreaterThan(lineModeInfo('regional').accelScale);
		expect(lineModeInfo('regional').accelScale).toBeGreaterThan(lineModeInfo('hsr').accelScale);
		// And the one that goes fastest is the one that takes longest to stop.
		expect(lineModeInfo('hsr').brakeScale).toBeLessThan(lineModeInfo('tram').brakeScale);
	});

	it('keeps the metro at 1, so it is the yardstick the others are read against', () => {
		expect(lineModeInfo('rapid').accelScale).toBe(1);
		expect(lineModeInfo('rapid').brakeScale).toBe(1);
	});
});

/** The physics honours the scales, and defaults to unchanged behaviour. */
describe('TrainPhysics accel/brake scaling', () => {
	const track = {totalLength: 100000, isLoop: false} as never;

	function speedAfter(seconds: number, accelScale?: number): number {
		const state = createTrainPhysicsState(1000);
		const dt = 1 / 60;

		for (let t = 0; t < seconds * 60; t++) {
			updateTrainPhysics(
				state,
				{throttle: true, braking: false, emergency: false, accelScale},
				track,
				dt,
			);
		}

		return state.trainSpeed;
	}

	it('an absent scale behaves exactly as before', () => {
		expect(speedAfter(5, undefined)).toBeCloseTo(speedAfter(5, 1), 6);
	});

	it('a tram out-accelerates a high-speed set from a standing start', () => {
		const tram = speedAfter(5, lineModeInfo('tram').accelScale);
		const hsr = speedAfter(5, lineModeInfo('hsr').accelScale);

		expect(tram).toBeGreaterThan(hsr);
	});

	it('ignores a nonsensical scale rather than stopping the train dead', () => {
		expect(speedAfter(5, 0)).toBeCloseTo(speedAfter(5, 1), 6);
		expect(speedAfter(5, -3)).toBeCloseTo(speedAfter(5, 1), 6);
	});
});
