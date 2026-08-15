import {
	squealIntensity, QUIET_BELOW, FULL_AT, STRAIGHT_FRACTION, MIN_SPEED_MS,
} from '../app/game/audio/FlangeSqueal';

/**
 * Flange squeal.
 *
 * The point of these is that the noise is about how HARD a curve is taken, not
 * that a curve exists. A trigger on radius alone would squeal through every
 * bend at walking pace and stay silent through one taken far too fast.
 */

const LINE_MAX = 55;   // m/s, a fast main line
const CURVE = 20;      // m/s, a tight bend

describe('squealIntensity', () => {
	test('a curve taken gently is silent', () => {
		expect(squealIntensity(CURVE * 0.4, CURVE, LINE_MAX)).toBe(0);
	});

	test('a curve taken at its limit is as loud as it gets', () => {
		expect(squealIntensity(CURVE * FULL_AT, CURVE, LINE_MAX)).toBe(1);
	});

	test('over the limit is not louder than loud', () => {
		expect(squealIntensity(CURVE * 3, CURVE, LINE_MAX)).toBe(1);
	});

	test('builds between the two rather than switching on', () => {
		const mid = (QUIET_BELOW + FULL_AT) / 2;
		const level = squealIntensity(CURVE * mid, CURVE, LINE_MAX);

		expect(level).toBeGreaterThan(0.3);
		expect(level).toBeLessThan(0.7);
	});

	test('straight track is silent however fast you go', () => {
		// The profile posts the LINE maximum on a straight, which is not a
		// curve limit — without this a fast line would sing all the way along.
		expect(squealIntensity(LINE_MAX, LINE_MAX, LINE_MAX)).toBe(0);
		expect(squealIntensity(LINE_MAX, LINE_MAX * STRAIGHT_FRACTION, LINE_MAX)).toBe(0);
	});

	test('a slow-moving train is silent at any radius', () => {
		expect(squealIntensity(MIN_SPEED_MS - 1, 6, LINE_MAX)).toBe(0);
	});

	test('a tighter curve squeals sooner at the same speed', () => {
		const speed = 18;

		expect(squealIntensity(speed, 20, LINE_MAX))
			.toBeGreaterThan(squealIntensity(speed, 30, LINE_MAX));
	});

	test('nonsense in, silence out', () => {
		expect(squealIntensity(NaN, CURVE, LINE_MAX)).toBe(0);
		expect(squealIntensity(20, NaN, LINE_MAX)).toBe(0);
		expect(squealIntensity(20, 0, LINE_MAX)).toBe(0);
		expect(squealIntensity(20, -5, LINE_MAX)).toBe(0);
	});

	test('never returns anything outside 0 to 1', () => {
		for (const speed of [0, 5, 12, 20, 40, 90]) {
			for (const curve of [5, 15, 25, 55]) {
				const level = squealIntensity(speed, curve, LINE_MAX);

				expect(level).toBeGreaterThanOrEqual(0);
				expect(level).toBeLessThanOrEqual(1);
			}
		}
	});
});

describe('straight track', () => {
	test('an infinite curve speed is dead straight, and silent', () => {
		// This is what the geometry actually reports on a straight, and it is a
		// real answer rather than a missing one.
		expect(squealIntensity(55, Infinity, Infinity)).toBe(0);
	});

	test('a tight curve still squeals when the line has no stated maximum', () => {
		expect(squealIntensity(25, 22, Infinity)).toBeGreaterThan(0);
	});
});
