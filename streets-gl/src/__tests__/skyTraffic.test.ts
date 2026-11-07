import {
	skyAt, flightType, isLowFlight, flightPlan, flightAt, passAt, SkyTracker,
	FLIGHT_COUNT, LOW_FLIGHTS, CRUISE_MIN_M, CRUISE_MAX_M, SPREAD_M, LOW_FLOOR_M,
	REANCHOR_DISTANCE_M,
} from '../app/game/data/SkyTraffic';

/**
 * The sky.
 *
 * What would spoil it: aeroplanes that JUMP — the system asks for the sky
 * repeatedly and any wobble becomes a stutter — aeroplanes that fly away and
 * never come back, leaving an empty sky after a few minutes, an aeroplane
 * swept across the whole sky when its pass wraps between two samples, one
 * that slides along with the train as if tethered to it, and low aeroplanes
 * placed directly overhead, where a driver looking forward never sees them.
 */

describe('skyAt', () => {
	test('there is traffic up there', () => {
		expect(skyAt(0, 0, 0)).toHaveLength(FLIGHT_COUNT);
	});

	test('the same moment always gives the same sky', () => {
		expect(skyAt(1000, 2000, 42.5)).toEqual(skyAt(1000, 2000, 42.5));
	});

	test('they move, and steadily, at airliner speed', () => {
		const a = skyAt(0, 0, 0)[0];
		const b = skyAt(0, 0, 1)[0];
		const c = skyAt(0, 0, 2)[0];
		const step1 = Math.hypot(b.x - a.x, b.z - a.z);
		const step2 = Math.hypot(c.x - b.x, c.z - b.z);

		expect(step1).toBeGreaterThan(200);
		expect(step1).toBeLessThan(280);
		expect(step2).toBeCloseTo(step1, 0);
	});

	test('a cruising flight keeps its heading and its height', () => {
		const a = skyAt(0, 0, 0)[2];
		const b = skyAt(0, 0, 60)[2];

		expect(b.heading).toBeCloseTo(a.heading, 6);
		expect(b.altitude).toBeCloseTo(a.altitude, 6);
	});

	test('the sky never empties', () => {
		for (let t = 0; t < 3600; t += 137) {
			for (const f of skyAt(0, 0, t)) {
				expect(Math.hypot(f.x, f.z)).toBeLessThan(SPREAD_M * 2.5);
			}
		}
	});

	test('some cruise high, and some fly low enough to see', () => {
		const sky = skyAt(0, 0, 300);
		const high = sky.filter(f => f.altitude >= CRUISE_MIN_M && f.altitude <= CRUISE_MAX_M);
		const low = sky.filter(f => f.altitude < 3000);

		expect(high.length).toBe(FLIGHT_COUNT - LOW_FLIGHTS);
		expect(low.length).toBe(LOW_FLIGHTS);
	});

	test('the low ones sit above the horizon, never overhead, never on the roofs', () => {
		for (let t = 0; t < 900; t += 13) {
			for (const f of skyAt(0, 0, t).filter(f => f.altitude < 3000)) {
				const elevation = Math.atan2(f.altitude, Math.hypot(f.x, f.z)) * 180 / Math.PI;

				expect(elevation).toBeGreaterThan(2);
				expect(elevation).toBeLessThan(40);
				expect(f.altitude).toBeGreaterThanOrEqual(LOW_FLOOR_M);
			}
		}
	});

	test('a low one climbs out or comes down, it does not fly level', () => {
		const lows = Array.from({length: FLIGHT_COUNT}, (_, i) => flightPlan(i)).filter(p => p.low);

		for (const plan of lows) {
			const pass = passAt(plan, 0);
			const a = flightAt(plan, 0, pass, 0, 0);
			const b = flightAt(plan, 20, pass, 0, 0);

			expect(Math.abs(b.altitude - a.altitude)).toBeGreaterThan(20);
		}
	});

	test('they are not all on one line through your head', () => {
		const headings = new Set(skyAt(0, 0, 0).map(f => f.heading.toFixed(3)));

		expect(headings.size).toBe(FLIGHT_COUNT);
	});

	test('the sky follows the player to another city', () => {
		const here = skyAt(0, 0, 10);
		const there = skyAt(500000, 500000, 10);

		expect(there[0].x).toBeGreaterThan(here[0].x + 400000);
	});

	test('nonsense in, empty sky out', () => {
		expect(skyAt(NaN, 0, 0)).toEqual([]);
		expect(skyAt(0, 0, NaN)).toEqual([]);
	});
});

