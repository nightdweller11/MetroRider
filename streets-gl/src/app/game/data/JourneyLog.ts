/**
 * What you have driven, kept.
 *
 * The game scores a RUN and then forgets it. Nothing anywhere says how far you
 * have driven altogether, how many cities you have been to, or how many
 * stations you have served — the things a nine-year-old actually wants to know
 * after a fortnight of playing.
 *
 * Pure: a record and the functions that add to it. Storage and the interface
 * are somebody else's problem, which is what makes it testable.
 */

export interface JourneyLog {
	/** Metres driven, all time. */
	metres: number;
	/** Seconds spent actually moving. */
	drivingSeconds: number;
	/** Station keys served, as `mapId::lineId::stationIndex`. */
	stations: string[];
	/** Line keys driven, as `mapId::lineId`. */
	lines: string[];
	/** Map names driven, in the order first seen. */
	maps: string[];
	/** Stops made, including ones scored badly. */
	stops: number;
	/** Passengers carried to their stop. */
	delivered: number;
	/** Fastest speed reached, m/s. */
	topSpeedMs: number;
	/** Named places found, in the order they were come across. */
	places: string[];
	/**
	 * Where each was found, in world metres, so the map can show them.
	 *
	 * Kept alongside the names rather than replacing them: a record written by
	 * an earlier version has names and no positions, and those finds should
	 * still count even though they cannot be drawn.
	 */
	placeMarks: {n: string; x: number; z: number}[];
}

export function emptyJourney(): JourneyLog {
	return {
		metres: 0, drivingSeconds: 0, stations: [], lines: [], maps: [],
		stops: 0, delivered: 0, topSpeedMs: 0, places: [], placeMarks: [],
	};
}

/** How many entries a list may hold before old ones are dropped. */
const MAX_KEYS = 4000;
/** The longest single frame that counts as driving, seconds. */
const MAX_STEP_S = 1;

function remember(list: string[], key: string): string[] {
	if (!key || list.includes(key)) return list;

	const next = [...list, key];

	// A player who drives forever must not grow this without bound. The OLDEST
	// go, so the record keeps what was seen most recently rather than refusing
	// anything new — a counter that stops counting is worse than an approximate
	// one.
	return next.length > MAX_KEYS ? next.slice(next.length - MAX_KEYS) : next;
}

/** Add a frame of driving. `dt` is seconds, `speed` metres per second. */
export function addDriving(log: JourneyLog, speed: number, dt: number): JourneyLog {
	if (!Number.isFinite(speed) || !Number.isFinite(dt) || dt <= 0 || speed <= 0) return log;

	// Cap the step: a backgrounded tab hands back one enormous frame, and
	// without this a player would return to find they had driven to the moon.
	// A whole second is far longer than any real frame, so nothing a player
	// actually sees is under-counted.
	const step = Math.min(dt, MAX_STEP_S);

	return {
		...log,
		metres: log.metres + speed * step,
		drivingSeconds: log.drivingSeconds + step,
		topSpeedMs: Math.max(log.topSpeedMs, speed),
	};
}

/** Record a stop made at a station. */
export function addStop(
	log: JourneyLog,
	mapId: string,
	lineId: string,
	stationIndex: number,
	delivered: number = 0,
): JourneyLog {
	return {
		...log,
		stops: log.stops + 1,
		delivered: log.delivered + Math.max(0, delivered),
		stations: remember(log.stations, `${mapId}::${lineId}::${stationIndex}`),
	};
}

/** Record a named place come across. Ignores one already found. */
export function addPlace(log: JourneyLog, name: string, x?: number, z?: number): JourneyLog {
	if (!name || log.places.includes(name)) return log;

	const marks = Number.isFinite(x) && Number.isFinite(z)
		? [...log.placeMarks, {n: name, x: x as number, z: z as number}].slice(-MAX_KEYS)
		: log.placeMarks;

	return {...log, places: remember(log.places, name), placeMarks: marks};
}

/** Record that a line, on a map, is being driven. */
export function addLine(log: JourneyLog, mapId: string, lineId: string, mapName: string): JourneyLog {
	return {
		...log,
		lines: remember(log.lines, `${mapId}::${lineId}`),
		maps: remember(log.maps, mapName),
	};
}

/** The distance, said the way a person says it. */
export function describeDistance(metres: number): string {
	if (metres < 1000) return `${Math.round(metres)} m`;
	if (metres < 100000) return `${(metres / 1000).toFixed(1)} km`;

	return `${Math.round(metres / 1000).toLocaleString()} km`;
}

/** Time at the controls, said the way a person says it. */
export function describeDuration(seconds: number): string {
	if (seconds < 90) return `${Math.round(seconds)} seconds`;

	const minutes = Math.round(seconds / 60);

	if (minutes < 60) return `${minutes} minutes`;

	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;

	if (rest === 0) return hours === 1 ? '1 hour' : `${hours} hours`;

	return `${hours} h ${rest} min`;
}

/**
 * Something to be pleased about, or null.
 *
 * Milestones are round numbers a child would notice — the first hundred
 * kilometres, the tenth city — and each is announced once, by comparing the
 * total before and after.
 */
const DISTANCE_MILESTONES_KM = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

export function milestoneCrossed(before: JourneyLog, after: JourneyLog): string | null {
	const beforeKm = before.metres / 1000;
	const afterKm = after.metres / 1000;

	for (const km of DISTANCE_MILESTONES_KM) {
		if (beforeKm < km && afterKm >= km) {
			return `${km.toLocaleString()} km driven altogether`;
		}
	}

	if (after.maps.length > before.maps.length && after.maps.length % 5 === 0) {
		return `${after.maps.length} cities driven`;
	}

	if (after.stations.length > before.stations.length && after.stations.length % 25 === 0) {
		return `${after.stations.length} different stations served`;
	}

	if (after.places.length > before.places.length && after.places.length % 10 === 0) {
		return `${after.places.length} places found`;
	}

	return null;
}
