import {
	parseLineMode, lineModeInfo, inferLineMode, type LineMode,
} from '../app/game/data/LineModes';
import {buildSpeedProfile} from '../app/game/limits/SpeedProfile';

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
