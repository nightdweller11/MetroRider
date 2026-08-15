/**
 * A link to one particular ride.
 *
 * The point is a parent being able to send their child a URL that opens the
 * exact map, the exact line and the exact train they were just looking at,
 * rather than "load London, then find the Circle line, then set the carriages".
 *
 * The train that arrives in a link is applied for THE SESSION ONLY and is never
 * written to the player's saved setup. Someone who has spent an afternoon
 * building a consist should be able to open a friend's link and still have
 * their own train when they come back.
 *
 * Pure — no DOM, no systems — so the parsing rules can be tested directly.
 */

export interface RideLink {
	/** MetroDreamin map id. */
	mapId: string;
	/** Index into the map's line list, when the link names one. */
	lineIndex: number | null;
	/** Consist slot strings, when the link carries a train. */
	consist: string[] | null;
}

const MAP_PARAM = 'map';
const LINE_PARAM = 'line';
const TRAIN_PARAM = 'train';

/**
 * A consist is at most this many cars.
 *
 * A link arrives from outside, so it is untrusted input: without a cap someone
 * could hand a child a URL that asks for ten thousand carriages and take the
 * tab down with it.
 */
const MAX_CARS = 12;
/** Longest plausible slot string — a model id plus its flip and tint tokens. */
const MAX_SLOT_CHARS = 120;
/** No real map has more lines than this; anything beyond is not a line index. */
const MAX_LINE_INDEX = 999;

/** Read a ride out of a query string. Returns null when there is no map in it. */
export function parseRideLink(search: string): RideLink | null {
	let params: URLSearchParams;

	try {
		params = new URLSearchParams(search);
	} catch {
		return null;
	}

	const mapId = (params.get(MAP_PARAM) ?? '').trim();

	// The map is the one part that cannot be defaulted: without it there is
	// nothing to open, and a line index on its own is meaningless.
	if (!mapId) return null;

	return {
		mapId,
		lineIndex: parseLineIndex(params.get(LINE_PARAM)),
		consist: parseConsist(params.get(TRAIN_PARAM)),
	};
}

function parseLineIndex(raw: string | null): number | null {
	if (raw === null) return null;

	const text = raw.trim();

	// `Number('')` is 0, so an empty `line=` would silently mean "the first
	// line" rather than "no line named". Absence is not zero.
	if (text.length === 0) return null;

	const value = Number(text);

	if (!Number.isInteger(value) || value < 0 || value > MAX_LINE_INDEX) return null;

	return value;
}

function parseConsist(raw: string | null): string[] | null {
	if (raw === null) return null;

	const slots = raw
		.split(',')
		.map(s => s.trim())
		.filter(s => s.length > 0 && s.length <= MAX_SLOT_CHARS)
		.slice(0, MAX_CARS);

	return slots.length > 0 ? slots : null;
}

/**
 * Build the link for a ride.
 *
 * `origin` is passed in rather than read from `location` so this stays pure and
 * testable, and so a caller can point a link at a different host if it ever
 * needs to.
 */
export function buildRideLink(
	origin: string,
	ride: {mapId: string; lineIndex?: number | null; consist?: string[] | null},
): string {
	const params = new URLSearchParams();

	params.set(MAP_PARAM, ride.mapId);

	if (ride.lineIndex !== null && ride.lineIndex !== undefined && ride.lineIndex >= 0) {
		params.set(LINE_PARAM, String(ride.lineIndex));
	}

	if (ride.consist && ride.consist.length > 0) {
		params.set(TRAIN_PARAM, ride.consist.slice(0, MAX_CARS).join(','));
	}

	// Trailing query and hash stripped: the hash carries the camera position,
	// which is where the sender happened to be looking and not part of the ride.
	const base = origin.split('#')[0].split('?')[0];

	return `${base}?${params.toString()}`;
}
