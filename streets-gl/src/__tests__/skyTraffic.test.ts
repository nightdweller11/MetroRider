import {
	skyAt, flightType, isLowFlight, flightPlan, flightAt, passAt, layoutPass, SkyTracker,
	FLIGHT_COUNT, LOW_FLIGHTS, CRUISE_MIN_M, CRUISE_MAX_M, SPREAD_M, LOW_FLOOR_M,
	REANCHOR_SHARE, LOW_SPREAD_M, LOW_AHEAD_M, LOW_SIDE_MIN_M, LOW_SIDE_SPAN_M,
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

				expect(elevation).toBeGreaterThan(1);
				// Above a cab's view at its closest — but never straight up.
				expect(elevation).toBeLessThan(55);
				expect(f.altitude).toBeGreaterThanOrEqual(LOW_FLOOR_M);
			}
		}
	});

	test('a low pass crosses the forward view, wherever the player looks', () => {
		// Laid at random around the player, a low flight was in the cab's view
		// four per cent of the time. Laid across the view, its middle is ahead.
		for (const [fx, fz] of [[0, 1], [1, 0], [-0.6, -0.8]]) {
			for (let i = 0; i < FLIGHT_COUNT; i++) {
				const plan = flightPlan(i);

				if (!plan.low) continue;

				for (let pass = 0; pass < 20; pass++) {
					const at = layoutPass(plan, pass, 0, 0, fx, fz);
					// The spot the pass is laid around is straight ahead...
					expect(at.x * fx + at.z * fz).toBeCloseTo(LOW_AHEAD_M, 3);
					// ...and the track crosses the line of sight, not along it.
					const cross = Math.abs(Math.sin(at.heading) * fz - Math.cos(at.heading) * fx);
					expect(cross).toBeGreaterThan(Math.sin(40 * Math.PI / 180) - 1e-9);
				}
			}
		}
	});

	test('every low pass actually crosses a driver\'s view — not above it', () => {
		// The cab sees roughly 30 degrees either side of straight ahead and up
		// to about 15 degrees. Laid closer and higher, the low ones crossed
		// above the top of that view for nearly the whole of a two-minute
		// watch. Every pass must spend real time inside it.
		for (let i = 0; i < FLIGHT_COUNT; i++) {
			const plan = flightPlan(i);

			if (!plan.low) continue;

			for (let pass = 0; pass < 30; pass++) {
				const at = layoutPass(plan, pass, 0, 0, 0, 1);
				const start = (pass * plan.spread * 2 - plan.phase) / plan.speed;
				let inView = 0;

				for (let t = start; t < start + plan.spread * 2 / plan.speed; t += 1) {
					const f = flightAt(plan, t, pass, at.x, at.z, at.heading);
					const bearing = Math.atan2(f.x, f.z) * 180 / Math.PI;
					const elevation = Math.atan2(f.altitude, Math.hypot(f.x, f.z)) * 180 / Math.PI;

					if (Math.abs(bearing) < 30 && elevation > 2 && elevation < 15) inView++;
				}

				expect(inView).toBeGreaterThanOrEqual(15);
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

		const far = SPREAD_M * 3;
		const there = sky.tracks(far, far, times(110));

		for (const track of there) {
			const f = track.samples[0];

			expect(Math.hypot(f.x - far, f.z - far)).toBeLessThan(SPREAD_M * 2.5);
		}
	});

	test('an aeroplane that keeps its id keeps its track — even across a jump', () => {
		// The vehicle system interpolates between the states it holds for an
		// id. A pass re-laid under the same id was drawn sweeping from its old
		// track to its new one at three times an airliner's speed.
		const sky = new SkyTracker();
		const moves: [number, number, number][] = [[0, 0, 100], [200, 0, 110], [9000, 4000, 120], [9300, 4000, 130]];
		let prev = new Map<string, {x: number; z: number}>();

		for (const [x, z, t] of moves) {
			const now = new Map<string, {x: number; z: number}>();

			for (const track of sky.tracks(x, z, times(t))) {
				const was = prev.get(track.id);

				if (was) {
					expect(track.samples[0].x).toBeCloseTo(was.x, 6);
					expect(track.samples[0].z).toBeCloseTo(was.z, 6);
				}

				now.set(track.id, track.samples[1]);
			}

			prev = now;
		}
	});

	test('after a jump along the line, the low ones are around the player again', () => {
		// The game boots at the map's start view and then moves to the first
		// station. Anchored at the start view, every low flight ended up twenty
		// kilometres off — in the sky, tracked, drawn, and invisible.
		const sky = new SkyTracker();

		sky.tracks(0, 0, times(100));

		const jump = LOW_SPREAD_M * REANCHOR_SHARE + 2000;
		const there = sky.tracks(jump, 0, times(110));

		for (const track of there.filter((_, i) => isLowFlight(i))) {
			const f = track.samples[0];

			expect(Math.hypot(f.x - jump, f.z)).toBeLessThan(LOW_AHEAD_M + Math.hypot(LOW_SPREAD_M, LOW_SIDE_MIN_M + LOW_SIDE_SPAN_M) + 1);
		}
	});

	test('driving on, an aeroplane is never moved mid-pass — it carries on or ends unseen', () => {
		// A fast train covers a low pass's re-anchor distance well inside one
		// pass. Re-laying a flight there would be a teleport, out of one part
		// of the sky and often straight into the windscreen. Worst cases: the
		// player keeps pace with the aeroplane, or drives away from it.
		// Keeping pace; and driving away at twice its speed (a fast train and
		// a slow approach, flying opposite ways).
		for (const direction of [1, -2]) {
			const i = FLIGHT_COUNT - 1;
			const plan = flightPlan(i);
			// Mid-pass: the aeroplane is abeam the spot the pass was laid around.
			const t0 = (passAt(plan, 0) * plan.spread * 2 - plan.phase + plan.spread) / plan.speed;
			const {heading} = layoutPass(plan, passAt(plan, t0), 0, 0);
			const sky = new SkyTracker();
			let ended = false;

			// Until the pass's own end — the pass ending is a separate matter.
			for (let t = t0; t + 10 < t0 + plan.spread / plan.speed; t += 10) {
				const camAt = (s: number): [number, number] => [
					direction * Math.sin(heading) * plan.speed * (s - t0),
					direction * Math.cos(heading) * plan.speed * (s - t0),
				];
				const before = sky.tracks(...camAt(t), times(t)).find(track => track.id.startsWith(`sky-${i}-`));
				const afterAll = sky.tracks(...camAt(t + 10), times(t + 10));
				const after = afterAll.find(track => track.id === before?.id);

				if (!before) continue;

				if (!after) {
					ended = true;
					// It ended out of sight: kilometres off, a few pixels at most.
					const [cx, cz] = camAt(t + 10);
					expect(Math.hypot(before.samples[1].x - cx, before.samples[1].z - cz)).toBeGreaterThan(4000);
					continue;
				}

				expect(after.samples[0].x).toBeCloseTo(before.samples[1].x, 6);
				expect(after.samples[0].z).toBeCloseTo(before.samples[1].z, 6);
			}

			// Driving away leaves it behind; keeping pace does not.
			expect(ended).toBe(direction < 0);
		}
	});

	test('an ended flight comes back on its next pass, around the player', () => {
		const i = FLIGHT_COUNT - 1;
		const plan = flightPlan(i);
		const sky = new SkyTracker();
		const t0 = (passAt(plan, 0) * plan.spread * 2 - plan.phase) / plan.speed + 1;
		let back = false;

		for (let t = t0; t < t0 + 600; t += 10) {
			const cam = -(t - t0) * 60;
			const track = sky.tracks(Math.sin(plan.heading) * cam, Math.cos(plan.heading) * cam, times(t))
				.find(tr => tr.id.startsWith(`sky-${i}-`));

			if (track && passAt(plan, t) > passAt(plan, t0)) back = true;
		}

		expect(back).toBe(true);
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
