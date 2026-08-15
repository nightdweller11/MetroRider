import {serviceDepartures, describeDeparture} from '../app/game/service/ServiceTimetable';

/**
 * Which services are running, and when.
 *
 * The point of these is that departures sit on a real clock. Offsets from
 * "whenever you pressed Play" would give times like 09:13 and 09:43 on a line
 * that runs every half hour — a countdown wearing a clock face rather than a
 * timetable.
 */

/** A local-time moment, so the tests read the same way the clock does. */
function at(hh: number, mm: number): number {
	const d = new Date();

	d.setHours(hh, mm, 0, 0);

	return d.getTime();
}

const clock = (ms: number): string => {
	const d = new Date(ms);

	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

describe('serviceDepartures', () => {
	test('a half-hourly line leaves on the hour and the half hour', () => {
		expect(serviceDepartures(at(9, 20), 30, 4).map(clock)).toEqual(['09:00', '09:30', '10:00', '10:30']);
	});

	test('a five-minute metro leaves every five minutes on the clock', () => {
		expect(serviceDepartures(at(9, 22), 5, 4).map(clock)).toEqual(['09:20', '09:25', '09:30', '09:35']);
	});

	test('always offers the service you have already missed', () => {
		// So a player can pick up a late-running service, not only a future one.
		const [first] = serviceDepartures(at(9, 20), 30, 4);

		expect(first).toBeLessThanOrEqual(at(9, 20));
	});

	test('standing exactly on a departure offers that one first', () => {
		expect(serviceDepartures(at(9, 30), 30, 2).map(clock)).toEqual(['09:30', '10:00']);
	});

	test('times come out in order, evenly spaced', () => {
		const times = serviceDepartures(at(13, 7), 12, 5);

		for (let i = 1; i < times.length; i++) {
			expect(times[i] - times[i - 1]).toBe(12 * 60_000);
		}
	});

	test('a nonsense headway still produces a usable timetable', () => {
		expect(serviceDepartures(at(9, 0), 0, 3)).toHaveLength(3);
		expect(serviceDepartures(at(9, 0), -5, 3)).toHaveLength(3);
	});

	test('an hourly line crossing midday keeps whole hours', () => {
		expect(serviceDepartures(at(11, 59), 60, 3).map(clock)).toEqual(['11:00', '12:00', '13:00']);
	});
});

describe('describeDeparture', () => {
	test('says how long until it goes', () => {
		expect(describeDeparture(at(9, 30), at(9, 22))).toBe('in 8 min');
	});

	test('says how long ago it went', () => {
		expect(describeDeparture(at(9, 0), at(9, 12))).toBe('12 min ago');
	});

	test('says due now when it is now', () => {
		expect(describeDeparture(at(9, 0), at(9, 0))).toBe('due now');
	});
});
