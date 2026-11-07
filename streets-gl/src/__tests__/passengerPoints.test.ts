import {
	passengerPoints, describePassengerScheme, PassengerTally, readyToFinish,
	PassengerPointsFlash, PASSENGER_POINTS_PER_STOP, FINISH_WAIT_MAX_S, type PassengerCounts,
} from '~/app/game/scoring/PassengerPoints';
import {PassengerModel} from '~/app/game/passengers/PassengerModel';

/**
 * Passengers as a part of the score.
 *
 * The run card used to say "42 passengers delivered" and count it for
 * nothing. These pin the mark scheme the card now quotes.
 */

describe('passengerPoints', () => {
	test('one point a passenger', () => {
		expect(passengerPoints(7, 3)).toBe(7);
	});

	test('never more than the cap for each stop made', () => {
		expect(passengerPoints(500, 3)).toBe(3 * PASSENGER_POINTS_PER_STOP);
	});

	test('nothing without a stop or a passenger', () => {
		expect(passengerPoints(50, 0)).toBe(0);
		expect(passengerPoints(0, 5)).toBe(0);
		expect(passengerPoints(-3, 5)).toBe(0);
		expect(passengerPoints(Number.NaN, 5)).toBe(0);
	});

	test('whole passengers only', () => {
		expect(passengerPoints(4.9, 2)).toBe(4);
	});

	test('the demand setting barely moves a full run once capped', () => {
		// A ten-stop drive on the real model at Normal and at Rush.
		const run = (scale: number): number => {
			let seed = 7;
			const random = (): number => {
				seed = (seed * 16807) % 2147483647;

				return seed / 2147483647;
			};
			const m = new PassengerModel({random});

			m.setStations([0.2, 0.5, 0.8, 0.4, 0.6, 0.3, 0.9, 0.5, 0.45, 0.55].map((density, i) => ({id: `${i}`, density})));
			m.setDemandScale(scale);
			m.preload(4);
			m.setDirection(1, false);

			for (let s = 0; s < 10; s++) {
				for (let t = 0; t < 25; t += 0.1) {
					m.tickDoors(s, 0.1, 3);
					m.accumulate(0.1);
				}
				m.accumulate(60);
			}

			return m.delivered;
		};
		const normal = run(1);
		const rush = run(2);

		expect(rush).toBeGreaterThan(normal);
		expect(passengerPoints(rush, 10)).toBe(passengerPoints(normal, 10));
	});
});

describe('describePassengerScheme', () => {
	test('states the rule', () => {
		expect(describePassengerScheme(5, 2)).toBe('1 point a passenger, up to 20 a stop');
	});

	test('says when the cap was reached', () => {
		expect(describePassengerScheme(90, 2)).toContain('you hit the top');
	});
});

describe('PassengerTally', () => {
	const counts = (delivered: number, leftBehind = 0, atInterchanges = 0): PassengerCounts => ({delivered, leftBehind, atInterchanges});

	test('a run counts only its own passengers', () => {
		const tally = new PassengerTally();

		tally.start(counts(120, 30, 10));

		expect(tally.read(counts(150, 34, 18))).toEqual(counts(30, 4, 8));
	});

	test('a model reset underneath is read as a reset, not as negative passengers', () => {
		const tally = new PassengerTally();

		tally.start(counts(120, 30, 10));

		expect(tally.read(counts(5, 0, 1))).toEqual(counts(5, 0, 1));
		// And it keeps counting from there.
		expect(tally.read(counts(9, 2, 1))).toEqual(counts(9, 2, 1));
	});
});

describe('readyToFinish', () => {
	const base = {doorsOpen: false, doorsWereOpened: false, stillToAlight: 40, speed: 0, waitedS: 1};

	test('waits while the train stands with its doors still shut', () => {
		expect(readyToFinish(base)).toBe(false);
	});

	test('waits while people are still getting off', () => {
		expect(readyToFinish({...base, doorsOpen: true, doorsWereOpened: true})).toBe(false);
	});

	test('finishes once everyone for this stop is off', () => {
		expect(readyToFinish({...base, doorsOpen: true, doorsWereOpened: true, stillToAlight: 0})).toBe(true);
	});

	test('finishes when the driver shuts the doors', () => {
		expect(readyToFinish({...base, doorsOpen: false, doorsWereOpened: true})).toBe(true);
	});

	test('finishes when the train drives off without opening', () => {
		expect(readyToFinish({...base, speed: 3})).toBe(true);
	});

	test('never waits for ever', () => {
		expect(readyToFinish({...base, waitedS: FINISH_WAIT_MAX_S})).toBe(true);
	});
});

describe('PassengerPointsFlash', () => {
	test('shows where the points came from, then the total again', () => {
		const flash = new PassengerPointsFlash(1000);

		expect(flash.update(0, 0)).toBeNull();
		expect(flash.update(3, 100)).toBe('👥 +3');
		// More people inside the window add to the same flash.
		expect(flash.update(5, 600)).toBe('👥 +5');
		expect(flash.update(5, 1700)).toBeNull();
		// A later batch starts its own count.
		expect(flash.update(9, 2000)).toBe('👥 +4');
	});

	test('a new run going back to zero shows nothing', () => {
		const flash = new PassengerPointsFlash(1000);

		flash.update(40, 0);
		expect(flash.update(0, 100)).toBeNull();
		expect(flash.update(2, 200)).toBe('👥 +2');
	});
});
