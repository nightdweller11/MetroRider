import {notchDemand} from '../app/game/ui/CabHud';
import {createTrainPhysicsState, updateTrainPhysics, type TrainInput} from '../app/game/physics/TrainPhysics';
import type {TrackData} from '../app/game/data/TrackBuilder';

/**
 * The master controller — one handle running P4 · P3 · P2 · P1 · N · B1 · B2.
 *
 * These exist because the panel carried that scale for nine releases while
 * being wired as two hold-to-apply buttons with nothing drawn to grab. A tap
 * moved the notch about six percent and let it fall straight back, so tapping
 * the control did nothing anybody could see.
 */

const track: TrackData = {
	spline: {points: [[0, 0], [1, 0]], stationIndices: [0, 1]},
	cumDist: [0, 100000],
	totalLength: 100000,
	stationDists: [0, 100000],
	isLoop: false,
} as unknown as TrackData;

const idle: TrainInput = {throttle: false, braking: false, emergency: false};

/** Run the physics for `seconds` at 20 Hz. */
function run(state: ReturnType<typeof createTrainPhysicsState>, input: TrainInput, seconds: number): void {
	for (let t = 0; t < seconds * 20; t++) updateTrainPhysics(state, input, track, 0.05);
}

describe('notchDemand', () => {
	test('neutral asks for nothing', () => {
		expect(notchDemand(4)).toEqual({power: 0, brake: 0});
	});

	test('power steps up in quarters, so P1 is a gentle start', () => {
		expect(notchDemand(3)).toEqual({power: 0.25, brake: 0});
		expect(notchDemand(2)).toEqual({power: 0.5, brake: 0});
		expect(notchDemand(1)).toEqual({power: 0.75, brake: 0});
		expect(notchDemand(0)).toEqual({power: 1, brake: 0});
	});

	test('the two brake steps hold a stop and then everything', () => {
		expect(notchDemand(5).brake).toBeGreaterThan(0);
		expect(notchDemand(5).brake).toBeLessThan(1);
		expect(notchDemand(6).brake).toBe(1);
	});

	test('never asks for power and brake at once', () => {
		for (let i = 0; i < 7; i++) {
			const d = notchDemand(i);

			expect(d.power === 0 || d.brake === 0).toBe(true);
		}
	});
});

describe('a notch the driver set stays set', () => {
	test('P2 holds half power for as long as it is left there', () => {
		const state = createTrainPhysicsState();
		const input: TrainInput = {...idle, powerLevel: 0.5};

		run(state, input, 6);

		// The whole point of a detented controller: nothing sprang back.
		expect(state.powerNotch).toBeCloseTo(0.5, 2);
		expect(state.trainSpeed).toBeGreaterThan(5);
	});

	test('P2 accelerates about half as hard as P4', () => {
		const half = createTrainPhysicsState();
		const full = createTrainPhysicsState();

		run(half, {...idle, powerLevel: 0.5}, 6);
		run(full, {...idle, powerLevel: 1}, 6);

		const ratio = half.trainSpeed / full.trainSpeed;

		expect(ratio).toBeGreaterThan(0.4);
		expect(ratio).toBeLessThan(0.62);
	});

	test('a brake notch actually stops the train', () => {
		// This is the failure the boolean gate hid: the gauge wound up and the
		// train kept rolling, because the force was gated on a key being down.
		const state = createTrainPhysicsState();

		run(state, {...idle, powerLevel: 1}, 6);
		const cruising = state.trainSpeed;

		run(state, {...idle, brakeLevel: 1}, 6);

		expect(cruising).toBeGreaterThan(10);
		expect(state.trainSpeed).toBeLessThan(cruising / 2);
	});

	test('B1 stops more gently than B2', () => {
		const gentle = createTrainPhysicsState();
		const hard = createTrainPhysicsState();

		run(gentle, {...idle, powerLevel: 1}, 6);
		run(hard, {...idle, powerLevel: 1}, 6);
		run(gentle, {...idle, brakeLevel: 0.55}, 1.5);
		run(hard, {...idle, brakeLevel: 1}, 1.5);

		expect(gentle.trainSpeed).toBeGreaterThan(hard.trainSpeed);
	});
});

describe('the keyboard and the handle do not fight', () => {
	test('a held key wins over a handle left at neutral', () => {
		const state = createTrainPhysicsState();

		run(state, {...idle, throttle: true, powerLevel: 0}, 5);

		expect(state.trainSpeed).toBeGreaterThan(5);
	});

	test('a keyboard brake overrides a handle asking for power', () => {
		const state = createTrainPhysicsState();

		run(state, {...idle, powerLevel: 1}, 6);
		const cruising = state.trainSpeed;

		run(state, {...idle, powerLevel: 1, braking: true}, 4);

		expect(state.trainSpeed).toBeLessThan(cruising);
	});
});
