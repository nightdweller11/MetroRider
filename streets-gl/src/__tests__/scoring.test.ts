import {
	StopScorer, StopSample, verdictFor, smoothnessFor,
	PERFECT_M, GREAT_M, GOOD_M, STOP_ZONE_M,
} from '~/app/game/scoring/StopScorer';
import {RunScorer, badgesForRun, RunResult} from '~/app/game/scoring/RunScorer';
import type {StopResult} from '~/app/game/scoring/StopScorer';

/** Drive a scorer to a standstill at `stopDist`, braking from `fromSpeed`. */
function driveToStop(
	scorer: StopScorer,
	markerDist: number,
	stopDist: number,
	opts: {fromSpeed?: number; decel?: number; doorsAt?: 'stopped' | 'moving' | 'never'; direction?: number} = {},
): StopResult | null {
	const fromSpeed = opts.fromSpeed ?? 15;
	const decel = opts.decel ?? 1.0;
	const direction = opts.direction ?? 1;
	const doorsAt = opts.doorsAt ?? 'stopped';

	scorer.beginApproach(0, markerDist, fromSpeed);

	let speed = fromSpeed;
	let dist = stopDist - direction * (fromSpeed * fromSpeed) / (2 * decel);
	const dt = 0.05;
	let result: StopResult | null = null;

	// braking phase
	while (speed > 0 && !result) {
		speed = Math.max(0, speed - decel * dt);
		dist += direction * speed * dt;
		const sample: StopSample = {
			trainDist: dist,
			speed,
			doorsOpen: doorsAt === 'moving' && speed > 1,
			dt,
		};
		result = scorer.update(sample, direction);
	}

	// stopped phase (doors + settle)
	for (let i = 0; i < 40 && !result; i++) {
		result = scorer.update({
			trainDist: dist, speed: 0,
			doorsOpen: doorsAt === 'stopped' || doorsAt === 'moving',
			dt,
		}, direction);
	}

	return result;
}

describe('StopScorer — verdicts', () => {
	it('grades by distance from the mark', () => {
		expect(verdictFor(0)).toBe('perfect');
		expect(verdictFor(PERFECT_M)).toBe('perfect');
		expect(verdictFor(-PERFECT_M)).toBe('perfect');
		expect(verdictFor(GREAT_M)).toBe('great');
		expect(verdictFor(GOOD_M)).toBe('good');
		expect(verdictFor(GOOD_M + 1)).toBe('off');
	});

	it('scores a bullseye stop as perfect with full precision points', () => {
		const r = driveToStop(new StopScorer(), 1000, 1000);

		expect(r).not.toBeNull();
		expect(r!.verdict).toBe('perfect');
		expect(r!.precisionPoints).toBe(100);
		expect(Math.abs(r!.errorM)).toBeLessThanOrEqual(PERFECT_M);
	});

	it('scores a stop 8 m short as good, not perfect', () => {
		const r = driveToStop(new StopScorer(), 1000, 992);

		expect(r!.verdict).toBe('good');
		expect(r!.errorM).toBeLessThan(0); // short of the marker
		expect(r!.precisionPoints).toBe(55);
	});

	it('fades points out beyond "good" instead of dropping to zero at a cliff', () => {
		const near = driveToStop(new StopScorer(), 1000, 1000 - (GOOD_M + 2));
		const far = driveToStop(new StopScorer(), 1000, 1000 - (GOOD_M + 20));

		expect(near!.precisionPoints).toBeGreaterThan(far!.precisionPoints);
		expect(far!.precisionPoints).toBeGreaterThanOrEqual(0);
	});

	it('signs the error the same way whichever direction the train runs', () => {
		const forward = driveToStop(new StopScorer(), 1000, 1006, {direction: 1});
		const backward = driveToStop(new StopScorer(), 1000, 994, {direction: -1});

		// Both overshot the marker by ~6 m in their own direction of travel.
		expect(forward!.errorM).toBeGreaterThan(0);
		expect(backward!.errorM).toBeGreaterThan(0);
	});
});

describe('StopScorer — smoothness', () => {
	it('classifies braking force the way a passenger would feel it', () => {
		expect(smoothnessFor(0.8)).toBe('smooth');
		expect(smoothnessFor(1.5)).toBe('firm');
		expect(smoothnessFor(3.0)).toBe('rough');
	});

	it('gives fewer points for a harsh stop than a gentle one', () => {
		const gentle = driveToStop(new StopScorer(), 1000, 1000, {decel: 0.8});
		const harsh = driveToStop(new StopScorer(), 1000, 1000, {decel: 3.5});

		expect(gentle!.smoothness).toBe('smooth');
		expect(harsh!.smoothness).toBe('rough');
		expect(gentle!.smoothnessPoints).toBeGreaterThan(harsh!.smoothnessPoints);
	});
});

