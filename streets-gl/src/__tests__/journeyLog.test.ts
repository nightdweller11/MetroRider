import {
	emptyJourney, addDriving, addStop, addLine,
	describeDistance, describeDuration, milestoneCrossed,
} from '../app/game/data/JourneyLog';

describe('adding driving', () => {
	test('counts distance and time', () => {
		// Two frames of half a second, which is what the game actually hands in.
		let log = addDriving(emptyJourney(), 10, 0.5);

		log = addDriving(log, 10, 0.5);

		expect(log.metres).toBe(10);
		expect(log.drivingSeconds).toBe(1);
	});

	test('remembers the fastest you have gone', () => {
		let log = addDriving(emptyJourney(), 30, 1);

		log = addDriving(log, 10, 1);

		expect(log.topSpeedMs).toBe(30);
	});

	test('a stationary train adds nothing', () => {
		const log = addDriving(emptyJourney(), 0, 5);

		expect(log.metres).toBe(0);
		expect(log.drivingSeconds).toBe(0);
	});

	test('a huge frame does not drive you to the moon', () => {
		// A backgrounded tab hands back one enormous delta.
		const log = addDriving(emptyJourney(), 50, 3600);

		expect(log.metres).toBe(50);
	});

	test('nonsense in, nothing out', () => {
		const start = emptyJourney();

		expect(addDriving(start, NaN, 1)).toBe(start);
		expect(addDriving(start, 10, NaN)).toBe(start);
		expect(addDriving(start, -5, 1)).toBe(start);
	});
});

describe('stations and lines', () => {
	test('counts every stop but each station once', () => {
		let log = addStop(emptyJourney(), 'm', 'l', 3);

		log = addStop(log, 'm', 'l', 3);

		expect(log.stops).toBe(2);
		expect(log.stations).toHaveLength(1);
	});

	test('the same station on a different line is a different station to serve', () => {
		let log = addStop(emptyJourney(), 'm', 'l1', 3);

		log = addStop(log, 'm', 'l2', 3);

		expect(log.stations).toHaveLength(2);
	});

	test('adds up passengers delivered', () => {
		let log = addStop(emptyJourney(), 'm', 'l', 0, 12);

		log = addStop(log, 'm', 'l', 1, 8);

		expect(log.delivered).toBe(20);
	});

	test('records a city once, however many of its lines you drive', () => {
		let log = addLine(emptyJourney(), 'm', 'l1', 'London');

		log = addLine(log, 'm', 'l2', 'London');

		expect(log.lines).toHaveLength(2);
		expect(log.maps).toEqual(['London']);
	});

	test('the record cannot grow without bound', () => {
		let log = emptyJourney();

		for (let i = 0; i < 4200; i++) log = addStop(log, 'm', 'l', i);

		expect(log.stations.length).toBeLessThanOrEqual(4000);
		// The newest are kept: a counter that stops counting is worse than an
		// approximate one.
		expect(log.stations[log.stations.length - 1]).toBe('m::l::4199');
	});
});

describe('saying it in words', () => {
	test('distance', () => {
		expect(describeDistance(430)).toBe('430 m');
		expect(describeDistance(4300)).toBe('4.3 km');
		expect(describeDistance(430000)).toBe('430 km');
	});

	test('duration', () => {
		expect(describeDuration(45)).toBe('45 seconds');
		expect(describeDuration(600)).toBe('10 minutes');
		expect(describeDuration(3600)).toBe('1 hour');
		expect(describeDuration(7200)).toBe('2 hours');
		expect(describeDuration(5400)).toBe('1 h 30 min');
	});
});

describe('milestones', () => {
	test('announces a round distance as it is passed', () => {
		const before = {...emptyJourney(), metres: 9_900};
		const after = {...emptyJourney(), metres: 10_100};

		expect(milestoneCrossed(before, after)).toBe('10 km driven altogether');
	});

	test('says nothing when nothing was crossed', () => {
		const before = {...emptyJourney(), metres: 10_100};
		const after = {...emptyJourney(), metres: 10_200};

		expect(milestoneCrossed(before, after)).toBeNull();
	});

	test('announces a milestone only once', () => {
		const at = {...emptyJourney(), metres: 10_100};

		expect(milestoneCrossed({...emptyJourney(), metres: 9_900}, at)).not.toBeNull();
		expect(milestoneCrossed(at, {...emptyJourney(), metres: 10_500})).toBeNull();
	});

	test('notices every fifth city', () => {
		const before = {...emptyJourney(), maps: ['a', 'b', 'c', 'd']};
		const after = {...emptyJourney(), maps: ['a', 'b', 'c', 'd', 'e']};

		expect(milestoneCrossed(before, after)).toBe('5 cities driven');
	});
});
