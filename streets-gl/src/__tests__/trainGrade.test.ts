/**
 * Gravity along the rail.
 *
 * The one force here that acts whether or not the driver is doing anything: a
 * train coasting down a bank picks up speed, one climbing loses it. Before
 * this a train climbed a hill exactly as fast as it ran on the flat, which is
 * the one thing everybody knows trains do not do.
 */
import {createTrainPhysicsState, updateTrainPhysics, getMaxSpeed} from '~/app/game/physics/TrainPhysics';

const track = {totalLength: 100000, isLoop: false} as never;

/** Coast for `seconds` on a given grade, starting at `startMs`. */
function coast(seconds: number, grade: number | undefined, startMs = 20): number {
	const state = createTrainPhysicsState(1000);
	const dt = 1 / 60;

	state.trainSpeed = startMs;

	for (let t = 0; t < seconds * 60; t++) {
		updateTrainPhysics(
			state,
			{throttle: false, braking: false, emergency: false, grade},
			track,
			dt,
		);
	}

	return state.trainSpeed;
}

describe('gravity on a gradient', () => {
	it('leaves a flat run exactly as it was', () => {
		// No grade at all, and an explicit zero, must both be the old behaviour.
		expect(coast(10, undefined)).toBeCloseTo(20, 6);
		expect(coast(10, 0)).toBeCloseTo(20, 6);
	});

	it('slows a train going uphill and speeds one going down', () => {
		const up = coast(10, 0.02);
		const down = coast(10, -0.02);

		expect(up).toBeLessThan(20);
		expect(down).toBeGreaterThan(20);
	});

	it('pulls at g times the gradient', () => {
		// A 2% bank is 9.81 x 0.02 = 0.196 m/s², so ~1.96 m/s over ten seconds.
		const lost = 20 - coast(10, 0.02);

		expect(lost).toBeCloseTo(9.81 * 0.02 * 10, 1);
	});

	it('is steeper on a steeper hill', () => {
		expect(20 - coast(5, 0.04)).toBeGreaterThan(20 - coast(5, 0.01));
	});

	it('refuses to act on a cliff', () => {
		// A MetroDreamin line is drawn across real terrain without regard for
		// it, so a route CAN cross a 60% face. Unclamped, one sample off that
		// would stop the train dead or fire it down the hill.
		const cliff = coast(5, 0.6);
		const steepestReal = coast(5, 0.09);

		expect(cliff).toBeCloseTo(steepestReal, 6);

		const downCliff = coast(5, -0.6);
		const downSteepest = coast(5, -0.09);

		expect(downCliff).toBeCloseTo(downSteepest, 6);
	});

	it('never drives the train backwards, however steep the climb', () => {
		// Speed is a magnitude here — direction is separate — so a hill must
		// bring the train to a stand, not through it into negative numbers.
		expect(coast(60, 0.09, 5)).toBe(0);
	});

	it('still cannot exceed the vehicle ceiling on a long descent', () => {
		// Read the real ceiling rather than repeating the number: this assertion
		// hard-coded 55 and started failing the day the top speed moved to 56,
		// reporting a physics regression that was nothing of the sort.
		expect(coast(600, -0.09, 50)).toBeLessThanOrEqual(getMaxSpeed());
	});

	it('does not move a train standing at a platform with its doors open', () => {
		const state = createTrainPhysicsState(1000);

		state.doorsOpen = true;

		for (let t = 0; t < 300; t++) {
			updateTrainPhysics(
				state,
				{throttle: false, braking: false, emergency: false, grade: -0.05},
				track,
				1 / 60,
			);
		}

		expect(state.trainSpeed).toBe(0);
	});
});
