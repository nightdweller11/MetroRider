import type {TrackData} from '../data/TrackBuilder';

const MAX_SPEED = 55; // m/s (~200 km/h)
const ACCEL = 5.0;
const BRAKE_FORCE = 6.0;
const FRICTION = 0.0;

export interface TrainPhysicsState {
	trainDist: number;
	trainSpeed: number;
	direction: number;
	doorsOpen: boolean;
}

export interface TrainInput {
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
	if (input.throttle) {
		state.trainSpeed += ACCEL * dt;
	} else if (input.emergency) {
		state.trainSpeed -= BRAKE_FORCE * 2 * dt;
	} else if (input.braking) {
		state.trainSpeed -= BRAKE_FORCE * dt;
	} else {
		state.trainSpeed -= FRICTION * dt;
	}

	state.trainSpeed = Math.max(0, Math.min(MAX_SPEED, state.trainSpeed));

	if (state.doorsOpen && state.trainSpeed > 0.1) {
		state.trainSpeed = 0;
	}

	state.trainDist += state.trainSpeed * dt * state.direction;
	state.trainDist = Math.max(0, Math.min(track.totalLength, state.trainDist));

	if (state.trainDist <= 5 || state.trainDist >= track.totalLength - 5) {
		state.trainSpeed = 0;
	}
}

export function getMaxSpeed(): number {
	return MAX_SPEED;
}
