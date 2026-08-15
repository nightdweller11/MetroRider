import {
	createRecorder, resetRecorder, tickRecorder, orderedSamples, samplesSince,
	approachSamples, metresToGo, sampleAt, SAMPLE_EVERY_S, CAPACITY,
	type RunRecorder, type RunSample,
} from '../app/game/replay/RunRecorder';

/**
 * The run recorder.
 *
 * The two things that would quietly ruin it: a ring that hands back its
 * samples in storage order rather than in time order once it has wrapped
 * (every graph drawn from it would have a jump in the middle), and an approach
 * filter that only works in one direction of travel — half of all driving is
 * the other way, and the graph would simply be empty.
 */

/** Drive at a steady speed, sampling as the game would. */
function drive(rec: RunRecorder, seconds: number, speed: number, startDist = 0, dir = 1): void {
	const step = 1 / 60;

	for (let t = 0; t < seconds; t += step) {
		const dist = startDist + speed * t * dir;

		tickRecorder(rec, step, {dist, speed, x: dist, z: 0, heading: 0});
	}
}

describe('tickRecorder', () => {
	test('samples at the stated rate, not every frame', () => {
		const rec = createRecorder();

		drive(rec, 1, 10);

		// A second at 5 Hz is five samples, give or take where the frame
		// boundaries fall.
		expect(rec.samples.length).toBeGreaterThanOrEqual(4);
		expect(rec.samples.length).toBeLessThanOrEqual(6);
	});

	test('says whether it stored anything', () => {
		const rec = createRecorder();

		expect(tickRecorder(rec, 0.05, {dist: 0, speed: 0, x: 0, z: 0, heading: 0})).toBe(false);
		expect(tickRecorder(rec, SAMPLE_EVERY_S, {dist: 0, speed: 0, x: 0, z: 0, heading: 0})).toBe(true);
	});

	test('nonsense is refused rather than stored', () => {
		const rec = createRecorder();

		expect(tickRecorder(rec, NaN, {dist: 0, speed: 0, x: 0, z: 0, heading: 0})).toBe(false);
		expect(tickRecorder(rec, 1, {dist: NaN, speed: 0, x: 0, z: 0, heading: 0})).toBe(false);
		expect(tickRecorder(rec, 1, {dist: 0, speed: NaN, x: 0, z: 0, heading: 0})).toBe(false);
		expect(rec.samples.length).toBe(0);
	});

	test('a missing position is zero, not undefined arithmetic', () => {
		const rec = createRecorder();

		tickRecorder(rec, SAMPLE_EVERY_S, {dist: 5, speed: 1, x: NaN, z: NaN, heading: NaN});

		expect(rec.samples[0]).toMatchObject({x: 0, z: 0, heading: 0});
	});

	test('one enormous frame does not stamp one enormous gap', () => {
		// What a backgrounded tab hands back.
		const rec = createRecorder();

		tickRecorder(rec, 600, {dist: 0, speed: 0, x: 0, z: 0, heading: 0});

		expect(rec.elapsed).toBeLessThanOrEqual(1);
	});

	test('never grows past its capacity', () => {
		const rec = createRecorder(10);

		drive(rec, 30, 10);

		expect(rec.samples.length).toBe(10);
	});
});

describe('orderedSamples', () => {
	test('oldest first before the ring has wrapped', () => {
		const rec = createRecorder(50);

		drive(rec, 4, 10);

		const out = orderedSamples(rec);

		for (let i = 1; i < out.length; i++) expect(out[i].t).toBeGreaterThan(out[i - 1].t);
	});

	test('oldest first AFTER the ring has wrapped', () => {
		// The one that matters: storage order and time order have diverged.
		const rec = createRecorder(10);

		drive(rec, 20, 10);

		const out = orderedSamples(rec);

		expect(out.length).toBe(10);
		for (let i = 1; i < out.length; i++) expect(out[i].t).toBeGreaterThan(out[i - 1].t);
	});

	test('the oldest samples are the ones dropped', () => {
		const rec = createRecorder(5);

		drive(rec, 10, 10);

		const out = orderedSamples(rec);

		expect(out[out.length - 1].t).toBeGreaterThan(out[0].t);
		expect(out[0].t).toBeGreaterThan(1);
	});

	test('an untouched recorder has nothing to give', () => {
		expect(orderedSamples(createRecorder())).toEqual([]);
	});
});

