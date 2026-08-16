import {
	ambientStockFor, ambientConsistFor, ambientModelsFor, AMBIENT_POOLS, PROCEDURAL, seedFrom,
} from '../app/game/data/AmbientFleet';
import type {LineMode} from '../app/game/data/LineModes';

/**
 * The ambient fleet's stock.
 *
 * The failure worth guarding is not "it picked an odd train" — it is a fleet
 * that RESHUFFLES. The services are respawned every time the player turns
 * around, so a pick that is not stable would change every train on the line
 * each time you reversed, which reads as the world glitching rather than as
 * variety.
 */

const MODES: LineMode[] = ['bus', 'tram', 'light', 'rapid', 'regional', 'hsr', 'ferry', 'gondola', 'air'];

describe('ambientModelFor', () => {
	test('the same line and service always get the same train', () => {
		expect(ambientStockFor('rapid', 'israel::14', 2))
			.toBe(ambientStockFor('rapid', 'israel::14', 2));
	});

	test('different services on a line do not all get the same train', () => {
		const picks = new Set(
			Array.from({length: 6}, (_, i) => ambientStockFor('rapid', 'israel::14', i)!.front),
		);

		expect(picks.size).toBeGreaterThan(1);
	});

	test('different lines get different fleets', () => {
		const a = Array.from({length: 5}, (_, i) => ambientStockFor('rapid', 'line-a', i)!.front).join();
		const b = Array.from({length: 5}, (_, i) => ambientStockFor('rapid', 'line-b', i)!.front).join();

		expect(a).not.toBe(b);
	});

	test('the stock suits the line', () => {
		expect(ambientStockFor('bus', 'x', 0)!.front).toBe('generic-town-bus');
		expect(ambientStockFor('hsr', 'x', 0)!.front).toMatch(/bullet/);
		expect(ambientStockFor('tram', 'x', 0)!.front).toMatch(/tram/);
	});

	test('a ferry route runs no train at all', () => {
		// Null is the honest answer — the caller uses its own hull. Putting a
		// tram on the water would be worse than the box it replaces.
		expect(ambientStockFor('ferry', 'x', 0)).toBeNull();
		expect(ambientStockFor('air', 'x', 0)).toBeNull();
		expect(ambientConsistFor('ferry', 'x', 0, 3)).toEqual([PROCEDURAL, PROCEDURAL, PROCEDURAL]);
	});

	test('an unknown or missing mode still answers', () => {
		expect(ambientStockFor(undefined, 'x', 0)).toBeTruthy();
		expect(ambientStockFor('nonsense' as LineMode, 'x', 0)).toBeNull();
	});

	test('always a real pool entry, never off the end', () => {
		for (const mode of MODES) {
			const pool = AMBIENT_POOLS[mode];

			for (let i = 0; i < 40; i++) {
				const pick = ambientStockFor(mode, `line-${i}`, i);

				if (pool.length === 0) expect(pick).toBeNull();
				else expect(pool).toContain(pick);
			}
		}
	});

	test('an empty line key does not throw', () => {
		expect(() => ambientStockFor('rapid', '', 0)).not.toThrow();
	});
});

describe('ambientConsistFor', () => {
	test('a train is a front, middles, and a rear — not three fronts', () => {
		// The bug this exists for: repeating one model made every ambient train
		// three front cabs nose to tail, which is what it looked like.
		// `hsr` runs only the bullet family, so this is not at the mercy of
		// which stock the seed happens to pick.
		const consist = ambientConsistFor('hsr', 'x', 0, 4);

		expect(consist[0]).toMatch(/-a$/);
		expect(consist[1]).toMatch(/-b$/);
		expect(consist[2]).toMatch(/-b$/);
		expect(consist[3]).toMatch(/-c$/);
	});

	test('two cars are a front and a rear, with no middle', () => {
		const consist = ambientConsistFor('hsr', 'x', 0, 2);

		expect(consist).toHaveLength(2);
		expect(consist[0]).toMatch(/-a$/);
		expect(consist[1]).toMatch(/-c$/);
	});

	test('a single vehicle is itself in every place', () => {
		// A bus has no rear carriage; it is a bus.
		expect(new Set(ambientConsistFor('bus', 'x', 0, 3)).size).toBe(1);
	});

	test('never asks for fewer than one car', () => {
		expect(ambientConsistFor('rapid', 'x', 0, 0)).toHaveLength(1);
		expect(ambientConsistFor('rapid', 'x', 0, -3)).toHaveLength(1);
	});
});

describe('seedFrom', () => {
	test('is stable and non-negative', () => {
		expect(seedFrom('abc', 1)).toBe(seedFrom('abc', 1));
		expect(seedFrom('abc', 1)).toBeGreaterThanOrEqual(0);
		expect(seedFrom('', 0)).toBeGreaterThanOrEqual(0);
	});

	test('the index changes the answer, so one line varies', () => {
		expect(seedFrom('abc', 1)).not.toBe(seedFrom('abc', 2));
	});
});

describe('ambientModelsFor', () => {
	test('names every model in the pool, front middle and rear', () => {
		expect(ambientModelsFor('rapid')).toEqual(expect.arrayContaining([
			'train-electric-subway-a', 'train-electric-subway-b', 'train-electric-subway-c',
		]));
		expect(ambientModelsFor('ferry')).toEqual([]);
	});

	test('a single vehicle is named once, not three times', () => {
		expect(ambientModelsFor('bus')).toEqual(['generic-town-bus']);
	});

	test('covers every mode the game defines', () => {
		// A mode added to LineMode without a pool would silently fall back to
		// boxes for that whole kind of railway.
		for (const mode of MODES) expect(AMBIENT_POOLS[mode]).toBeDefined();
	});
});
