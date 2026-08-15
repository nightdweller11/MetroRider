import {
	arrivalMark,
	punctualityPercent,
	punctualityBonus,
	lateArrivals,
	describePunctuality,
	ON_TIME_S,
	ZERO_AT_S,
	POINTS_PER_STOP,
} from '../app/game/service/Punctuality';

describe('arrivalMark', () => {
	test('an arrival inside the slack scores full marks', () => {
		expect(arrivalMark(0)).toBe(1);
		expect(arrivalMark(ON_TIME_S)).toBe(1);
		expect(arrivalMark(ON_TIME_S - 1)).toBe(1);
	});

	test('early is not a fault — the timetable has slack in it by design', () => {
		// This is the whole reason the rule is one-sided. Holding the limit on a
		// schedule written at 82% of it puts a train comfortably ahead, and
		// marking that down would have scored good driving as a failure.
		expect(arrivalMark(-30)).toBe(1);
		expect(arrivalMark(-600)).toBe(1);
	});

	test('past three minutes late a stop scores nothing', () => {
		expect(arrivalMark(ZERO_AT_S)).toBe(0);
		expect(arrivalMark(ZERO_AT_S + 500)).toBe(0);
	});

	test('between the two it fades evenly', () => {
		const midpoint = (ON_TIME_S + ZERO_AT_S) / 2;

		expect(arrivalMark(midpoint)).toBeCloseTo(0.5, 5);
	});

	test('no schedule is an unknown, not a zero', () => {
		expect(arrivalMark(null)).toBeNull();
		expect(arrivalMark(NaN)).toBeNull();
		expect(arrivalMark(Infinity)).toBeNull();
	});
});

describe('punctualityPercent', () => {
	test('averages the marks it has', () => {
		expect(punctualityPercent([1, 1, 0, 0])).toBe(50);
		expect(punctualityPercent([1, 1, 1])).toBe(100);
	});

	test('unknowns are dropped rather than counted as failures', () => {
		// A stop the game had no schedule for must not drag the driver down.
		expect(punctualityPercent([1, null, 1])).toBe(100);
	});

	test('nothing timed at all reports nothing, not zero', () => {
		expect(punctualityPercent([])).toBeNull();
		expect(punctualityPercent([null, null])).toBeNull();
	});
});

describe('punctualityBonus', () => {
	test('a perfect run pays the full rate per timed stop', () => {
		expect(punctualityBonus(100, 8)).toBe(POINTS_PER_STOP * 8);
	});

	test('scales with how well the times were kept', () => {
		expect(punctualityBonus(50, 8)).toBe(60);
	});

	test('is a bonus, so it never takes points away', () => {
		expect(punctualityBonus(0, 8)).toBe(0);
		expect(punctualityBonus(null, 8)).toBe(0);
		expect(punctualityBonus(100, 0)).toBe(0);
		expect(punctualityBonus(100, -3)).toBe(0);
	});

	test('stays small against the stops themselves', () => {
		// One accurate stop is worth up to 175. A whole run of perfect
		// timekeeping over eight stops should not out-earn a handful of them.
		const bonus = punctualityBonus(100, 8);

		expect(bonus).toBeLessThan(175);
	});
});

describe('lateArrivals', () => {
	test('counts only the properly late ones', () => {
		expect(lateArrivals([-60, 0, 31, 200, null])).toBe(2);
	});

	test('an arrival exactly on the slack boundary is not late', () => {
		expect(lateArrivals([ON_TIME_S])).toBe(0);
	});
});

describe('describePunctuality', () => {
	test('says the plain thing when everything was on time', () => {
		expect(describePunctuality(100, 0)).toBe('every stop on time');
	});

	test('names how many were late once it matters', () => {
		expect(describePunctuality(60, 1)).toBe('60% on time · 1 stop late');
		expect(describePunctuality(60, 3)).toBe('60% on time · 3 stops late');
	});

	test('says nothing at all when nothing was timed', () => {
		expect(describePunctuality(null, 0)).toBe('');
	});
});
