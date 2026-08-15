/**
 * The service in front of you.
 *
 * Block signals were built, and they only ever watched the passing services on
 * the ADJACENT alignment — trains that cannot possibly be in your way. So a
 * red meant nothing: you could run through it all day and the only thing it
 * protected was the other track. This is the train the signals are for, on
 * your own line, going your way, stopping where you stop.
 *
 * Pure: distance, speed and which stop it is working towards. No rendering, no
 * systems, no clock — so the driving policy can be reasoned about and tested.
 */

/** How hard it pulls away and pulls up, m/s². Gentler than the player's. */
const ACCEL = 3.2;
const BRAKE = 3.6;
/** How long it stands at a station, seconds. */
const DWELL_S = 18;
/** Close enough to the mark to count as arrived, metres. */
const STOP_ZONE_M = 6;

export interface LeadingTrainState {
	/** Metres along the line, in the same frame as the player's `trainDist`. */
	dist: number;
	speed: number;
	/** Which entry of `stationDists` it is working towards. */
	targetStop: number;
	/** Seconds left standing at a platform; 0 when running. */
	dwellLeft: number;
}

export function createLeadingTrain(dist: number, nextStop: number): LeadingTrainState {
	return {dist, speed: 0, targetStop: nextStop, dwellLeft: 0};
}

/**
 * How far it takes to stop from `speed`, plus a margin.
 *
 * The margin is why it stops AT the platform rather than sailing past it: with
 * a bang-on figure, one late frame is an overshoot.
 */
export function brakingDistance(speed: number): number {
	return (speed * speed) / (2 * BRAKE) + 8;
}

/**
 * Drive for `dt` seconds.
 *
 * `stationDists` must be sorted ascending; `direction` is +1 or −1 and says
 * which way along the line the service is working.
 */
export function stepLeadingTrain(
	state: LeadingTrainState,
	stationDists: number[],
	limit: number,
	direction: number,
	dt: number,
	totalLength: number,
): void {
	const step = Math.min(dt, 0.25);

	if (state.dwellLeft > 0) {
		state.dwellLeft = Math.max(0, state.dwellLeft - step);
		state.speed = 0;

		return;
	}

	const target = stationDists[state.targetStop];
	const remaining = target === undefined ? Infinity : (target - state.dist) * direction;

	// Arrived: stand for a while, then work towards the next one.
	if (remaining <= STOP_ZONE_M && state.speed < 1.5) {
		state.speed = 0;
		state.dwellLeft = DWELL_S;
		state.targetStop = nextStopIndex(state.targetStop, stationDists.length, direction);

		return;
	}

	const wantsBrake = remaining <= brakingDistance(state.speed);

	if (wantsBrake) {
		state.speed = Math.max(0, state.speed - BRAKE * step);
	} else if (state.speed < limit) {
		state.speed = Math.min(limit, state.speed + ACCEL * step);
	} else {
		state.speed = Math.max(limit, state.speed - BRAKE * step);
	}

	state.dist += state.speed * step * direction;

	// Off the end of the line: turn round and work back, which is what the
	// service would do rather than vanishing.
	if (totalLength > 0) {
		if (state.dist > totalLength) state.dist = totalLength;
		if (state.dist < 0) state.dist = 0;
	}
}

/** The stop after this one, wrapping at the ends of the line. */
export function nextStopIndex(current: number, count: number, direction: number): number {
	if (count <= 0) return 0;

	const next = current + (direction < 0 ? -1 : 1);

	if (next < 0) return 0;
	if (next >= count) return count - 1;

	return next;
}

/**
 * How far ahead of the player it is, in metres — negative when it is behind.
 *
 * Distance along the line, not through the air: on a line that doubles back,
 * a train a kilometre away down the track can be a hundred metres away across
 * the ground, and it is the track that matters.
 */
export function gapAhead(playerDist: number, leadDist: number, direction: number): number {
	return (leadDist - playerDist) * direction;
}

/**
 * Is the block between `from` and `from + length` occupied by the service?
 *
 * This is what a signal asks. Measured along the line and in the direction of
 * travel, so a train behind you never puts a red in front of you.
 */
export function blockOccupied(
	from: number,
	length: number,
	leadDist: number,
	direction: number,
): boolean {
	const offset = (leadDist - from) * direction;

	return offset >= 0 && offset <= length;
}