describe('StopScorer — doors', () => {
	it('awards door points for opening at a standstill', () => {
		const r = driveToStop(new StopScorer(), 1000, 1000, {doorsAt: 'stopped'});

		expect(r!.doorsOk).toBe(true);
		expect(r!.doorPoints).toBe(25);
	});

	it('gives no door points when the doors never opened', () => {
		const r = driveToStop(new StopScorer(), 1000, 1000, {doorsAt: 'never'});

		expect(r!.doorsOpened).toBe(false);
		expect(r!.doorPoints).toBe(0);
	});

	it('refuses door points when the doors opened while still rolling', () => {
		const r = driveToStop(new StopScorer(), 1000, 1000, {doorsAt: 'moving'});

		expect(r!.doorsOk).toBe(false);
		expect(r!.doorPoints).toBe(0);
	});
});

describe('StopScorer — rolling through', () => {
	it('scores zero and says so, without a failure state', () => {
		const scorer = new StopScorer();
		scorer.beginApproach(3, 1000, 20);

		let result: StopResult | null = null;
		let dist = 900;
		while (!result && dist < 1200) {
			dist += 20 * 0.05;
			result = scorer.update({trainDist: dist, speed: 20, doorsOpen: false, dt: 0.05}, 1);
		}

		expect(result).not.toBeNull();
		expect(result!.verdict).toBe('passed');
		expect(result!.points).toBe(0);
		expect(result!.stationIndex).toBe(3);
	});

	it('emits exactly one result per approach', () => {
		const scorer = new StopScorer();
		const first = driveToStop(scorer, 1000, 1000);

		expect(first).not.toBeNull();
		expect(scorer.isTracking()).toBe(false);
		expect(scorer.update({trainDist: 1000, speed: 0, doorsOpen: true, dt: 0.05}, 1)).toBeNull();
	});

	it('never silently drops a stop when the player leaves', () => {
		const scorer = new StopScorer();
		scorer.beginApproach(2, 1000, 10);
		scorer.update({trainDist: 950, speed: 10, doorsOpen: false, dt: 0.05}, 1);

		const abandoned = scorer.abandon();
		expect(abandoned).not.toBeNull();
		expect(abandoned!.verdict).toBe('passed');
		expect(scorer.abandon()).toBeNull(); // only once
	});

	it('scores a stop short of the zone once the doors open', () => {
		const scorer = new StopScorer();
		scorer.beginApproach(1, 1000, 12);

		// Stopped 84 m short — outside the stop zone — then the driver opens up.
		let result: StopResult | null = null;
		for (let i = 0; i < 30 && !result; i++) {
			result = scorer.update({trainDist: 916, speed: 0, doorsOpen: true, dt: 0.1}, 1);
		}

		expect(result).not.toBeNull();
		expect(result!.verdict).toBe('off');
		expect(result!.errorM).toBeCloseTo(-84, 0);
		expect(result!.doorPoints).toBe(25); // the doors themselves were fine
	});

	it('stays quiet when stopped short with the doors still shut', () => {
		const scorer = new StopScorer();
		scorer.beginApproach(1, 1000, 12);

		for (let i = 0; i < 30; i++) {
			expect(scorer.update({trainDist: 916, speed: 0, doorsOpen: false, dt: 0.1}, 1)).toBeNull();
		}
		expect(scorer.isTracking()).toBe(true); // still their approach to finish
	});

	it('ignores samples before an approach begins', () => {
		const scorer = new StopScorer();
		expect(scorer.update({trainDist: 10, speed: 0, doorsOpen: true, dt: 0.1}, 1)).toBeNull();
	});
});

const stopResult = (over: Partial<StopResult> = {}): StopResult => ({
	stationIndex: 0, errorM: 1, verdict: 'perfect', peakDecel: 0.9, smoothness: 'smooth',
	doorsOk: true, doorsOpened: true, precisionPoints: 100, smoothnessPoints: 50,
	doorPoints: 25, points: 175, ...over,
});

