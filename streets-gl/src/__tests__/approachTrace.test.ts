import {buildApproachTrace, MIN_POINTS, TRACE_WINDOW_M} from '../app/game/replay/ApproachTrace';
import type {RunSample} from '../app/game/replay/RunRecorder';

/**
 * The approach trace.
 *
 * The failure that matters is the quiet one: a graph that draws a flat line,
 * or nothing, and looks like a train that stood still rather than like a bug.
 * So the tests check that a real approach produces a real shape, that too
 * little data draws NOTHING rather than a straight line between two guesses,
 * and that a stop past the mark is drawn past the mark.
 */

/** An approach from `fromM` out, braking to a stand at `errorM` past the mark. */
function approach(fromM: number, topKmh: number, errorM: number, dir = 1): RunSample[] {
	const marker = 1000;
	const out: RunSample[] = [];
	const steps = 40;

	for (let i = 0; i <= steps; i++) {
		const f = i / steps;
		const to = fromM * (1 - f) - errorM * f;      // metres still to run
		const kmh = topKmh * (1 - f);
		const dist = dir >= 0 ? marker - to : marker + to;

		out.push({t: i * 0.2, dist, speed: kmh / 3.6, x: dist, z: 0, heading: 0});
	}

	return out;
}

describe('buildApproachTrace', () => {
	test('a real approach makes a real path', () => {
		const trace = buildApproachTrace(approach(300, 80, 0), 1000, 1, 200, 60);

		expect(trace).not.toBeNull();
		expect(trace!.path.startsWith('M')).toBe(true);
		expect(trace!.path.split('L').length).toBeGreaterThan(10);
	});

	test('draws nothing when there is not enough to say', () => {
		const few = approach(300, 80, 0).slice(0, MIN_POINTS - 1);

		expect(buildApproachTrace(few, 1000, 1, 200, 60)).toBeNull();
		expect(buildApproachTrace([], 1000, 1, 200, 60)).toBeNull();
	});

	test('a nonsense box draws nothing', () => {
		const s = approach(300, 80, 0);

		expect(buildApproachTrace(s, 1000, 1, 0, 60)).toBeNull();
		expect(buildApproachTrace(s, NaN, 1, 200, 60)).toBeNull();
	});

	test('speed runs up the box: fast is high, stopped is the floor', () => {
		const trace = buildApproachTrace(approach(300, 80, 0), 1000, 1, 200, 60)!;
		const ys = trace.path.match(/ (-?[\d.]+)(?= |$)/g)!.map(Number);

		// The first point is the fastest, so it sits nearest the top (y small).
		expect(ys[0]).toBeLessThan(ys[ys.length - 1]);
		expect(ys[ys.length - 1]).toBeCloseTo(60, 0);
	});

	test('the axis top is a round number above the fastest', () => {
		expect(buildApproachTrace(approach(300, 78, 0), 1000, 1, 200, 60)!.topKmh).toBe(80);
		expect(buildApproachTrace(approach(300, 41, 0), 1000, 1, 200, 60)!.topKmh).toBe(60);
	});

	test('a stop on the mark lands on the marker line', () => {
		const trace = buildApproachTrace(approach(300, 60, 0), 1000, 1, 200, 60)!;

		expect(trace.stop).not.toBeNull();
		expect(Math.abs(trace.stop!.x - trace.markerX)).toBeLessThan(6);
	});

	test('a stop PAST the mark is drawn past the mark', () => {
		// The whole point of the picture. Clamping the overshoot onto the line
		// would hide exactly the mistake it is meant to show.
		const trace = buildApproachTrace(approach(300, 60, 40), 1000, 1, 200, 60)!;

		expect(trace.stop!.x).toBeGreaterThan(trace.markerX + 2);
		expect(trace.stop!.x).toBeLessThanOrEqual(trace.width + 0.5);
	});

	test('and a stop short of the mark short of it', () => {
		const trace = buildApproachTrace(approach(300, 60, -35), 1000, 1, 200, 60)!;

		expect(trace.stop!.x).toBeLessThan(trace.markerX - 2);
	});

	test('works driving backwards, where track distance counts down', () => {
		// Half of all driving. This produced an empty graph until the direction
		// was threaded through.
		const trace = buildApproachTrace(approach(300, 60, 0), 1000, -1, 200, 60);

		expect(trace).not.toBeNull();
		expect(trace!.path.split('L').length).toBeGreaterThan(10);
	});

	test('a train that never slowed still draws, with no stop marked', () => {
		const rolling = approach(300, 60, 0).map(s => ({...s, speed: 16}));
		const trace = buildApproachTrace(rolling, 1000, 1, 200, 60)!;

		expect(trace.path.length).toBeGreaterThan(10);
		expect(trace.stop).toBeNull();
	});

	test('every point stays inside the box', () => {
		const trace = buildApproachTrace(approach(420, 120, 25), 1000, 1, 240, 70)!;
		const coords = trace.path.replace(/[ML]/g, ' ').trim().split(/\s+/).map(Number);

		for (let i = 0; i < coords.length; i += 2) {
			expect(coords[i]).toBeGreaterThanOrEqual(-0.5);
			expect(coords[i]).toBeLessThanOrEqual(240.5);
			expect(coords[i + 1]).toBeGreaterThanOrEqual(-0.5);
			expect(coords[i + 1]).toBeLessThanOrEqual(70.5);
		}
	});

	test('a longer run-in widens the axis rather than clipping it', () => {
		const trace = buildApproachTrace(approach(500, 90, 0), 1000, 1, 200, 60)!;

		expect(trace.fromM).toBeGreaterThanOrEqual(500);
		expect(trace.fromM).toBeGreaterThan(TRACE_WINDOW_M);
	});
});
