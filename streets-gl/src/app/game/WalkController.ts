/**
 * Walking around, once you have stepped off the train.
 *
 * The camera modes so far all hang off the train — chase it, sit in it, stand
 * beside the line and watch it go past. This one lets go: you are a person on
 * the ground in a city the game has already built, and the train is something
 * you can walk back to.
 *
 * Ground height is injected rather than looked up, so the whole thing can be
 * reasoned about and tested without a terrain system, a renderer or a train.
 */

/** Eye height above the ground, metres. */
export const EYE_HEIGHT = 1.7;
/** Walking, metres per second. About 5 km/h. */
export const WALK_SPEED = 1.4;
/** Holding the run control. A fast jog, not a sprint. */
export const RUN_SPEED = 4.2;
/**
 * How far from the train you can get before the game says something, metres.
 *
 * Far enough to cross a station and look at the buildings behind it, close
 * enough that a child does not walk into open country and lose the train.
 */
export const LEASH_WARN_M = 350;
/** Past this the way back is offered outright. */
export const LEASH_FAR_M = 900;
/**
 * The longest single step, seconds.
 *
 * A tab left in the background hands back one enormous frame; without this the
 * walker would cross the city in it.
 */
export const MAX_STEP_S = 0.25;

export interface WalkInput {
	/** −1 back, +1 forward. */
	forward: number;
	/** −1 left, +1 right. */
	strafe: number;
	running: boolean;
}

export interface WalkState {
	x: number;
	z: number;
	/** Radians, clockwise from north — the same convention the train uses. */
	heading: number;
	/** Radians; negative looks down. */
	pitch: number;
	/** Ground height under the walker, metres. */
	groundY: number;
}

export function createWalkState(x: number, z: number, heading: number, groundY: number = 0): WalkState {
	return {x, z, heading, pitch: -0.05, groundY};
}

/** Keep the pitch inside what a neck does. */
export function clampPitch(pitch: number): number {
	return Math.max(-1.45, Math.min(1.25, pitch));
}

/** Turn and look. Angles in radians. */
export function look(state: WalkState, deltaYaw: number, deltaPitch: number): void {
	state.heading += deltaYaw;
	state.pitch = clampPitch(state.pitch + deltaPitch);
}

/**
 * Move for `dt` seconds.
 *
 * Diagonal input is normalised, so walking forward-and-left is not faster than
 * walking forward — the classic bug that makes a player zig-zag everywhere
 * because it is quicker.
 */
export function stepWalk(
	state: WalkState,
	input: WalkInput,
	dt: number,
	groundAt: (x: number, z: number) => number,
): void {
	const forward = Math.max(-1, Math.min(1, input.forward));
	const strafe = Math.max(-1, Math.min(1, input.strafe));
	const magnitude = Math.hypot(forward, strafe);

	if (magnitude > 1e-4) {
		const speed = (input.running ? RUN_SPEED : WALK_SPEED) * Math.min(1, magnitude) * Math.min(dt, MAX_STEP_S);
		// Heading is clockwise from north: north is −z, east is +x.
		const sin = Math.sin(state.heading);
		const cos = Math.cos(state.heading);
		const nf = forward / magnitude;
		const ns = strafe / magnitude;

		state.x += (sin * nf + cos * ns) * speed;
		state.z += (-cos * nf + sin * ns) * speed;
	}

	const ground = groundAt(state.x, state.z);

	// A NaN out of the height provider — off the edge of loaded terrain — must
	// not become a NaN position, which puts the camera nowhere and never
	// recovers.
	state.groundY = Number.isFinite(ground) ? ground : state.groundY;
}

/** How far the walker has strayed from the train, metres. */
export function distanceFromTrain(state: WalkState, train: {x: number; z: number}): number {
	return Math.hypot(state.x - train.x, state.z - train.z);
}

/** What, if anything, to say about how far away the train is. */
export function leashNotice(distance: number): 'none' | 'warn' | 'far' {
	if (distance >= LEASH_FAR_M) return 'far';
	if (distance >= LEASH_WARN_M) return 'warn';

	return 'none';
}