describe('passes', () => {
	test('a pass is followed past its own end in a straight line, not wrapped', () => {
		// The interpolator asks for samples up to twenty seconds ahead. A flight
		// that wrapped between two of them would be drawn sweeping the whole
		// width of the sky in one interval.
		const plan = flightPlan(FLIGHT_COUNT - 1);
		const lap = plan.spread * 2;
		// The moment the pass ends.
		const end = ((passAt(plan, 0) + 1) * lap - plan.phase) / plan.speed;
		const pass = passAt(plan, end - 5);
		const before = flightAt(plan, end - 5, pass, 0, 0);
		const after = flightAt(plan, end + 5, pass, 0, 0);

		expect(passAt(plan, end + 5)).toBe(pass + 1);
		expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeCloseTo(plan.speed * 10, 0);
	});

	test('a new pass is a new aeroplane', () => {
		const plan = flightPlan(0);
		const lap = plan.spread * 2;
		const end = ((passAt(plan, 0) + 1) * lap - plan.phase) / plan.speed;

		expect(flightAt(plan, end - 1, passAt(plan, end - 1), 0, 0).id)
			.not.toBe(flightAt(plan, end + 1, passAt(plan, end + 1), 0, 0).id);
	});
});

describe('SkyTracker', () => {
	const times = (t: number): number[] => [t, t + 10, t + 20];

	test('every flight, with one sample per time asked for', () => {
		const tracks = new SkyTracker().tracks(0, 0, times(100));

		expect(tracks).toHaveLength(FLIGHT_COUNT);
		for (const track of tracks) expect(track.samples).toHaveLength(3);
	});

	test('a pass stays fixed to the ground while the train moves under it', () => {
		// An aeroplane re-centred on the camera every update would travel with
		// the train — at thirty metres a second, plainly tethered to it.
		const sky = new SkyTracker();
		const first = sky.tracks(0, 0, times(100));
		const later = sky.tracks(600, 0, times(110));
		let compared = 0;

		for (let i = 0; i < FLIGHT_COUNT; i++) {
			if (later[i].id !== first[i].id) continue;

			compared++;

			expect(later[i].samples[0].x).toBeCloseTo(first[i].samples[1].x, 6);
			expect(later[i].samples[0].z).toBeCloseTo(first[i].samples[1].z, 6);
		}

		expect(compared).toBeGreaterThanOrEqual(FLIGHT_COUNT - 1);
	});

	test('a jump to somewhere else entirely brings the sky along', () => {
		const sky = new SkyTracker();

		sky.tracks(0, 0, times(100));

		const far = REANCHOR_DISTANCE_M * 3;
		const there = sky.tracks(far, far, times(110));

		for (const track of there) {
			const f = track.samples[0];

			expect(Math.hypot(f.x - far, f.z - far)).toBeLessThan(SPREAD_M * 2.5);
		}
	});

	test('nonsense in, empty sky out', () => {
		expect(new SkyTracker().tracks(NaN, 0, times(0))).toEqual([]);
		expect(new SkyTracker().tracks(0, 0, [])).toEqual([]);
	});
});

describe('flightType', () => {
	test('a flight is always the same aircraft', () => {
		expect(flightType(3)).toBe(flightType(3));
	});

	test('the sky is not all one type', () => {
		const types = new Set(Array.from({length: FLIGHT_COUNT}, (_, i) => flightType(i, isLowFlight(i))));

		expect(types.size).toBeGreaterThan(1);
	});

	test('a wide-body never comes in low over the houses', () => {
		for (let i = 0; i < 40; i++) expect(flightType(i, true)).not.toBe('B772');
	});

	test('always a code the engine already knows how to map', () => {
		// Looked up in `VehicleSystem.getAircraftType`. A code it does not know
		// falls to its default, so the sky would be all one aeroplane without
		// anything failing.
		const known = ['B772', 'A321', 'CRJ9', 'C208'];

		for (let i = 0; i < 50; i++) {
			expect(known).toContain(flightType(i));
			expect(known).toContain(flightType(i, true));
		}
	});
});

describe('isLowFlight', () => {
	test('the last few are the low ones', () => {
		expect(isLowFlight(0)).toBe(false);
		expect(isLowFlight(FLIGHT_COUNT - 1)).toBe(true);
		expect(Array.from({length: FLIGHT_COUNT}, (_, i) => isLowFlight(i)).filter(Boolean))
			.toHaveLength(LOW_FLIGHTS);
	});
});
