/**
 * Aeroplanes overhead.
 *
 * The engine has always been able to draw air traffic: models for a 777, an
 * A321, a Cessna, an ERJ and a helicopter, their textures, an instanced
 * renderer, a shader, and a system that interpolates each aircraft's track
 * between updates. All of it shipped and all of it was switched off, because
 * the live flight feed it read went away. Probed over London, New York and
 * Frankfurt: the server still answers, and every answer is an empty list.
 *
 * So the flights are made here instead, which is better for a game in any
 * case — it works over every city, depends on nobody's server, cannot be
 * rate-limited, and works on a train with no signal.
 *
 * Pure apart from `SkyTracker`'s anchors: a place and a time in, aircraft out.
 * Deterministic, because the system asks repeatedly and an answer that
 * wobbled would be a stutter in the sky.
 */

/** How many are aloft near the player at once. */
export const FLIGHT_COUNT = 6;

/** Cruise heights, metres. */
export const CRUISE_MIN_M = 8200;
export const CRUISE_MAX_M = 11600;

/** How far out the high ones fly, metres. */
export const SPREAD_M = 26000;

/** Cruise speeds, metres per second. 800–950 km/h. */
export const SPEED_MIN = 222;
export const SPEED_MAX = 264;

/**
 * How many are low, on their way in or out of somewhere.
 *
 * Cruise traffic alone is honest and nearly pointless: a forty-metre airliner
 * at eleven kilometres subtends a fifth of a degree — about five pixels — and
 * a child looking up sees nothing at all. Cities have aeroplanes climbing out
 * and coming in as well, and those are the ones you actually see.
 */
export const LOW_FLIGHTS = 3;

/** Approach and departure heights at the middle of their pass, metres. */
export const LOW_MIN_M = 450;
export const LOW_MAX_M = 900;

/**
 * How steeply the low ones climb out or come down: a three-degree path, the
 * one real approaches fly. Over a whole pass that is a few hundred metres —
 * enough that a departure visibly climbs away and an arrival sinks towards
 * the rooftops, which a level line across the sky never looks like.
 */
export const LOW_GRADIENT = 0.05;

/** Never lower than this, metres — nothing skims the roofs. */
export const LOW_FLOOR_M = 280;

/** Approach speeds, metres per second. 250–330 km/h. */
export const LOW_SPEED_MIN = 70;
export const LOW_SPEED_MAX = 92;

/** How far along their own track the low ones run before the next pass, metres. */
export const LOW_SPREAD_M = 7000;

/**
 * How far to the side the low ones are held, metres.
 *
 * Deliberately NOT overhead. A driver looks forward along the line, and an
 * aeroplane directly above them is one nobody ever sees. Held out here they
 * sit a few degrees up — the top of a forward view, where you see a real one.
 */
export const LOW_SIDE_MIN_M = 1500;
export const LOW_SIDE_SPAN_M = 1800;

/**
 * How far the player may travel from where a flight's pass was laid out
 * before it is laid out again around them, metres. A pass is fixed to the
 * ground while it runs — an aeroplane that slid along with the train would
 * look tethered to it — and is moved only when the player has gone somewhere
 * else entirely (a jump to another station or city).
 */
export const REANCHOR_DISTANCE_M = 30000;

export interface SkyFlight {
	/** Stable for one pass across the sky; a new pass is a new aeroplane. */
	id: string;
	/** World metres. */
	x: number;
	z: number;
	altitude: number;
	/** Radians, the direction of travel. */
	heading: number;
}

/** Everything about one flight slot that never changes. */
export interface FlightPlan {
	index: number;
	low: boolean;
	heading: number;
	/** Metres per second. */
	speed: number;
	/** Height at the middle of the pass, metres. */
	altitude: number;
	/** Metres of climb per metre flown (negative: descending). */
	gradient: number;
	/** Half the length of one pass, metres. */
	spread: number;
	/** Where in its cycle the flight starts, metres. */
	phase: number;
	/** Offset to the side of the anchor, metres. */
	across: number;
}

/** A stable hash, so a flight's path never changes under it. */
function hash(n: number): number {
	let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);

	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);

	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Whether a flight is one of the low ones. */
export function isLowFlight(index: number): boolean {
	return index >= FLIGHT_COUNT - LOW_FLIGHTS;
}

