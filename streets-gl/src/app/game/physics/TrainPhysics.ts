import type {TrackData} from '../data/TrackBuilder';

/**
 * The fastest anything may go, m/s — 201.6 km/h.
 *
 * A whisker over 200 rather than a whisker under, so a train that is supposed
 * to reach two hundred actually shows two hundred on the dial rather than
 * stopping at 198 and looking throttled.
 */
const MAX_SPEED = 56;
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
/** Gravity, m/s². */
const GRAVITY = 9.81;
/**
 * The steepest slope gravity is allowed to act on, as rise over run.
 *
 * Real railways rarely exceed 4%, and the steepest adhesion lines in the world
 * are around 9%. The terrain under a MetroDreamin line is real OSM elevation
 * that the line was drawn across without regard for it, so a route can cross a
 * cliff: unclamped, one sample off a 60% face would either stop the train dead
 * or fire it down the hill at line speed.
 */
const MAX_GRADE = 0.09;

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
	/**
	 * The slope under the train, as a rise-over-run fraction in the direction
	 * of travel. Positive is uphill.
	 *
	 * Gravity is the one force here that acts whether or not the driver is
	 * doing anything: a train coasting down a bank picks up speed, and one
	 * climbing loses it. Without this a train climbed a hill exactly as fast as
	 * it ran on the flat, which is the one thing everybody knows trains do not
	 * do.
	 */
	grade?: number;
	throttle: boolean;
	braking: boolean;
	emergency: boolean;
	/**
	 * What the master controller handle is set to, 0–1 each.
	 *
	 * A notched controller asks for a FRACTION of full power and stays there —
	 * P1 is a gentle start, P4 is everything. The booleans above are the
	 * keyboard, which is all-or-nothing while a key is down; when a key is held
	 * it wins, so both ways of driving work without fighting each other.
	 */
	powerLevel?: number;
	brakeLevel?: number;
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
	// The keyboard is all-or-nothing while a key is held; the controller handle
	// asks for a fraction and holds it. A held key wins, so a player can grab
	// the keyboard mid-run without first returning the handle to neutral.
	const handlePower = Math.max(0, Math.min(1, input.powerLevel ?? 0));
	const handleBrake = Math.max(0, Math.min(1, input.brakeLevel ?? 0));
	const powerDemand = input.throttle ? 1 : handlePower;
	const brakeDemand = input.emergency ? 1 : input.braking ? 1 : handleBrake;

	const wantsPower = powerDemand > 0 && state.trainSpeed < ceiling;
	const powerTarget = wantsPower ? powerDemand : 0;

	// Wind the handles toward where the driver is asking, rather than snapping.
	// Coming off is quicker than going on, as it is in a cab: you can always
	// drop power immediately, but you cannot slam to full.
	state.powerNotch = approach(
		state.powerNotch, powerTarget,
		powerTarget > state.powerNotch ? NOTCH_ON_RATE : NOTCH_OFF_RATE, dt,
	);
	state.brakeNotch = approach(
		state.brakeNotch,
		brakeDemand,
		input.emergency ? 1 / EMERGENCY_APPLY_S : NOTCH_ON_RATE,
		dt,
	);

	// Power and brake cannot both be applied: the controller is one handle, and
	// a keyboard brake overrides whatever the handle is asking for.
	if (state.powerNotch > 0 && state.brakeNotch <= 0 && !input.braking && !input.emergency) {
		state.trainSpeed += ACCEL * accelScale * assistScale * state.powerNotch * dt;
	}

	// Driven by where the brake handle IS, not by whether a key is down —
	// otherwise a controller set to B1 winds the gauge up and stops nothing.
	if (state.brakeNotch > 0) {
		const emergencyFactor = input.emergency ? 2 : 1;

		state.trainSpeed -= BRAKE_FORCE * brakeScale * emergencyFactor * state.brakeNotch * dt;
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

	// Gravity along the rail. `g · sin(atan(grade))` is the real figure, and at
	// railway gradients the small-angle form is within a whisper of it — a 4%
	// bank differs by 0.08%. Clamped because map terrain has cliffs in it that
	// no railway would ever be built on, and a 60% "gradient" sampled off one
	// would stop a train dead or fire it down the hill.
	//
	// Not while the doors are open: a train at a platform is held on its
	// brakes. Without that guard it crept away down any slope — gravity added a
	// little each frame, the doors-open clamp only fires above 0.1 m/s, and the
	// two oscillated instead of holding it still.
	if (input.grade && !state.doorsOpen) {
		const grade = Math.max(-MAX_GRADE, Math.min(MAX_GRADE, input.grade));

		state.trainSpeed -= GRAVITY * grade * dt;
	}

	state.trainSpeed = Math.max(0, Math.min(MAX_SPEED, state.trainSpeed));

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
