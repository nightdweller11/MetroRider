import {
	createLeadingTrain, stepLeadingTrain, brakingDistance, nextStopIndex,
	gapAhead, blockOccupied,
} from '../app/game/ai/LeadingTrainDriver';

/**
 * The service in front of you.
 *
 * These exist because the block signals watched only the passing trains on the
 * adjacent alignment, which cannot be in your way — so a red protected nothing
 * and could be run through all day.
 */

const STOPS = [0, 1000, 2000, 3000];
const LIMIT = 25;   // m/s, about 90 km/h

/** Run the driver for `seconds` in frames the game would deliver. */
function run(state: Parameters<typeof stepLeadingTrain>[0], seconds: number, direction = 1): void {
	for (let t = 0; t < seconds * 10; t++) {
		stepLeadingTrain(state, STOPS, LIMIT, direction, 0.1, 3000);
	}
}

describe('driving to the next stop', () => {
	test('pulls away from a stand', () => {
		const train = createLeadingTrain(0, 1);

		run(train, 3);

		expect(train.speed).toBeGreaterThan(0);
		expect(train.dist).toBeGreaterThan(0);
	});

	test('settles at the line limit rather than running away', () => {
		const train = createLeadingTrain(0, 1);

		run(train, 20);

		expect(train.speed).toBeLessThanOrEqual(LIMIT + 1e-6);
	});

	test('stops AT the platform, not past it', () => {
		const train = createLeadingTrain(0, 1);

		run(train, 120);

		// It should have reached the 1000 m stop and be standing there or have
		// moved on towards 2000 — never sailed through without stopping.
		expect(train.dist).toBeGreaterThan(900);
	});

	test('stands at a platform for a while before going on', () => {
		const train = createLeadingTrain(995, 1);

		run(train, 4);

		expect(train.dwellLeft).toBeGreaterThan(0);
		expect(train.speed).toBe(0);
	});

	test('works towards the following stop once it has gone', () => {
		const train = createLeadingTrain(995, 1);

		run(train, 30);

		expect(train.targetStop).toBe(2);
	});

	test('a huge frame does not fling it down the line', () => {
		const train = createLeadingTrain(0, 1);

		stepLeadingTrain(train, STOPS, LIMIT, 1, 3600, 3000);

		expect(train.dist).toBeLessThan(50);
	});

	test('never leaves the line', () => {
		const train = createLeadingTrain(2990, 3);

		run(train, 200);

		expect(train.dist).toBeLessThanOrEqual(3000);
		expect(train.dist).toBeGreaterThanOrEqual(0);
	});
});

describe('brakingDistance', () => {
	test('grows with the square of speed', () => {
		expect(brakingDistance(20)).toBeGreaterThan(brakingDistance(10) * 2);
	});

	test('leaves a margin, so one late frame is not an overshoot', () => {
		expect(brakingDistance(0)).toBeGreaterThan(0);
	});
});

describe('nextStopIndex', () => {
	test('counts up when working forwards and down when working back', () => {
		expect(nextStopIndex(1, 4, 1)).toBe(2);
		expect(nextStopIndex(2, 4, -1)).toBe(1);
	});

	test('holds at the ends rather than falling off them', () => {
		expect(nextStopIndex(3, 4, 1)).toBe(3);
		expect(nextStopIndex(0, 4, -1)).toBe(0);
	});
});

describe('where it is relative to you', () => {
	test('ahead is positive whichever way you are going', () => {
		expect(gapAhead(100, 400, 1)).toBe(300);
		expect(gapAhead(400, 100, -1)).toBe(300);
	});

	test('behind you is negative', () => {
		expect(gapAhead(400, 100, 1)).toBe(-300);
	});
});

describe('blockOccupied', () => {
	test('a train inside the block occupies it', () => {
		expect(blockOccupied(0, 600, 300, 1)).toBe(true);
	});

	test('a train beyond the block does not', () => {
		expect(blockOccupied(0, 600, 900, 1)).toBe(false);
	});

	test('a train BEHIND never puts a red in front of you', () => {
		// The failure this guards: measuring the gap without direction turns a
		// service you have already overtaken into a red signal ahead.
		expect(blockOccupied(0, 600, -300, 1)).toBe(false);
	});

	test('works the same when the line is driven the other way', () => {
		expect(blockOccupied(1000, 600, 700, -1)).toBe(true);
		expect(blockOccupied(1000, 600, 1300, -1)).toBe(false);
	});
});
