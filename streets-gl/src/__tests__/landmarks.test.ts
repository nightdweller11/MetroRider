import {
	selectLandmarks, Corridor, spacedOut, pickVisible, MAX_TO_FIND, MAX_FOUND_LABELS, type WorldPoint,
} from '~/app/game/data/Landmarks';
import {DISCOVER_RADIUS_M, type NamedPlace} from '~/app/game/data/Discovery';

/**
 * Landmarks on the network map.
 *
 * What must hold: a dim "still to find" pin is a place the discovery check
 * would actually find from the line (near the track, important enough, not
 * already found); the map never fills with them; and a find from another city
 * never turns up on this one.
 */

/** A straight line, 10 km east–west along z = 0. */
const LINE: WorldPoint[][] = [[{x: 0, z: 0}, {x: 10_000, z: 0}]];

function place(name: string, x: number, z: number, priority = 20): NamedPlace {
	return {name, x, z, priority};
}

describe('Corridor', () => {
	it('is within the radius of a segment, not just of its ends', () => {
		const c = new Corridor(LINE, 300);

		expect(c.near(5000, 299)).toBe(true);
		expect(c.near(5000, -299)).toBe(true);
		expect(c.near(5000, 301)).toBe(false);
		expect(c.near(-299, 0)).toBe(true);
		expect(c.near(10_400, 0)).toBe(false);
	});

	it('agrees with brute force on a bent line', () => {
		const bent: WorldPoint[][] = [[{x: 0, z: 0}, {x: 1000, z: 700}, {x: 1300, z: -2000}, {x: 4000, z: -2100}]];
		const c = new Corridor(bent, 250);
		const brute = (x: number, z: number): boolean => bent[0].slice(1).some((b, i) => {
			const a = bent[0][i];
			const dx = b.x - a.x, dz = b.z - a.z;
			const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));

			return Math.hypot(a.x + t * dx - x, a.z + t * dz - z) <= 250;
		});

		for (let x = -500; x <= 4500; x += 97) {
			for (let z = -2600; z <= 1200; z += 89) {
				expect([x, z, c.near(x, z)]).toEqual([x, z, brute(x, z)]);
			}
		}
	});

	it('does not try to walk along a leg that crosses an ocean', () => {
		const flight: WorldPoint[][] = [[{x: 0, z: 0}, {x: 3_000_000, z: 2_000_000}]];
		const started = Date.now();
		const c = new Corridor(flight, 300);

		expect(Date.now() - started).toBeLessThan(500);
		expect(c.near(0, 0)).toBe(false);
	});
});

describe('selectLandmarks — still to find', () => {
	it('only places the discovery check would find from the line', () => {
		const {toFind} = selectLandmarks({
			lines: LINE,
			places: [
				place('Near the line', 2000, DISCOVER_RADIUS_M - 10),
				place('Too far', 2000, DISCOVER_RADIUS_M + 50),
				place('Corner shop', 3000, 10, 3),
				place('14', 3500, 10),
			],
			marks: [],
			found: new Set(),
		});

		expect(toFind.map(p => p.name)).toEqual(['Near the line']);
		expect(toFind[0].labelled).toBe(false);
	});

	it('leaves out what you have already found, and names a place once', () => {
		const {toFind} = selectLandmarks({
			lines: LINE,
			places: [
				place('Found it', 1000, 0),
				place('Twice', 2000, 0, 15),
				place('Twice', 2100, 0, 40),
			],
			marks: [],
			found: new Set(['Found it']),
		});

		expect(toFind).toHaveLength(1);
		expect(toFind[0]).toMatchObject({name: 'Twice', x: 2100});
	});

	it('comes most important first (the drawing caps it after spacing)', () => {
		const places = Array.from({length: 40}, (_, i) => place(`Place ${i}`, i * 200, 0, 10 + i));
		const {toFind} = selectLandmarks({lines: LINE, places, marks: [], found: new Set()});

		expect(toFind).toHaveLength(40);
		expect(toFind[0].name).toBe('Place 39');
	});

	it('an empty map has nothing', () => {
		expect(selectLandmarks({lines: [], places: [place('x', 0, 0)], marks: [], found: new Set()}))
			.toEqual({found: [], toFind: []});
	});
});

describe('selectLandmarks — found', () => {
	it('only this map\'s finds, one pin per name', () => {
		const {found} = selectLandmarks({
			lines: LINE,
			places: [],
			marks: [
				{n: 'Here', x: 4000, z: 500},
				{n: 'London', x: 9_000_000, z: 0},
				{n: 'Here', x: 4000, z: 500},
			],
			found: new Set(['Here', 'London']),
		});

		expect(found.map(f => f.name)).toEqual(['Here']);
	});

	it('names only the most recent few, oldest first on the map', () => {
		const marks = Array.from({length: 20}, (_, i) => ({n: `Find ${i}`, x: i * 100, z: 0}));
		const {found} = selectLandmarks({lines: LINE, places: [], marks, found: new Set(marks.map(m => m.n))});

		expect(found).toHaveLength(20);
		expect(found.filter(f => f.labelled)).toHaveLength(MAX_FOUND_LABELS);
		expect(found[found.length - 1]).toMatchObject({name: 'Find 19', labelled: true});
		expect(found[0]).toMatchObject({name: 'Find 0', labelled: false});
	});
});

describe('spacedOut', () => {
	it('drops a mark that would sit on an earlier one, keeps the rest', () => {
		expect(spacedOut([{x: 0, y: 0}, {x: 5, y: 5}, {x: 30, y: 0}, {x: 31, y: 2}, {x: NaN, y: 0}], 14))
			.toEqual([true, false, true, false, false]);
	});

	it('earlier wins: the most important of a cluster is the one drawn', () => {
		const shown = spacedOut([{x: 100, y: 100}, {x: 0, y: 0}, {x: 101, y: 100}], 14);

		expect(shown).toEqual([true, true, false]);
	});
});

describe('pickVisible', () => {
	it('spaces before it caps: a cluster costs one pin, and the rest fill the cap', () => {
		// Twenty pins in one spot, then twenty spread out.
		const cluster = Array.from({length: 20}, () => ({x: 10, y: 10}));
		const spread = Array.from({length: 20}, (_, i) => ({x: 100 + i * 30, y: 100}));
		const shown = pickVisible([], [...cluster, ...spread], 14);

		expect(shown.filter(Boolean)).toHaveLength(MAX_TO_FIND);
		expect(shown.slice(0, 20).filter(Boolean)).toHaveLength(1);
	});

	it('never puts a dim pin on a found one', () => {
		expect(pickVisible([{x: 0, y: 0}], [{x: 3, y: 3}, {x: 50, y: 0}], 14)).toEqual([false, true]);
	});
});
