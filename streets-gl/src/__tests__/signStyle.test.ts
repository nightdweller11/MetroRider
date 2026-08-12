import {
	countryForLocation, railSignStyle, signNumber, signNumberToMs, signStyleFor, unitLabel,
} from '~/app/game/limits/SignStyle';

describe('countryForLocation', () => {
	it('places real cities in the right country', () => {
		expect(countryForLocation(32.08, 34.78)).toBe('IL');   // Tel Aviv
		expect(countryForLocation(52.52, 13.40)).toBe('DE');   // Berlin
		expect(countryForLocation(48.86, 2.35)).toBe('FR');    // Paris
		expect(countryForLocation(51.51, -0.13)).toBe('GB');   // London
		expect(countryForLocation(40.71, -74.01)).toBe('US');  // New York
		expect(countryForLocation(35.68, 139.69)).toBe('JP');  // Tokyo
	});

	it('prefers the smaller country when boxes overlap', () => {
		// Amsterdam sits inside the German box as well as the Dutch one.
		expect(countryForLocation(52.37, 4.90)).toBe('NL');
		// Vienna is inside both Austria and (loosely) neighbours.
		expect(countryForLocation(48.21, 16.37)).toBe('AT');
	});

	it('falls back rather than guessing for open ocean', () => {
		expect(countryForLocation(0, -140)).toBe('XX');
	});
});

describe('rail signage by country', () => {
	it('signs German main lines in tens of km/h on a square board', () => {
		const style = railSignStyle('DE');

		expect(style.shape).toBe('square');
		expect(style.tensOfKmh).toBe(true);
		expect(style.unit).toBe('kmh');
		expect(signNumber(120 / 3.6, style)).toBe(12);
		expect(style.advance?.shape).toBe('triangle');
	});

	it('signs French main lines with a disc, also in tens', () => {
		const style = railSignStyle('FR');

		expect(style.shape).toBe('disc');
		expect(style.tensOfKmh).toBe(true);
		expect(signNumber(160 / 3.6, style)).toBe(16);
	});

	it('signs British lines in mph on a plate', () => {
		const style = railSignStyle('GB');

		expect(style.unit).toBe('mph');
		expect(style.tensOfKmh).toBe(false);
		expect(unitLabel(style)).toBe('mph');
		// 100 mph is 44.7 m/s.
		expect(signNumber(44.7, style)).toBe(100);
	});

	it('signs Israeli lines with the full number in km/h', () => {
		const style = railSignStyle('IL');

		expect(style.tensOfKmh).toBe(false);
		expect(style.unit).toBe('kmh');
		expect(signNumber(90 / 3.6, style)).toBe(90);
	});

	it('does not put a road ring on a main line', () => {
		for (const cc of ['IL', 'DE', 'FR', 'GB', 'US', 'ES']) {
			expect(railSignStyle(cc).border).not.toBe('#c62828');
		}
	});
});

describe('signage by mode', () => {
	it('signs a tram like the street it runs in', () => {
		const style = signStyleFor('tram', 'DE');

		expect(style.shape).toBe('disc');
		expect(style.border).toBe('#c62828'); // the road-style red ring
		expect(style.tensOfKmh).toBe(false);  // streets post the real number
	});

	it('signs a metro as a plain staff board, not a road sign', () => {
		const style = signStyleFor('metro', 'FR');

		expect(style.shape).toBe('plate');
		expect(style.border).not.toBe('#c62828');
		expect(style.tensOfKmh).toBe(false);
	});

	it('keeps mph for British trams and metros', () => {
		expect(signStyleFor('tram', 'GB').unit).toBe('mph');
		expect(signStyleFor('metro', 'GB').unit).toBe('mph');
	});

	it('uses the country rail style for heavy rail', () => {
		expect(signStyleFor('rail', 'DE')).toEqual(railSignStyle('DE'));
	});
});

describe('sign numbers', () => {
	it('round-trips through the sign face', () => {
		for (const cc of ['IL', 'DE', 'FR', 'GB']) {
			const style = railSignStyle(cc);
			const posted = signNumber(100 / 3.6, style);
			const meaning = signNumberToMs(posted, style);

			// Within one rounding step of the original.
			expect(Math.abs(meaning - 100 / 3.6)).toBeLessThan(3);
		}
	});

	it('never posts a zero or a negative', () => {
		const style = railSignStyle('DE');

		expect(signNumber(0, style)).toBeGreaterThan(0);
		expect(signNumber(-5, style)).toBeGreaterThan(0);
	});

	it('rounds km/h boards to fives, as a real board does', () => {
		const style = railSignStyle('IL');

		expect(signNumber(87 / 3.6, style) % 5).toBe(0);
		expect(signNumber(93 / 3.6, style) % 5).toBe(0);
	});
});
