import {SAMPLE_MAP, LatestLoad} from '~/app/game/data/StartMaps';
import {parseMetroMap} from '~/app/game/data/RouteParser';

describe('the sample map', () => {
	it('is the built-in three-line Tel Aviv metro, not a MetroDreamin map', () => {
		expect(SAMPLE_MAP.name).toBe('Tel Aviv Metro');
		expect(SAMPLE_MAP.lines.map(l => l.name)).toEqual(['Red Line', 'Green Line', 'Blue Line']);
	});

	it('parses into three drivable lines', () => {
		const lines = parseMetroMap(SAMPLE_MAP);

		expect(lines).toHaveLength(3);
		for (const line of lines) expect(line.stations.length).toBeGreaterThan(1);
	});
});

describe('LatestLoad', () => {
	it('a background load that returns after the sample was picked is stale', () => {
		const loads = new LatestLoad();
		const metroDreamin = loads.begin();
		const sample = loads.begin();

		expect(loads.isCurrent(metroDreamin)).toBe(false);
		expect(loads.isCurrent(sample)).toBe(true);
	});

	it('a lone load is current', () => {
		const loads = new LatestLoad();

		expect(loads.isCurrent(loads.begin())).toBe(true);
	});
});
