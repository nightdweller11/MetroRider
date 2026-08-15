import {buildRibbon, paceFor, MAX_DOTS} from '../app/game/ui/RouteRibbon';

/**
 * The strip of stops across the top of the screen.
 *
 * It used to draw twelve dots whatever the line and put the marker at a
 * fraction along the strip rather than on a stop — so a 21-station line showed
 * as 12 dots and the marker sat between them. A child counting dots to see how
 * many stops were left got the wrong answer.
 */

const legs = (...limits: number[]): {limitKmh: number}[] => limits.map(limitKmh => ({limitKmh}));

describe('how many dots', () => {
	test('one per station on an ordinary line', () => {
		expect(buildRibbon(9, 0, legs(80, 80, 80, 80, 80, 80, 80, 80)).dots).toBe(9);
	});

	test('a 21-station line shows 21 stops, not 12', () => {
		// The headline failure: the built-in map's first line has 21 stations.
		expect(buildRibbon(21, 0, legs()).dots).toBe(21);
	});

	test('a very long line stops being a count and says so', () => {
		const view = buildRibbon(56, 0, legs());

		expect(view.dots).toBe(MAX_DOTS);
		expect(view.compressed).toBe(true);
	});

	test('an ordinary line is never marked compressed', () => {
		expect(buildRibbon(9, 0, legs()).compressed).toBe(false);
	});
});

describe('where the marker sits', () => {
	test('on the stop being worked towards, not a fraction along', () => {
		expect(buildRibbon(9, 4, legs()).here).toBe(4);
	});

	test('holds its proportion when the strip is compressed', () => {
		const view = buildRibbon(48, 24, legs());

		// Halfway down the line, so halfway along the strip.
		expect(view.here).toBe(Math.round((MAX_DOTS - 1) / 2));
	});

	test('no stop means no marker', () => {
		expect(buildRibbon(9, -1, legs()).here).toBe(-1);
	});

	test('never points past the end of the strip', () => {
		expect(buildRibbon(9, 99, legs()).here).toBeLessThan(9);
	});
});

describe('paceFor', () => {
	test('is relative to the line, not to an absolute number', () => {
		// 60 is flat out on a tram route and crawling on a main line.
		expect(paceFor(60, 60)).toBe('fast');
		expect(paceFor(60, 200)).toBe('slow');
	});

	test('a line with no speed anywhere does not divide by it', () => {
		expect(paceFor(0, 0)).toBe('medium');
	});
});

describe('leg pace', () => {
	test('one pace per leg, one fewer than the dots', () => {
		const view = buildRibbon(5, 0, legs(100, 100, 40, 100));

		expect(view.legPace).toHaveLength(4);
	});

	test('marks the slow stretch', () => {
		const view = buildRibbon(5, 0, legs(100, 100, 40, 100));

		expect(view.legPace[2]).toBe('slow');
		expect(view.legPace[0]).toBe('fast');
	});

	test('a compressed strip shows the SLOWEST of the legs it stands for', () => {
		// Averaging would hide a crawl inside a fast stretch, which is the one
		// thing the strip is for.
		const many = legs(...Array.from({length: 60}, (_, i) => (i === 30 ? 20 : 200)));
		const view = buildRibbon(61, 0, many);

		expect(view.legPace).toContain('slow');
	});
});
