import {lineCode, lineBadge, lineNameWithoutCode, lineShortLabel} from '../app/game/data/LineLabel';

/**
 * Naming a line.
 *
 * These exist because the picker badged four different services on the
 * built-in map "A1" — A1-A2, A1-A3, A1-A4 and A1-A5 — and two more "C6". A
 * column of identical badges against different routes is worse than no badge:
 * it looks like information.
 */

/** The real names off the built-in Israel map. */
const REAL = [
	'A1 - A2 Sharon Local - Ayalon Local',
	'B1 - B2 Beach Local - Beersheba West Local',
	'C2 - C7 Beersheba West Local - Part Route',
	'A1 - A3 Sharon Local - Ayalon Local',
	'A1 - A4 Sharon Local - Ayalon Local',
	'A1 - A5 - Sharon Local - Ayalon Express',
	'C1 - C2 Beach Local - Beersheba West Local',
	'C6 - C4 Part Route',
	'C6 - C5 Part Route',
	'C1 - C3 Beach Local - Part Route',
];

describe('lineCode', () => {
	test('a service is named by BOTH its codes', () => {
		expect(lineCode('A1 - A2 Sharon Local - Ayalon Local')).toBe('A1-A2');
		expect(lineCode('C6 - C4 Part Route')).toBe('C6-C4');
	});

	test('every line on the built-in map gets its own label', () => {
		const codes = REAL.map(lineCode);

		expect(new Set(codes).size).toBe(REAL.length);
	});

	test('an extra dash before the name does not confuse it', () => {
		expect(lineCode('A1 - A5 - Sharon Local - Ayalon Express')).toBe('A1-A5');
	});

	test('copes with the tight style and with dashes that are not hyphens', () => {
		expect(lineCode('A1-A2 Something')).toBe('A1-A2');
		expect(lineCode('A1 – A2 Something')).toBe('A1-A2');
	});

	test('a single code stays single', () => {
		expect(lineCode('M4 Circle Line')).toBe('M4');
	});

	test('a name with no code has none', () => {
		expect(lineCode('Sharon Local')).toBeNull();
		expect(lineCode('')).toBeNull();
		expect(lineCode(undefined)).toBeNull();
	});

	test('does not read a code out of the middle of a name', () => {
		expect(lineCode('Beach Local to A2')).toBeNull();
	});
});

describe('lineBadge', () => {
	test('falls back to a number so every row is identifiable', () => {
		expect(lineBadge('Sharon Local', 4)).toBe('5');
	});

	test('prefers the code when there is one', () => {
		expect(lineBadge('B1 - B2 Beach Local', 0)).toBe('B1-B2');
	});
});

describe('lineNameWithoutCode', () => {
	test('drops the code when it is shown beside the name', () => {
		expect(lineNameWithoutCode('A1 - A2 Sharon Local - Ayalon Local'))
			.toBe('Sharon Local - Ayalon Local');
	});

	test('keeps a name that has no code', () => {
		expect(lineNameWithoutCode('Sharon Local')).toBe('Sharon Local');
	});

	test('never returns an empty label', () => {
		expect(lineNameWithoutCode('A1 - A2')).toBe('A1 - A2');
	});
});

describe('lineShortLabel', () => {
	test('uses the code for a caption', () => {
		expect(lineShortLabel('A1 - A3 Sharon Local')).toBe('A1-A3');
	});

	test('trims a long codeless name rather than overflowing', () => {
		expect(lineShortLabel('Some Extremely Long Route Name')).toHaveLength(14);
	});
});