export function flightPlan(i: number): FlightPlan {
	const low = isLowFlight(i);
	const spread = low ? LOW_SPREAD_M : SPREAD_M;
	const sideways = hash(i * 37 + 23);

	return {
		index: i,
		low,
		heading: hash(i * 7 + 1) * Math.PI * 2,
		speed: low
			? LOW_SPEED_MIN + hash(i * 13 + 5) * (LOW_SPEED_MAX - LOW_SPEED_MIN)
			: SPEED_MIN + hash(i * 13 + 5) * (SPEED_MAX - SPEED_MIN),
		altitude: low
			? LOW_MIN_M + hash(i * 29 + 11) * (LOW_MAX_M - LOW_MIN_M)
			: CRUISE_MIN_M + hash(i * 29 + 11) * (CRUISE_MAX_M - CRUISE_MIN_M),
		gradient: low ? (hash(i * 43 + 19) < 0.5 ? -LOW_GRADIENT : LOW_GRADIENT) : 0,
		spread,
		phase: hash(i * 31 + 17) * spread * 2,
		across: low
			? (sideways < 0.5 ? -1 : 1) * (LOW_SIDE_MIN_M + sideways * LOW_SIDE_SPAN_M)
			: (sideways - 0.5) * spread,
	};
}

/** Which pass a flight is on at a moment. Each pass is a new aeroplane. */
export function passAt(plan: FlightPlan, seconds: number): number {
	return Math.floor((plan.phase + seconds * plan.speed) / (plan.spread * 2));
}

/**
 * Where a flight is on a given pass, around a given anchor.
 *
 * The pass is passed in rather than worked out, so a track can be followed
 * a little beyond its own end — the interpolating system asks for the next
 * sample ahead of time, and a flight that wrapped to the far side between
 * two samples would be swept across the whole sky in ten seconds.
 */
export function flightAt(
	plan: FlightPlan, seconds: number, pass: number, anchorX: number, anchorZ: number,
): SkyFlight {
	const along = plan.phase + seconds * plan.speed - pass * plan.spread * 2 - plan.spread;
	// (sin, cos) for (x, z) — the engine's convention.
	const fx = Math.sin(plan.heading);
	const fz = Math.cos(plan.heading);
	const altitude = plan.low
		? Math.max(LOW_FLOOR_M, plan.altitude + plan.gradient * along)
		: plan.altitude;

	return {
		id: `sky-${plan.index}-${pass}`,
		x: anchorX + fx * along + fz * plan.across,
		z: anchorZ + fz * along - fx * plan.across,
		altitude,
		heading: plan.heading,
	};
}

/** The sky above a point, at a moment, every flight on its current pass. */
export function skyAt(centreX: number, centreZ: number, seconds: number): SkyFlight[] {
	if (!Number.isFinite(centreX) || !Number.isFinite(centreZ) || !Number.isFinite(seconds)) {
		return [];
	}

	const out: SkyFlight[] = [];

	for (let i = 0; i < FLIGHT_COUNT; i++) {
		const plan = flightPlan(i);

		out.push(flightAt(plan, seconds, passAt(plan, seconds), centreX, centreZ));
	}

	return out;
}

export interface SkyTrack {
	id: string;
	/** ICAO type code. */
	type: string;
	/** One sample per requested time, in order. */
	samples: SkyFlight[];
}

/**
 * The sky as the interpolating vehicle system wants it: each aeroplane as a
 * few timed samples along one pass.
 *
 * Holds one anchor per flight slot. A pass is laid out around wherever the
 * player is when it begins, then stays fixed to the ground until it ends —
 * by which time the aeroplane is at the far edge of its pass, which is where
 * it can be replaced without anyone seeing a jump.
 */
export class SkyTracker {
	private anchors: Map<number, {pass: number; x: number; z: number}> = new Map();

	public tracks(cameraX: number, cameraZ: number, times: number[]): SkyTrack[] {
		if (!Number.isFinite(cameraX) || !Number.isFinite(cameraZ) || times.length === 0 ||
			!times.every(Number.isFinite)) {
			return [];
		}

		const out: SkyTrack[] = [];

		for (let i = 0; i < FLIGHT_COUNT; i++) {
			const plan = flightPlan(i);
			const pass = passAt(plan, times[0]);
			let anchor = this.anchors.get(i);

			if (
				!anchor || anchor.pass !== pass ||
				Math.hypot(anchor.x - cameraX, anchor.z - cameraZ) > REANCHOR_DISTANCE_M
			) {
				anchor = {pass, x: cameraX, z: cameraZ};
				this.anchors.set(i, anchor);
			}

			const samples = times.map(t => flightAt(plan, t, pass, anchor.x, anchor.z));

			out.push({id: samples[0].id, type: flightType(i, plan.low), samples});
		}

		return out;
	}

	public reset(): void {
		this.anchors.clear();
	}
}

/**
 * What kind of aircraft a flight is, as an ICAO type code.
 *
 * Codes rather than the renderer's own enum, because the engine already has a
 * table mapping real type codes onto its models, and that table is what every
 * other part of this pipeline speaks. A low flight is never a wide-body: near
 * the ground it is what actually comes into a city aerodrome.
 */
export function flightType(index: number, low = false): string {
	const r = hash(index * 41 + 3);

	if (low) return r < 0.5 ? 'A321' : (r < 0.8 ? 'CRJ9' : 'C208');
	if (r < 0.45) return 'B772';
	if (r < 0.85) return 'A321';

	return 'CRJ9';
}
