import type {TrackData} from '../data/TrackBuilder';

const MAX_SPEED = 55; // m/s (~200 km/h)
const ACCEL = 5.0;
const BRAKE_FORCE = 6.0;
/** How firmly Simple driving pulls back toward the limit, m/s². */
const ASSIST_EASE = 1.4;
/**
 * Handle movement, in fraction of full travel per second.
 *
 * ~1.6 s from neutral to full power and ~0.4 s back off it. Slow enough that
 * the lever visibly steps through P1–P4 and a train leaves a platform the way
 * a train does; fast enough that a child holding the button does not feel the
 * game is ignoring them.
 */
const NOTCH_ON_RATE = 0.62;
const NOTCH_OFF_RATE = 2.5;
/** The emergency handle goes over fast — that is the point of it. */
const EMERGENCY_APPLY_S = 0.25;

/** Move `value` toward `target` at `rate` per second, without overshooting. */
function approach(value: number, target: number, rate: number, dt: number): number {
	const step = rate * dt;

	if (value < target) return Math.min(target, value + step);
	if (value > target) return Math.max(target, value - step);

	return value;
}
const FRICTION = 0.0;

export interface TrainPhysicsState {
	trainDist: number;
	trainSpeed: number;
	direction: number;
	doorsOpen: boolean;
	/**
	 * Where the power handle actually is, 0 (neutral) to 1 (full).
	 *
	 * A real train does not go from nothing to full power the instant a handle
	 * moves, and the cab lever is drawn with notches — P1 to P4 — that were
	 * showing only "off" or "everything". Holding the throttle now winds the
	 * handle up through them, which is both what the instrument claims is
	 * happening and a gentler start out of a station.
	 */
	powerNotch: number;
	/** Where the brake handle is, 0 to 1. Same story as the power handle. */
	brakeNotch: number;
}

export interface TrainInput {
	/**
	 * Simple driving: acceleration is gentler and the train eases itself back
	 * under the line limit instead of running away.
	 *
	 * In Advanced the limit stays purely informational and nothing brakes for
	 * you — that is the whole point of it being a sign rather than a leash.
	 * Simple is for someone who is holding the throttle down because holding
	 * the throttle down is fun, and should not end up at 200 km/h in a curve.
	 */
	assist?: boolean;
	/** The limit to ease back to when assisting, km/h. 0 disables the ease. */
	assistLimitKmh?: number;
	/**
	 * How hard this vehicle pulls and stops, as multipliers on the base rates.
	 *
	 * A tram is light and gets away from a stop briskly; a high-speed train is
	 * heavy and winds up slowly but keeps going far past where the tram gave
	 * up. Without these, every mode reached its own top speed at exactly the
	 * same rate and the only difference between driving a tram and driving a
	 * bullet train was the number the dial stopped at.
	 *
	 * Absent means 1 — the behaviour every existing caller already had.
	 */
	accelScale?: number;
	brakeScale?: number;
	throttle: boolean;
	braking: boolean;
	emergency: boolean;
}

export function createTrainPhysicsState(initialDist: number = 60): TrainPhysicsState {
	return {
		trainDist: initialDist,
		trainSpeed: 0,
		direction: 1,
		doorsOpen: false,
		powerNotch: 0,
		brakeNotch: 0,
	};
}

export function updateTrainPhysics(
	state: TrainPhysicsState,
	input: TrainInput,
	track: TrackData,
	dt: number,
): void {
	const assistScale = input.assist ? 0.6 : 1;
	// Absent → 1, so every existing caller keeps exactly its old behaviour.
	const accelScale = input.accelScale && input.accelScale > 0 ? input.accelScale : 1;
	const brakeScale = input.brakeScale && input.brakeScale > 0 ? input.brakeScale : 1;
	// The speed Simple driving will not let the throttle carry you past. A small
	// margin over the sign so the train is not permanently shaving the number.
	const ceiling =
		input.assist && input.assistLimitKmh && input.assistLimitKmh > 0
			? (input.assistLimitKmh * 1.05) / 3.6
			: Infinity;

	// Above the ceiling the throttle stops adding speed. Measured on 2026-08-13:
	// leaving it live meant assisted acceleration (3.0 m/s²) simply outran the
	// ease (1.4 m/s²) and the train still reached 132 km/h against a 55 limit —
	// the assist looked applied and did nothing.
	const wantsPower = input.throttle && state.trainSpeed < ceiling;

	// Wind the handles toward where the driver is asking, rather than snapping.
	// Coming off is quicker than going on, as it is in a cab: you can always
	// drop power immediately, but you cannot slam to full.
	state.powerNotch = approach(state.powerNotch, wantsPower ? 1 : 0, wantsPower ? NOTCH_ON_RATE : NOTCH_OFF_RATE, dt);
	state.brakeNotch = approach(
		state.brakeNotch,
		input.emergency ? 1 : input.braking ? 1 : 0,
		input.emergency ? 1 / EMERGENCY_APPLY_S : NOTCH_ON_RATE,
		dt,
	);

	if (state.powerNotch > 0 && !input.braking && !input.emergency) {
		state.trainSpeed += ACCEL * accelScale * assistScale * state.powerNotch * dt;
	}

	if (input.emergency) {
		state.trainSpeed -= BRAKE_FORCE * brakeScale * 2 * state.brakeNotch * dt;
	} else if (input.braking) {
		state.trainSpeed -= BRAKE_FORCE * brakeScale * state.brakeNotch * dt;
	} else {
		state.trainSpeed -= FRICTION * dt;
	}

	state.trainSpeed = Math.max(0, Math.min(MAX_SPEED, state.trainSpeed));

	// Ease back rather than snap: a hard clamp feels like the game grabbing
	// the controls, a gentle pull feels like the train settling. This also
	// covers arriving over the ceiling because the limit dropped underneath you.
	if (state.trainSpeed > ceiling) {
		state.trainSpeed = Math.max(ceiling, state.trainSpeed - ASSIST_EASE * dt);
	}

	if (state.doorsOpen && state.trainSpeed > 0.1) {
		state.trainSpeed = 0;
	}

	state.trainDist += state.trainSpeed * dt * state.direction;

	if (track.isLoop) {
		// Closed loop: wrap around instead of stopping at the ends.
		const L = track.totalLength;
		if (L > 0) {
			state.trainDist = ((state.trainDist % L) + L) % L;
		}
	} else {
		state.trainDist = Math.max(0, Math.min(track.totalLength, state.trainDist));

		if (state.trainDist <= 5 || state.trainDist >= track.totalLength - 5) {
			state.trainSpeed = 0;
		}
	}
}

export function getMaxSpeed(): number {
	return MAX_SPEED;
}
