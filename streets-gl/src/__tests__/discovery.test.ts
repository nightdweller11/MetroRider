import {
	nearestNewPlace, worthFinding, tidyName, describeFind,
	DISCOVER_RADIUS_M, MIN_PRIORITY, type NamedPlace,
} from '../app/game/data/Discovery';

const place = (name: string, x: number, z: number, priority = 20): NamedPlace =>
	({name, x, z, priority});

describe('worthFinding', () => {
	test('a proper name is worth announcing', () => {
		expect(worthFinding(place('Raanana', 0, 0))).toBe(true);
	});

	test('a bare number is not a place', () => {
		expect(worthFinding(place('14', 0, 0))).toBe(false);
	});

	test('something the map itself thinks is minor is skipped', () => {
		// Without a floor the first minute of a city is a stream of toasts for
		// every corner shop, which turns finding somewhere into noise.
		expect(worthFinding(place('Corner Shop', 0, 0, MIN_PRIORITY - 1))).toBe(false);
		expect(worthFinding(place('Water Reservoir', 0, 0, 32))).toBe(true);
		// A station building at the map's own middling priority IS worth saying.
		expect(worthFinding(place('Raanana West railway', 0, 0, 12))).toBe(true);
	});

	test('a name too short to say is skipped', () => {
		expect(worthFinding(place('A', 0, 0))).toBe(false);
	});

	test('names that are not in the Latin alphabet still count', () => {
		expect(worthFinding(place('רעננה', 0, 0))).toBe(true);
	});
});

describe('nearestNewPlace', () => {
	const found = new Set<string>();

	test('finds something within reach', () => {
		expect(nearestNewPlace([place('Kfar Saba', 50, 0)], 0, 0, found)?.name).toBe('Kfar Saba');
	});

	test('ignores anything beyond reach', () => {
		expect(nearestNewPlace([place('Far Away', DISCOVER_RADIUS_M + 50, 0)], 0, 0, found)).toBeNull();
	});

	test('takes the NEAREST of a cluster, not the first in the list', () => {
		const places = [place('Further', 120, 0), place('Nearer', 20, 0)];

		expect(nearestNewPlace(places, 0, 0, found)?.name).toBe('Nearer');
	});

	test('never finds the same place twice', () => {
		const already = new Set(['Kfar Saba']);

		expect(nearestNewPlace([place('Kfar Saba', 10, 0)], 0, 0, already)).toBeNull();
	});

	test('measures in both directions', () => {
		expect(nearestNewPlace([place('North', 0, -60)], 0, 0, found)?.name).toBe('North');
	});

	test('nothing nearby is nothing, not a guess', () => {
		expect(nearestNewPlace([], 0, 0, found)).toBeNull();
	});

	test('tidies the name it hands back, so it matches what gets stored', () => {
		// Otherwise a label with stray whitespace is "found" on every pass,
		// because the stored name never equals the raw one.
		const messy = nearestNewPlace([place('  Kfar   Saba ', 10, 0)], 0, 0, found);

		expect(messy?.name).toBe('Kfar Saba');
	});
});

describe('tidyName', () => {
	test('collapses whitespace', () => {
		expect(tidyName('  Tel   Aviv \n')).toBe('Tel Aviv');
	});
});

describe('describeFind', () => {
	test('makes something of the first one', () => {
		expect(describeFind('Raanana', 1)).toContain('your first place');
	});

	test('and is brief thereafter', () => {
		expect(describeFind('Raanana', 12)).toBe('📍 Found Raanana');
	});
});
