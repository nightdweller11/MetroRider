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
export const LOW_MIN_M = 250;
export const LOW_MAX_M = 500;

/**
 * How steeply the low ones climb out or come down: a three-degree path, the
 * one real approaches fly. Over a whole pass that is a few hundred metres —
 * enough that a departure visibly climbs away and an arrival sinks towards
 * the rooftops, which a level line across the sky never looks like.
 */
export const LOW_GRADIENT = 0.05;

/** Never lower than this, metres — nothing skims the roofs. */
export const LOW_FLOOR_M = 200;

/** Approach speeds, metres per second. 250–330 km/h. */
export const LOW_SPEED_MIN = 70;
export const LOW_SPEED_MAX = 92;

/** How far along their own track the low ones run before the next pass, metres. */
export const LOW_SPREAD_M = 7000;

/**
 * Where a low pass is laid: across the view, not overhead.
 *
 * A driver looks forward along the line, and an aeroplane directly above them
 * is one nobody ever sees; one laid out at random around them crossed the
 * forward view about four per cent of the time (measured in the cab, 150 s).
 * So each low pass is centred this far AHEAD of the player when it begins,
 * crossing the line of sight at 40–140 degrees, offset a little to one side.
 * Its closest approach is then most of a kilometre away or more, and it
 * crosses the top of a forward view, where you see a real one. Measured in
 * the cab at midday: centred 3 km out at 450–900 m, an A321 was a six-pixel
 * speck; centred 2 km out at 350–700 m it was above the top of the cab's
 * view (about 15 degrees up) for 96% of the time. Real approaches over a
 * city are low — a few hundred metres — and that is what fits the view.
 */
export const LOW_AHEAD_M = 2500;
export const LOW_SIDE_MIN_M = 0;
export const LOW_SIDE_SPAN_M = 600;
/** How far from square-on to the view a low pass may cross it, radians. */
export const LOW_CROSS_SPREAD = 50 * Math.PI / 180;

/**
 * A pass is laid out around the player when it begins and then stays fixed
 * to the ground — an aeroplane that slid along with the train would look
 * tethered to it. Once the player has gone further from that spot than this
 * share of the pass's half-length, the flight is no longer theirs...
 */
export const REANCHOR_SHARE = 0.8;

/**
 * ...and if it is also at least this share of the half-length away from
 * them, it simply ends there (nothing until its next pass begins around the
 * player). Moving it instead would be a teleport — out of one part of the
 * sky and, often enough, straight into the windscreen.
 */
export const UNSEEN_SHARE = 0.7;

/**
 * A camera that moved this far between two updates (ten seconds apart) did
 * not drive there — it jumped: to a station, to another city, or from the
 * map's start view to the first station at boot, which once left every low
 * flight twenty kilometres off and out of sight. A jump re-lays the whole
 * sky around the player at once; the world around them has changed anyway.
 */
export const JUMP_M = 3000;

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
	heading: number = plan.heading,
): SkyFlight {
	const along = plan.phase + seconds * plan.speed - pass * plan.spread * 2 - plan.spread;
	// (sin, cos) for (x, z) — the engine's convention.
	const fx = Math.sin(heading);
	const fz = Math.cos(heading);
	const altitude = plan.low
		? Math.max(LOW_FLOOR_M, plan.altitude + plan.gradient * along)
		: plan.altitude;

	return {
		id: `sky-${plan.index}-${pass}`,
		x: anchorX + fx * along + fz * plan.across,
		z: anchorZ + fz * along - fx * plan.across,
		altitude,
		heading,
	};
}

export interface PassLayout {
	/** The spot the pass is laid around, world metres. */
	x: number;
	z: number;
	heading: number;
}

/**
 * Where one pass of a flight goes, for a player at a place looking a way.
 *
 * High flights are laid around the player on their own fixed heading; low
 * ones across the player's forward view (see LOW_AHEAD_M). `forward` is the
 * horizontal view direction; it need not be normalised. Deterministic in
 * (flight, pass), so asking twice gives the same pass.
 */