describe('RunScorer', () => {
	const ctx = {mapId: 'm1', lineId: 'l1', lineName: 'Red Line', stationCount: 4, isLoop: false};

	it('totals the stops it was given', () => {
		const run = new RunScorer();
		run.start(ctx, 0);
		run.addStop(stopResult({stationIndex: 0}));
		run.addStop(stopResult({stationIndex: 1, points: 120}));

		expect(run.getTotalPoints()).toBe(295);
	});

	it('produces a summary in plain language', () => {
		const run = new RunScorer();
		run.start(ctx, 0);
		run.addStop(stopResult({stationIndex: 0}));
		run.addStop(stopResult({stationIndex: 1, verdict: 'passed', points: 0}));

		const result = run.finalize(60_000, {delivered: 42, leftBehind: 7}, false)!;

		expect(result.summary).toContain('1 stop made');
		expect(result.summary).toContain('1 perfect');
		expect(result.summary).toContain('1 rolled through');
		expect(result.summary).toContain('42 passengers delivered');
		expect(result.summary).toContain('7 left waiting');
		expect(result.durationMs).toBe(60_000);
	});

	it('returns nothing when no stop was attempted', () => {
		const run = new RunScorer();
		run.start(ctx, 0);

		expect(run.finalize(1000, {delivered: 0, leftBehind: 0}, false)).toBeNull();
	});

	it('counts a non-loop line complete at a terminus after real stops', () => {
		const run = new RunScorer();
		run.start(ctx, 0);
		run.addStop(stopResult({stationIndex: 1}));

		expect(run.isComplete(3)).toBe(false); // only one station visited

		run.addStop(stopResult({stationIndex: 2}));
		expect(run.isComplete(2)).toBe(false); // not a terminus
		expect(run.isComplete(3)).toBe(true);  // last station
		expect(run.isComplete(0)).toBe(true);  // the other end counts too
	});

	it('counts a loop line complete only after every station is served', () => {
		const run = new RunScorer();
		run.start({...ctx, isLoop: true, stationCount: 3}, 0);

		run.addStop(stopResult({stationIndex: 0}));
		run.addStop(stopResult({stationIndex: 1}));
		expect(run.isComplete(1)).toBe(false);

		run.addStop(stopResult({stationIndex: 2}));
		expect(run.isComplete(2)).toBe(true);
	});

	it('does not count a rolled-through station as visited', () => {
		const run = new RunScorer();
		run.start({...ctx, isLoop: true, stationCount: 2}, 0);
		run.addStop(stopResult({stationIndex: 0}));
		run.addStop(stopResult({stationIndex: 1, verdict: 'passed', points: 0}));

		expect(run.isComplete(1)).toBe(false);
	});

	it('clears itself after finalizing so the next run starts fresh', () => {
		const run = new RunScorer();
		run.start(ctx, 0);
		run.addStop(stopResult());
		run.finalize(1000, {delivered: 0, leftBehind: 0}, true);

		expect(run.isActive()).toBe(false);
		expect(run.getTotalPoints()).toBe(0);
	});
});

describe('badges', () => {
	const baseRun = (over: Partial<RunResult> = {}): RunResult => ({
		mapId: 'm', lineId: 'l', lineName: 'Line', stops: [stopResult()], stationCount: 3,
		totalPoints: 175, averagePoints: 175, perfectStops: 1, passengersDelivered: 10,
		passengersLeftBehind: 0, durationMs: 1000, completedLine: false, summary: '', ...over,
	});

	it('awards a perfect-stop badge', () => {
		expect(badgesForRun(baseRun(), 12).map(b => b.id)).toContain('perfect-stop');
	});

	it('awards the five-perfect badge only at five', () => {
		expect(badgesForRun(baseRun({perfectStops: 4}), 12).map(b => b.id)).not.toContain('five-perfect');
		expect(badgesForRun(baseRun({perfectStops: 5}), 12).map(b => b.id)).toContain('five-perfect');
	});

	it('awards every-stop-served only when nothing was rolled through', () => {
		const clean = badgesForRun(baseRun(), 12).map(b => b.id);
		const messy = badgesForRun(baseRun({
			stops: [stopResult(), stopResult({verdict: 'passed'})],
		}), 12).map(b => b.id);

		expect(clean).toContain('every-stop');
		expect(messy).not.toContain('every-stop');
	});

	it('awards the night owl badge only in the small hours', () => {
		expect(badgesForRun(baseRun(), 3).map(b => b.id)).toContain('night-owl');
		expect(badgesForRun(baseRun(), 14).map(b => b.id)).not.toContain('night-owl');
	});

	it('awards busy service at a hundred passengers', () => {
		expect(badgesForRun(baseRun({passengersDelivered: 99}), 12).map(b => b.id)).not.toContain('busy-service');
		expect(badgesForRun(baseRun({passengersDelivered: 100}), 12).map(b => b.id)).toContain('busy-service');
	});
});

describe('constants sanity', () => {
	it('keeps the stop zone larger than the "good" band', () => {
		expect(STOP_ZONE_M).toBeGreaterThan(GOOD_M);
	});
});
