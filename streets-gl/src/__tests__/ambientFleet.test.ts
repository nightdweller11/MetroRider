import {
	ambientModelFor, ambientModelsFor, AMBIENT_POOLS, PROCEDURAL, seedFrom,
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
		const a = ambientModelFor('rapid', 'israel::14', 2);
		const b = ambientModelFor('rapid', 'israel::14', 2);

		expect(a).toBe(b);
	});

	test('different services on a line do not all get the same train', () => {
		const picks = new Set(
			Array.from({length: 6}, (_, i) => ambientModelFor('rapid', 'israel::14', i)),
		);

		expect(picks.size).toBeGreaterThan(1);
	});

	test('different lines get different fleets', () => {
		const a = Array.from({length: 5}, (_, i) => ambientModelFor('rapid', 'line-a', i)).join();
		const b = Array.from({length: 5}, (_, i) => ambientModelFor('rapid', 'line-b', i)).join();

		expect(a).not.toBe(b);
	});

	test('the stock suits the line', () => {
		expect(ambientModelFor('bus', 'x', 0)).toBe('generic-town-bus');
		expect(ambientModelFor('hsr', 'x', 0)).toMatch(/bullet/);
		expect(ambientModelFor('tram', 'x', 0)).toMatch(/tram/);
	});

	test('a ferry route runs no train at all', () => {
		// Empty is the honest answer — the caller uses its own hull. Putting a
		// tram on the water would be worse than the box it replaces.
		expect(ambientModelFor('ferry', 'x', 0)).toBe(PROCEDURAL);
		expect(ambientModelFor('air', 'x', 0)).toBe(PROCEDURAL);
	});

	test('an unknown or missing mode still answers', () => {
		expect(ambientModelFor(undefined, 'x', 0)).toBeTruthy();
		expect(ambientModelFor('nonsense' as LineMode, 'x', 0)).toBe(PROCEDURAL);
	});

	test('always a real pool entry, never off the end', () => {
		for (const mode of MODES) {
			const pool = AMBIENT_POOLS[mode];

			for (let i = 0; i < 40; i++) {
				const pick = ambientModelFor(mode, `line-${i}`, i);

				if (pool.length === 0) expect(pick).toBe(PROCEDURAL);
				else expect(pool).toContain(pick);
			}
		}
	});

	test('an empty line key does not throw', () => {
		expect(() => ambientModelFor('rapid', '', 0)).not.toThrow();
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
	test('gives the whole pool, so a fleet loads once', () => {
		expect(ambientModelsFor('tram')).toEqual(AMBIENT_POOLS.tram);
		expect(ambientModelsFor('ferry')).toEqual([]);
	});

	test('covers every mode the game defines', () => {
		// A mode added to LineMode without a pool would silently fall back to
		// boxes for that whole kind of railway.
		for (const mode of MODES) expect(AMBIENT_POOLS[mode]).toBeDefined();
	});
});