export function layoutPass(
	plan: FlightPlan, pass: number, cameraX: number, cameraZ: number,
	forwardX = 0, forwardZ = 1,
): PassLayout {
	if (!plan.low) return {x: cameraX, z: cameraZ, heading: plan.heading};

	const n = Math.hypot(forwardX, forwardZ);
	const fx = n > 1e-6 ? forwardX / n : 0;
	const fz = n > 1e-6 ? forwardZ / n : 1;
	const seed = plan.index * 1009 + pass * 7919;
	const look = Math.atan2(fx, fz);
	const side = hash(seed + 1) < 0.5 ? -1 : 1;
	const heading = look + side * Math.PI / 2 + (hash(seed + 2) * 2 - 1) * LOW_CROSS_SPREAD;

	return {x: cameraX + fx * LOW_AHEAD_M, z: cameraZ + fz * LOW_AHEAD_M, heading};
}

/** The sky around a player looking north (+z), at a moment, every flight on its current pass. */
export function skyAt(centreX: number, centreZ: number, seconds: number): SkyFlight[] {
	if (!Number.isFinite(centreX) || !Number.isFinite(centreZ) || !Number.isFinite(seconds)) {
		return [];
	}

	const out: SkyFlight[] = [];

	for (let i = 0; i < FLIGHT_COUNT; i++) {
		const plan = flightPlan(i);

		const pass = passAt(plan, seconds);
		const at = layoutPass(plan, pass, centreX, centreZ);

		out.push(flightAt(plan, seconds, pass, at.x, at.z, at.heading));
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
 * Holds one layout per flight slot. A pass is laid out around wherever the
 * player is (and, for a low one, whichever way they look) when it begins,
 * then stays fixed to the ground until it ends — by which time the aeroplane
 * is at the far edge of its pass, where it can be replaced without anyone
 * seeing a jump.
 */
export class SkyTracker {
	private anchors: Map<number, PassLayout & {pass: number; ended: boolean; serial: number}> = new Map();
	private lastCamera: {x: number; z: number} | null = null;
	/**
	 * Bumped on every layout. Part of each aircraft's id, because the vehicle
	 * system interpolates between the states it holds for an id: a pass
	 * re-laid under the SAME id after a camera jump was drawn sweeping from
	 * its old track to its new one (measured: 991 m/s, three times an
	 * airliner's speed). A new layout must be a new aeroplane.
	 */
	private serial: number = 0;

	public tracks(
		cameraX: number, cameraZ: number, times: number[], forwardX = 0, forwardZ = 1,
	): SkyTrack[] {
		if (!Number.isFinite(cameraX) || !Number.isFinite(cameraZ) || times.length === 0 ||
			!times.every(Number.isFinite)) {
			return [];
		}

		const jumped = !this.lastCamera ||
			Math.hypot(this.lastCamera.x - cameraX, this.lastCamera.z - cameraZ) > JUMP_M;

		this.lastCamera = {x: cameraX, z: cameraZ};

		const out: SkyTrack[] = [];

		for (let i = 0; i < FLIGHT_COUNT; i++) {
			const plan = flightPlan(i);
			const pass = passAt(plan, times[0]);
			let anchor = this.anchors.get(i);

			if (jumped || !anchor || anchor.pass !== pass) {
				anchor = {
					pass, ended: false, serial: ++this.serial,
					...layoutPass(plan, pass, cameraX, cameraZ, forwardX, forwardZ),
				};
				this.anchors.set(i, anchor);
			} else if (!anchor.ended && this.leftBehind(plan, anchor, times[0], cameraX, cameraZ)) {
				anchor.ended = true;
			}

			if (anchor.ended) continue;

			const samples = times.map(t => flightAt(plan, t, pass, anchor.x, anchor.z, anchor.heading));

			out.push({id: `${samples[0].id}-${anchor.serial}`, type: flightType(i, plan.low), samples});
		}

		return out;
	}

	/** Whether the player has driven away from a pass that is out of their sight. */
	private leftBehind(
		plan: FlightPlan, anchor: PassLayout & {pass: number}, seconds: number,
		cameraX: number, cameraZ: number,
	): boolean {
		const reach = plan.spread * REANCHOR_SHARE + (plan.low ? LOW_AHEAD_M : 0);

		if (Math.hypot(anchor.x - cameraX, anchor.z - cameraZ) <= reach) return false;

		const now = flightAt(plan, seconds, anchor.pass, anchor.x, anchor.z, anchor.heading);

		return Math.hypot(now.x - cameraX, now.z - cameraZ) > plan.spread * UNSEEN_SHARE;
	}

	public reset(): void {
		this.anchors.clear();
		this.lastCamera = null;
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