describe('samplesSince', () => {
	test('gives back only the recent ones', () => {
		const rec = createRecorder();

		drive(rec, 10, 10);

		const recent = samplesSince(rec, 2);

		expect(recent.length).toBeGreaterThan(4);
		expect(recent.length).toBeLessThan(15);
		expect(recent[0].t).toBeGreaterThan(7);
	});

	test('a nonsense window gives nothing rather than everything', () => {
		const rec = createRecorder();

		drive(rec, 5, 10);

		expect(samplesSince(rec, 0)).toEqual([]);
		expect(samplesSince(rec, NaN)).toEqual([]);
	});
});

describe('approachSamples', () => {
	test('the run in towards a marker, driving forwards', () => {
		const rec = createRecorder();

		drive(rec, 40, 10, 0, 1);   // 0 → 400 m

		const run = approachSamples(rec, 400, 1, 300);

		expect(run.length).toBeGreaterThan(10);
		expect(run[0].dist).toBeGreaterThanOrEqual(99);
		expect(run[run.length - 1].dist).toBeLessThanOrEqual(400);
	});

	test('and driving backwards, where the distance counts DOWN', () => {
		// Half of all driving. A filter written for one direction returns an
		// empty graph on the other, and an empty graph looks like a bug in the
		// card rather than in the filter.
		const rec = createRecorder();

		drive(rec, 40, 10, 400, -1);  // 400 → 0 m

		const run = approachSamples(rec, 0, -1, 300);

		expect(run.length).toBeGreaterThan(10);
		expect(run[0].dist).toBeLessThanOrEqual(301);
	});

	test('keeps a little of the overshoot, because that is the story', () => {
		const rec = createRecorder();

		drive(rec, 45, 10, 0, 1);   // runs 50 m past a marker at 400

		const run = approachSamples(rec, 400, 1, 300);
		const past = run.filter(s => metresToGo(s, 400, 1) < 0);

		expect(past.length).toBeGreaterThan(0);
	});

	test('a nonsense window gives nothing', () => {
		const rec = createRecorder();

		drive(rec, 10, 10);

		expect(approachSamples(rec, 100, 1, 0)).toEqual([]);
		expect(approachSamples(rec, NaN, 1, 300)).toEqual([]);
	});
});

describe('metresToGo', () => {
	const s = (dist: number): RunSample => ({t: 0, dist, speed: 0, x: 0, z: 0, heading: 0});

	test('positive before the marker, negative past it, both ways round', () => {
		expect(metresToGo(s(90), 100, 1)).toBe(10);
		expect(metresToGo(s(110), 100, 1)).toBe(-10);
		expect(metresToGo(s(110), 100, -1)).toBe(10);
		expect(metresToGo(s(90), 100, -1)).toBe(-10);
	});
});

describe('sampleAt', () => {
	const samples: RunSample[] = [
		{t: 0, dist: 0, speed: 10, x: 0, z: 0, heading: 0},
		{t: 1, dist: 10, speed: 20, x: 10, z: 0, heading: 1},
	];

	test('reads between two samples', () => {
		const mid = sampleAt(samples, 0.5);

		expect(mid!.dist).toBeCloseTo(5);
		expect(mid!.speed).toBeCloseTo(15);
	});

	test('clamps rather than extrapolating off the end', () => {
		expect(sampleAt(samples, -5)!.dist).toBe(0);
		expect(sampleAt(samples, 99)!.dist).toBe(10);
	});

	test('nothing recorded, nothing to read', () => {
		expect(sampleAt([], 1)).toBeNull();
	});

	test('turns the short way round through north', () => {
		// Crossing north is 350° → 10°: twenty degrees, not three hundred and
		// forty. Without this the camera whips the whole way round the compass.
		const across: RunSample[] = [
			{t: 0, dist: 0, speed: 0, x: 0, z: 0, heading: (350 * Math.PI) / 180},
			{t: 1, dist: 0, speed: 0, x: 0, z: 0, heading: (10 * Math.PI) / 180},
		];
		const mid = sampleAt(across, 0.5)!;
		const deg = ((mid.heading * 180) / Math.PI + 360) % 360;

		expect(Math.min(Math.abs(deg - 0), Math.abs(deg - 360))).toBeLessThan(1);
	});
});

describe('resetRecorder', () => {
	test('a new run starts from nothing', () => {
		const rec = createRecorder();

		drive(rec, 5, 10);
		resetRecorder(rec);

		expect(orderedSamples(rec)).toEqual([]);
		expect(rec.elapsed).toBe(0);
	});
});

describe('capacity', () => {
	test('holds a minute of driving', () => {
		expect(CAPACITY).toBe(300);
	});
});
