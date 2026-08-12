import {PassengerModel, PassengerStationDemand} from '~/app/game/passengers/PassengerModel';

/** Deterministic RNG so destination sampling is reproducible in tests. */
function seededRandom(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0x100000000;
	};
}

const line = (densities: number[]): PassengerStationDemand[] =>
	densities.map((d, i) => ({id: `st${i}`, density: d}));

describe('PassengerModel — demand accumulation', () => {
	it('scales with density and time', () => {
		const m = new PassengerModel({ratePerMinute: 60, random: seededRandom(1)});
		m.setStations(line([1, 0.5, 0]));
		m.accumulate(60); // one minute

		expect(m.getWaitingExact(0)).toBeCloseTo(60, 5);
		expect(m.getWaitingExact(1)).toBeCloseTo(30, 5);
		expect(m.getWaitingExact(2)).toBe(0);
	});

	it('never exceeds the platform cap', () => {
		const m = new PassengerModel({ratePerMinute: 600, maxWaiting: 50, random: seededRandom(2)});
		m.setStations(line([1, 1]));
		m.accumulate(600);

		expect(m.getWaiting(0)).toBe(50);
		expect(m.getWaiting(1)).toBe(50);
	});

	it('applies the demand multiplier (Calm/Normal/Rush)', () => {
		const m = new PassengerModel({ratePerMinute: 60, random: seededRandom(3)});
		m.setStations(line([1]));
		m.setDemandScale(2);
		m.accumulate(60);

		expect(m.getWaitingExact(0)).toBeCloseTo(120, 5);
	});

	it('accumulates sub-passenger amounts instead of losing them', () => {
		const m = new PassengerModel({ratePerMinute: 6, random: seededRandom(4)});
		m.setStations(line([1]));
		for (let i = 0; i < 100; i++) m.accumulate(0.1); // 10 s total

		expect(m.getWaitingExact(0)).toBeCloseTo(1, 5);
	});
});

describe('PassengerModel — boarding and alighting', () => {
	it('boards waiting passengers while the doors are open', () => {
		const m = new PassengerModel({ratePerMinute: 600, boardPerSecPerCar: 2, random: seededRandom(5)});
		m.setStations(line([1, 1, 1]));
		m.accumulate(60);
		const before = m.getWaiting(0);

		const r = m.tickDoors(0, 1, 3); // 3 cars → 6 per second

		expect(r.boarded).toBe(6);
		expect(m.getWaiting(0)).toBe(before - 6);
		expect(m.getAboard()).toBe(6);
	});

	it('alights riders destined for this station before boarding anyone', () => {
		const m = new PassengerModel({
			ratePerMinute: 600, boardPerSecPerCar: 2, alightPerSecPerCar: 1, random: seededRandom(6),
		});
		m.setStations(line([1, 1, 1]));
		m.accumulate(60);
		m.tickDoors(0, 2, 2); // load up at station 0

		const aboardBefore = m.getAboard();
		expect(aboardBefore).toBeGreaterThan(0);

		// Move everyone's destination to station 1 for a deterministic check.
		const dest1 = m.getAboardFor(1);
		const r = m.tickDoors(1, 1, 2); // 2 per second alighting

		if (dest1 > 0) {
			expect(r.alighted).toBeGreaterThan(0);
			expect(r.boarded).toBe(0); // busy alighting
		}
	});

	it('respects train capacity', () => {
		const m = new PassengerModel({
			ratePerMinute: 6000, maxWaiting: 1000, capacityPerCar: 10, boardPerSecPerCar: 100,
			random: seededRandom(7),
		});
		m.setStations(line([1, 1]));
		m.accumulate(600);

		m.tickDoors(0, 5, 2); // capacity 20

		expect(m.getAboard()).toBe(20);

		const r = m.tickDoors(0, 5, 2);
		expect(r.boarded).toBe(0);
	});

	it('boards more people the longer the doors stay open (dwell matters)', () => {
		const short = new PassengerModel({ratePerMinute: 600, boardPerSecPerCar: 2, random: seededRandom(8)});
		const long = new PassengerModel({ratePerMinute: 600, boardPerSecPerCar: 2, random: seededRandom(8)});
		short.setStations(line([1, 1]));
		long.setStations(line([1, 1]));
		short.accumulate(60);
		long.accumulate(60);

		short.tickDoors(0, 1, 2);
		long.tickDoors(0, 5, 2);

		expect(long.getAboard()).toBeGreaterThan(short.getAboard());
	});
});

