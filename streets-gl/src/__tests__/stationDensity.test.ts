import {stationDensityFromMD, convertToMetroMapData} from '~/app/game/data/MetroDreaminImporter';

/**
 * Values below are REAL rows sampled from the Israel-railways MetroDreamin map
 * (fetched through the app's own proxy on 2026-08-12), not invented numbers.
 */
describe('stationDensityFromMD — real MetroDreamin payloads', () => {
	it('places a median station near 0.5', () => {
		// Median of the map: population 3,738 / employment 1,056.
		const d = stationDensityFromMD({densityInfo: {population: 3738, employment: 1056}});
		expect(d).toBeGreaterThan(0.4);
		expect(d).toBeLessThan(0.6);
	});

	it('ranks a city centre above a rural halt', () => {
		const centre = stationDensityFromMD({densityInfo: {population: 63082, employment: 46726}});
		const suburb = stationDensityFromMD({densityInfo: {population: 1513, employment: 3359}});
		const halt = stationDensityFromMD({densityInfo: {population: 0, employment: 0}});

		expect(centre).toBeGreaterThan(suburb);
		expect(suburb).toBeGreaterThan(halt);
		expect(centre).toBeLessThanOrEqual(1);
		expect(halt).toBeGreaterThanOrEqual(0.05);
	});

	it('counts jobs, not only residents (a business district is busy)', () => {
		const jobsOnly = stationDensityFromMD({densityInfo: {population: 20, employment: 20000}});
		const emptyish = stationDensityFromMD({densityInfo: {population: 20, employment: 0}});

		expect(jobsOnly).toBeGreaterThan(emptyish + 0.2);
	});

	it('falls back to densityScore when catchment numbers are missing', () => {
		expect(stationDensityFromMD({info: {densityScore: 58}})).toBeCloseTo(0.58, 5);
		expect(stationDensityFromMD({info: {densityScore: 362}})).toBe(1);
	});

	it('defaults to 0.5 when the map carries no demand data at all', () => {
		expect(stationDensityFromMD({})).toBe(0.5);
	});

	it('ignores malformed values instead of producing NaN', () => {
		const cases = [
			{densityInfo: {population: NaN as unknown as number}},
			{densityInfo: {population: -5}},
			{info: {densityScore: -1}},
		];
		for (const c of cases) {
			const d = stationDensityFromMD(c);
			expect(Number.isFinite(d)).toBe(true);
			expect(d).toBeGreaterThanOrEqual(0.05);
			expect(d).toBeLessThanOrEqual(1);
		}
	});
});

describe('convertToMetroMapData — density + interchanges', () => {
	const pageProps = {
		systemDocData: {title: 'Test Map'},
		fullSystem: {
			map: {
				stations: {
					a: {id: 'a', lat: 32, lng: 34.8, name: 'Alpha', densityInfo: {population: 50000, employment: 20000}},
					b: {id: 'b', lat: 32.1, lng: 34.9, name: 'Beta', densityInfo: {population: 100, employment: 0}},
					c: {id: 'c', lat: 32.2, lng: 35.0, name: 'Gamma'},
					w: {id: 'w', lat: 32.3, lng: 35.1, isWaypoint: true},
				},
				lines: {
					l1: {id: 'l1', name: 'Line 1', color: '#f00', stationIds: ['a', 'w', 'b', 'c']},
				},
				interchanges: {
					i0: {id: 'i0', stationIds: ['a', 'c'], hasLines: ['l1', 'l2']},
				},
			},
		},
	};

	it('assigns per-station demand and marks interchanges', () => {
		const map = convertToMetroMapData(pageProps as never);

		expect(map.stations.a.density).toBeGreaterThan(map.stations.b.density!);
		expect(map.stations.c.density).toBe(0.5); // no data → default
		expect(map.stations.a.isInterchange).toBe(true);
		expect(map.stations.c.isInterchange).toBe(true);
		expect(map.stations.b.isInterchange).toBeUndefined();
	});

	it('does not give waypoints demand (nobody waits at a bend in the track)', () => {
		const map = convertToMetroMapData(pageProps as never);
		expect(map.stations.w.density).toBeUndefined();
	});
});
