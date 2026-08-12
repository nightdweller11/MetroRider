/**
 * Scoring one station stop.
 *
 * Pure state machine over per-frame samples so it can be unit-tested without
 * an engine: feed it `{trainDist, speed, doorsOpen}` each frame and it emits a
 * `StopResult` when the train has actually stopped in the station zone (or
 * rolled through it).
 *
 * Design rule from the feature brief: a missed stop scores zero, it never
 * shows a failure screen. Kids drive this.
 */

export interface StopSample {
	/** Distance along the track, meters. */
	trainDist: number;
	/** Meters per second. */
	speed: number;
	doorsOpen: boolean;
	/** Seconds since the previous sample. */
	dt: number;
}

export type StopVerdict = 'perfect' | 'great' | 'good' | 'off' | 'passed';
export type Smoothness = 'smooth' | 'firm' | 'rough';

export interface StopResult {
	stationIndex: number;
	/** Signed error: negative = short of the marker, positive = past it. */
	errorM: number;
	verdict: StopVerdict;
	/** Strongest deceleration seen on the approach, m/s². */
	peakDecel: number;
	smoothness: Smoothness;
	doorsOk: boolean;
	/** Whether the driver opened the doors at all. */
	doorsOpened: boolean;
	precisionPoints: number;
	smoothnessPoints: number;
	doorPoints: number;
	points: number;
}

/** How close to the marker counts as what. */
export const PERFECT_M = 2;
export const GREAT_M = 5;
export const GOOD_M = 12;

/** Inside this distance of the marker we are "at" the station. */
export const STOP_ZONE_M = 40;
/** Below this speed the train counts as stopped. */
export const STOPPED_SPEED = 0.4;
/** Approach tracking (and smoothness measurement) starts here. */
export const APPROACH_M = 300;

const SMOOTH_DECEL = 1.1;
const FIRM_DECEL = 2.0;

export function verdictFor(errorM: number): StopVerdict {
	const abs = Math.abs(errorM);
	if (abs <= PERFECT_M) return 'perfect';
	if (abs <= GREAT_M) return 'great';
	if (abs <= GOOD_M) return 'good';
	return 'off';
}

export function smoothnessFor(peakDecel: number): Smoothness {
	if (peakDecel <= SMOOTH_DECEL) return 'smooth';
	if (peakDecel <= FIRM_DECEL) return 'firm';
	return 'rough';
}

export function verdictLabel(verdict: StopVerdict): string {
	switch (verdict) {
		case 'perfect': return 'Perfect stop';
		case 'great': return 'Great stop';
		case 'good': return 'Good stop';
		case 'off': return 'Off the mark';
		case 'passed': return 'Rolled straight through';
	}
}

function precisionPoints(errorM: number): number {
	const abs = Math.abs(errorM);
	if (abs <= PERFECT_M) return 100;
	if (abs <= GREAT_M) return 80;
	if (abs <= GOOD_M) return 55;
	// Beyond "good" the points fade out rather than dropping to zero at a
	// cliff — stopping 13 m out should not feel the same as 40 m out.
	return Math.max(0, Math.round(55 - (abs - GOOD_M) * 2));
}

function smoothnessPoints(peakDecel: number): number {
	switch (smoothnessFor(peakDecel)) {
		case 'smooth': return 50;
		case 'firm': return 30;
		case 'rough': return 10;
	}
}

export class StopScorer {
	private stationIndex = -1;
	private markerDist = 0;
	private tracking = false;
	private peakDecel = 0;
	private lastSpeed = 0;
	private doorsOpened = false;
	private doorsWhileMoving = false;
	private settleTime = 0;
	private emitted = false;

	/** Begin scoring an approach to `stationIndex` at track distance `markerDist`. */
	public beginApproach(stationIndex: number, markerDist: number, currentSpeed: number): void {
		this.stationIndex = stationIndex;
		this.markerDist = markerDist;
		this.tracking = true;
		this.peakDecel = 0;
		this.lastSpeed = currentSpeed;
		this.doorsOpened = false;
		this.doorsWhileMoving = false;
		this.settleTime = 0;
		this.emitted = false;
	}

	public isTracking(): boolean {
		return this.tracking && !this.emitted;
	}

	public getStationIndex(): number {
		return this.stationIndex;
	}

	public reset(): void {
		this.tracking = false;
		this.emitted = false;
		this.stationIndex = -1;
	}

	/**
	 * Feed one frame. Returns a result the moment the stop is decided, else
	 * null. `direction` is +1 or -1 so the error sign means "past the marker"
	 * regardless of which way the train runs.
	 */
	public update(sample: StopSample, direction: number): StopResult | null {
		if (!this.tracking || this.emitted) return null;

		const dt = Math.max(1e-3, sample.dt);
		const decel = (this.lastSpeed - sample.speed) / dt;
		if (decel > this.peakDecel) this.peakDecel = decel;
		this.lastSpeed = sample.speed;

		if (sample.doorsOpen) {
			this.doorsOpened = true;
			// Doors open while rolling is the one thing that is always wrong.
			if (sample.speed > STOPPED_SPEED) this.doorsWhileMoving = true;
		}

		const signedError = (sample.trainDist - this.markerDist) * (direction >= 0 ? 1 : -1);

		// Stopped inside the zone → score it, once it has actually settled.
		if (Math.abs(signedError) <= STOP_ZONE_M && sample.speed <= STOPPED_SPEED) {
			this.settleTime += dt;
			if (this.settleTime >= 0.5) {
				return this.emit(signedError, false);
			}
			return null;
		}

		// Stopped SHORT of the zone and opened the doors: the driver has
		// declared this their stop, so score it rather than saying nothing.
		// Silence here was the first thing the live drive-through exposed —
		// braking 84 m early produced no card, no points and no explanation.
		if (sample.speed <= STOPPED_SPEED && sample.doorsOpen && signedError < 0) {
			this.settleTime += dt;
			if (this.settleTime >= 0.5) {
				return this.emit(signedError, false);
			}
			return null;
		}
		this.settleTime = 0;

		// Left the zone still moving → rolled through.
		if (signedError > STOP_ZONE_M && sample.speed > STOPPED_SPEED) {
			return this.emit(signedError, true);
		}

		return null;
	}

	/** Force a result (leaving the game, changing line) — never silently drop a stop. */
	public abandon(): StopResult | null {
		if (!this.tracking || this.emitted) return null;
		return this.emit(STOP_ZONE_M + 1, true);
	}

	private emit(signedError: number, passed: boolean): StopResult {
		this.emitted = true;
		this.tracking = false;

		const verdict: StopVerdict = passed ? 'passed' : verdictFor(signedError);
		const doorsOk = passed ? false : (this.doorsOpened && !this.doorsWhileMoving);

		const precision = passed ? 0 : precisionPoints(signedError);
		const smooth = passed ? 0 : smoothnessPoints(this.peakDecel);
		const doors = doorsOk ? 25 : 0;

		return {
			stationIndex: this.stationIndex,
			errorM: passed ? signedError : Math.round(signedError * 10) / 10,
			verdict,
			peakDecel: Math.round(this.peakDecel * 100) / 100,
			smoothness: smoothnessFor(this.peakDecel),
			doorsOk,
			doorsOpened: this.doorsOpened,
			precisionPoints: precision,
			smoothnessPoints: smooth,
			doorPoints: doors,
			points: precision + smooth + doors,
		};
	}
}
