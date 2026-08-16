import {
	beginReplay, advanceReplay, replaySampleAt, replayCamera, canReplay,
	HOLD_AT_END_S, CAMERA_SIDE_M,
} from '../app/game/replay/StopReplay';
import type {RunSample} from '../app/game/replay/RunRecorder';

/** Run the replay for `seconds` in frames, as the game does. */
function run(state: Parameters<typeof advanceReplay>[0], seconds: number): boolean {
	let alive = true;

	for (let t = 0; t < seconds * 60; t++) alive = advanceReplay(state, 1 / 60);

	return alive;
}

/**
 * The stop replay.
 *
 * The things that would spoil it are all about the ENDING: a replay that runs
 * past its last sample and leaves the train sliding on, one that ends the
 * instant the train stops so the stop itself is never seen, and a camera that
 * stares at the platform so the whole approach is a distant speck.
 */

function approach(seconds: number, metres: number): RunSample[] {
	const out: RunSample[] = [];
	const steps = Math.round(seconds * 5);

	for (let i = 0; i <= steps; i++) {
		const f = i / steps;

		out.push({
			t: 100 + i * 0.2,             // a recorder clock that did not start at zero
			dist: metres * f,
			speed: 20 * (1 - f),
			x: metres * f,
			z: 0,
			heading: 0,
		});
	}

	return out;
}

describe('canReplay', () => {
	test('a real approach can be watched', () => {
		expect(canReplay(approach(10, 300))).toBe(true);
	});

	test('too few samples, or too short, is not worth showing', () => {
		expect(canReplay(approach(10, 300).slice(0, 4))).toBe(false);
		expect(canReplay(approach(1, 20))).toBe(false);
		expect(canReplay([])).toBe(false);
		expect(canReplay(null as never)).toBe(false);
	});
});

describe('beginReplay', () => {
	test('measures its own length from the samples', () => {
		const state = beginReplay(approach(10, 300))!;

		expect(state.durationS).toBeCloseTo(10, 1);
		expect(state.startT).toBe(100);
	});

	test('nothing to watch, nothing to start', () => {
		expect(beginReplay(approach(1, 10))).toBeNull();
	});
});

describe('advanceReplay', () => {
	test('runs at life speed', () => {
		const state = beginReplay(approach(10, 300))!;

		run(state, 3);

		expect(state.elapsed).toBeCloseTo(3, 1);
	});

	test('holds at the end so the stop itself is seen', () => {
		// Ending the moment the train stops would cut on the very frame the
		// replay exists to show.
		const state = beginReplay(approach(10, 300))!;

		run(state, 0.5);
		state.elapsed = state.durationS + HOLD_AT_END_S / 2;

		expect(advanceReplay(state, 0.01)).toBe(true);
	});

	test('and then it is over', () => {
		const state = beginReplay(approach(10, 300))!;

		state.elapsed = state.durationS + HOLD_AT_END_S + 0.1;

		expect(advanceReplay(state, 0.01)).toBe(false);
	});

	test('one enormous frame does not skip the whole replay', () => {
		const state = beginReplay(approach(10, 300))!;

		advanceReplay(state, 600);

		expect(state.elapsed).toBeLessThanOrEqual(0.5);
	});
});

describe('replaySampleAt', () => {
	test('reads the train back where it was', () => {
		const state = beginReplay(approach(10, 300))!;

		run(state, 5);

		expect(replaySampleAt(state)!.dist).toBeCloseTo(150, -1);
	});

	test('the hold shows the train STOPPED, not sliding on', () => {
		const state = beginReplay(approach(10, 300))!;

		state.elapsed = state.durationS + HOLD_AT_END_S * 0.9;

		const held = replaySampleAt(state)!;

		expect(held.dist).toBeCloseTo(300, 0);
		expect(held.speed).toBeCloseTo(0, 1);
	});
});

describe('replayCamera', () => {
	test('stands beside the line at the stop, not on it', () => {
		const state = beginReplay(approach(10, 300))!;
		const cam = replayCamera(state)!;
		const offA = Math.hypot(cam.position.x - 300, cam.position.z - 0);

		expect(offA).toBeCloseTo(CAMERA_SIDE_M, 0);
		expect(cam.position.y).toBeGreaterThan(2);
	});

	test('follows the train in rather than staring at the platform', () => {
		// A fixed target makes the first half of the approach a distant speck,
		// which is most of what there is to watch.
		const state = beginReplay(approach(10, 300))!;

		run(state, 1);
		const early = replayCamera(state)!.target.x;

		run(state, 6);
		const late = replayCamera(state)!.target.x;

		expect(late).toBeGreaterThan(early);
	});

	test('nothing recorded, no camera', () => {
		const state = beginReplay(approach(10, 300))!;

		state.samples = [];

		expect(replayCamera(state)).toBeNull();
	});
});
