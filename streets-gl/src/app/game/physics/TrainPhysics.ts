import type {TrackData} from '../data/TrackBuilder';

const MAX_SPEED = 55; // m/s (~200 km/h)
const ACCEL = 5.0;
const BRAKE_FORCE = 6.0;
/** How firmly Simple driving pulls back toward the limit, m/s². */
const ASSIST_EASE = 1.4;
const FRICTION = 0.0;

export interface TrainPhysicsState {
	trainDist: number;
	trainSpeed: number;
	direction: number;
	doorsOpen: boolean;
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
	};
}

export function updateTrainPhysics(
	state: TrainPhysicsState,
	input: TrainInput,
	track: TrackData,
	dt: number,
): void {
	const assistScale = input.assist ? 0.6 : 1;
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
	if (input.throttle && state.trainSpeed < ceiling) {
		state.trainSpeed += ACCEL * assistScale * dt;
	} else if (input.emergency) {
		state.trainSpeed -= BRAKE_FORCE * 2 * dt;
	} else if (input.braking) {
		state.trainSpeed -= BRAKE_FORCE * dt;
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