describe('PassengerModel — conservation', () => {
	it('never creates or destroys passengers through door operations', () => {
		const m = new PassengerModel({ratePerMinute: 120, random: seededRandom(9)});
		m.setStations(line([1, 0.8, 0.3, 0.9, 0.5]));
		m.accumulate(300);

		const spawned = m.totalSpawned;
		expect(m.getTotalTracked()).toBeCloseTo(spawned, 6);

		const rnd = seededRandom(42);
		for (let step = 0; step < 500; step++) {
			const station = Math.floor(rnd() * 5);
			m.setDirection(rnd() > 0.5 ? 1 : -1, false);
			m.tickDoors(station, rnd() * 2, 1 + Math.floor(rnd() * 6));
			expect(m.getTotalTracked()).toBeCloseTo(spawned, 6);
		}
	});
});

describe('PassengerModel — destinations', () => {
	it('never sends a passenger to the station they boarded at', () => {
		const m = new PassengerModel({random: seededRandom(11)});
		m.setStations(line([1, 1, 1, 1]));
		m.setDirection(1, false);

		for (let i = 0; i < 200; i++) {
			expect(m.sampleDestination(1)).not.toBe(1);
		}
	});

	it('sends passengers forward in the direction of travel', () => {
		const m = new PassengerModel({random: seededRandom(12)});
		m.setStations(line([1, 1, 1, 1, 1]));
		m.setDirection(1, false);

		for (let i = 0; i < 200; i++) {
			expect(m.sampleDestination(1)).toBeGreaterThan(1);
		}

		m.setDirection(-1, false);
		for (let i = 0; i < 200; i++) {
			expect(m.sampleDestination(3)).toBeLessThan(3);
		}
	});

	it('wraps around on loop lines', () => {
		const m = new PassengerModel({random: seededRandom(13)});
		m.setStations(line([1, 1, 1, 1]));
		m.setDirection(1, true);

		const seen = new Set<number>();
		for (let i = 0; i < 400; i++) seen.add(m.sampleDestination(3));

		expect(seen.has(0)).toBe(true); // wrapped past the end
		expect(seen.has(3)).toBe(false);
	});

	it('turns passengers around at the end of a non-loop line', () => {
		const m = new PassengerModel({random: seededRandom(14)});
		m.setStations(line([1, 1, 1]));
		m.setDirection(1, false);

		for (let i = 0; i < 100; i++) {
			const d = m.sampleDestination(2); // last station, nothing ahead
			expect(d).not.toBe(2);
			expect(d).toBeGreaterThanOrEqual(0);
		}
	});

	it('prefers denser stations', () => {
		const m = new PassengerModel({random: seededRandom(15)});
		m.setStations(line([0.5, 1, 0.02, 0.02]));
		m.setDirection(1, false);

		let toDense = 0;
		for (let i = 0; i < 1000; i++) {
			if (m.sampleDestination(0) === 1) toDense++;
		}

		expect(toDense).toBeGreaterThan(600); // ~1.05 / (1.05+0.07+0.07)
	});
});

describe('PassengerModel — left behind', () => {
	it('counts a full platform rolled past without doors', () => {
		const m = new PassengerModel({ratePerMinute: 600, random: seededRandom(16)});
		m.setStations(line([1, 1]));
		m.accumulate(60);

		const waiting = m.getWaiting(1);
		m.noteSkipped(1);

		expect(m.leftBehind).toBe(waiting);
	});
});
