import {
	createWalkState, stepWalk, look, clampPitch, distanceFromTrain, leashNotice,
	WALK_SPEED, RUN_SPEED, LEASH_WARN_M, LEASH_FAR_M, MAX_STEP_S,
	type WalkState, type WalkInput,
} from '../app/game/WalkController';

/** Flat ground, so movement can be checked without a terrain system. */
const flat = (): number => 0;

/** Walk for a whole second, in the frames the game would actually deliver. */
function walkFor(state: WalkState, input: WalkInput, seconds: number, ground = flat): void {
	const steps = Math.round(seconds / MAX_STEP_S);

	for (let i = 0; i < steps; i++) stepWalk(state, input, MAX_STEP_S, ground);
}

describe('walking', () => {
	test('facing north, forward goes north', () => {
		// Heading is clockwise from north and north is −z, the same convention
		// the train uses. A sign error here mirrors the whole world.
		const s = createWalkState(0, 0, 0);

		walkFor(s, {forward: 1, strafe: 0, running: false}, 1);

		expect(s.z).toBeCloseTo(-WALK_SPEED, 5);
		expect(s.x).toBeCloseTo(0, 5);
	});

	test('facing east, forward goes east', () => {
		const s = createWalkState(0, 0, Math.PI / 2);

		walkFor(s, {forward: 1, strafe: 0, running: false}, 1);

		expect(s.x).toBeCloseTo(WALK_SPEED, 5);
		expect(s.z).toBeCloseTo(0, 5);
	});

	test('strafing right of north goes east', () => {
		const s = createWalkState(0, 0, 0);

		walkFor(s, {forward: 0, strafe: 1, running: false}, 1);

		expect(s.x).toBeCloseTo(WALK_SPEED, 5);
	});

	test('running is faster than walking', () => {
		const walk = createWalkState(0, 0, 0);
		const run = createWalkState(0, 0, 0);

		walkFor(walk, {forward: 1, strafe: 0, running: false}, 1);
		walkFor(run, {forward: 1, strafe: 0, running: true}, 1);

		expect(Math.abs(run.z)).toBeCloseTo(RUN_SPEED, 5);
		expect(Math.abs(run.z)).toBeGreaterThan(Math.abs(walk.z));
	});

	test('diagonal is not a shortcut', () => {
		// Unnormalised, forward+strafe would be 1.41x walking speed and every
		// player would cross the city sideways.
		const straight = createWalkState(0, 0, 0);
		const diagonal = createWalkState(0, 0, 0);

		walkFor(straight, {forward: 1, strafe: 0, running: false}, 1);
		walkFor(diagonal, {forward: 1, strafe: 1, running: false}, 1);

		expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(Math.hypot(straight.x, straight.z), 5);
	});

	test('standing still stays still', () => {
		const s = createWalkState(10, 20, 1);

		stepWalk(s, {forward: 0, strafe: 0, running: false}, 1, flat);

		expect(s.x).toBe(10);
		expect(s.z).toBe(20);
	});

	test('follows the ground under it', () => {
		const s = createWalkState(0, 0, 0);

		stepWalk(s, {forward: 1, strafe: 0, running: false}, 1, () => 42);

		expect(s.groundY).toBe(42);
	});

	test('ground that is not a number does not become a position that is not a number', () => {
		// Walking off the edge of loaded terrain must not put the camera nowhere.
		const s = createWalkState(0, 0, 0, 12);

		stepWalk(s, {forward: 1, strafe: 0, running: false}, 1, () => NaN);

		expect(s.groundY).toBe(12);
		expect(Number.isFinite(s.x)).toBe(true);
		expect(Number.isFinite(s.z)).toBe(true);
	});

	test('a huge frame gap does not teleport the walker across the city', () => {
		const s = createWalkState(0, 0, 0);

		stepWalk(s, {forward: 1, strafe: 0, running: true}, 30, flat);

		expect(Math.abs(s.z)).toBeLessThanOrEqual(RUN_SPEED * MAX_STEP_S + 1e-6);
	});
});

describe('looking', () => {
	test('turning accumulates', () => {
		const s = createWalkState(0, 0, 0);

		look(s, 0.5, 0);
		look(s, 0.25, 0);

		expect(s.heading).toBeCloseTo(0.75, 5);
	});

	test('you cannot look further up than your neck goes', () => {
		expect(clampPitch(10)).toBeLessThan(1.6);
		expect(clampPitch(-10)).toBeGreaterThan(-1.6);
	});
});

describe('the leash', () => {
	test('says nothing while you are near the train', () => {
		expect(leashNotice(0)).toBe('none');
		expect(leashNotice(LEASH_WARN_M - 1)).toBe('none');
	});

	test('warns once you have wandered', () => {
		expect(leashNotice(LEASH_WARN_M)).toBe('warn');
	});

	test('offers the way back once the train is a long way off', () => {
		expect(leashNotice(LEASH_FAR_M)).toBe('far');
		expect(leashNotice(5000)).toBe('far');
	});

	test('measures the distance on the ground', () => {
		const s = createWalkState(30, 40, 0);

		expect(distanceFromTrain(s, {x: 0, z: 0})).toBeCloseTo(50, 5);
	});
});
