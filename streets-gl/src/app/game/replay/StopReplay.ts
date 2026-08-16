/**
 * Watching your last approach again.
 *
 * The stop card draws the approach as a graph, which says WHAT you did. This
 * says what it looked like: the same train, on the same track, running the
 * last three hundred metres again while you watch from beside the line.
 *
 * The train replayed is the player's OWN train, put back where it was rather
 * than a second consist built to look like it — the physics is untouched and
 * only the drawn position is moved, so nothing else in the game notices. That
 * is the whole trick, and it is why this needs no new meshes, no draw-list
 * entry and no way to get the two out of step.
 *
 * Pure: a clock and a set of samples in, a distance and a camera in, out.
 */

import {sampleAt, type RunSample} from './RunRecorder';

/** Replays run at life speed — the point is to see what you did. */
export const REPLAY_RATE = 1;

/** A moment is held at the end so the stop itself is the last thing seen. */
export const HOLD_AT_END_S = 1.2;

/** How far to the side of the track the camera stands, metres. */
export const CAMERA_SIDE_M = 26;

/** And how high. Roughly a footbridge, so the train is seen along its length. */
export const CAMERA_HEIGHT_M = 11;

export interface ReplayState {
	/** Samples of the approach, oldest first. */
	samples: RunSample[];
	/** Seconds into the replay. */
	elapsed: number;
	/** The recorder's own stamp on the first frame, so times can be relative. */
	startT: number;
	/** How long the recorded approach ran for. */
	durationS: number;
}

/** Nothing worth watching: too few samples, or no time between them. */
export function canReplay(samples: RunSample[]): boolean {
	if (!Array.isArray(samples) || samples.length < 5) return false;

	return samples[samples.length - 1].t - samples[0].t >= 2;
}

export function beginReplay(samples: RunSample[]): ReplayState | null {
	if (!canReplay(samples)) return null;

	return {
		samples,
		elapsed: 0,
		startT: samples[0].t,
		durationS: samples[samples.length - 1].t - samples[0].t,
	};
}

/** Advance the replay. Returns false once it is over, including its hold. */
export function advanceReplay(state: ReplayState, deltaTime: number): boolean {
	if (!Number.isFinite(deltaTime) || deltaTime <= 0) return true;

	// Capped like every other clock here: one enormous frame from a
	// backgrounded tab would skip the whole replay in a step.
	state.elapsed += Math.min(deltaTime, 0.5) * REPLAY_RATE;

	return state.elapsed <= state.durationS + HOLD_AT_END_S;
}

/** Where the train was at this point of the replay. */
export function replaySampleAt(state: ReplayState): RunSample | null {
	// Clamped at the end so the hold shows the train standing at the mark
	// rather than the graph's last sample sliding onward.
	const t = state.startT + Math.min(state.elapsed, state.durationS);

	return sampleAt(state.samples, t);
}

/**
 * Where to stand and what to look at.
 *
 * Beside the track at the point the train came to rest, looking back down the
 * line at the approach — so the train comes towards the camera and stops in
 * front of it, which is how you would actually watch a train arrive.
 */
export function replayCamera(state: ReplayState): {
	position: {x: number; y: number; z: number};
	target: {x: number; y: number; z: number};
} | null {
	const last = state.samples[state.samples.length - 1];
	const now = replaySampleAt(state);

	if (!last || !now) return null;

	// The heading at the stop, turned a quarter, gives the side of the line.
	// (sin, cos) for (x, z) — the engine's convention, the same one
	// `plantTrackside` uses. Writing it (cos, sin) puts the camera on a
	// different bearing entirely, and on a straight line that is the middle of
	// the track rather than beside it.
	const side = last.heading + Math.PI / 2;

	return {
		position: {
			x: last.x + Math.sin(side) * CAMERA_SIDE_M,
			y: CAMERA_HEIGHT_M,
			z: last.z + Math.cos(side) * CAMERA_SIDE_M,
		},
		// Follows the train in, rather than staring at the platform: a fixed
		// point makes the first half of the approach a distant speck.
		target: {x: now.x, y: 0, z: now.z},
	};
}
