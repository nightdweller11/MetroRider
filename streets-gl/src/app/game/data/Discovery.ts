/**
 * Finding places.
 *
 * The checklist had this waiting on `notable[]` being plumbed out of the map
 * worker. It does not need to be: every loaded tile already carries the map's
 * own labels — real named places, in world coordinates, with a priority saying
 * how important the cartography thinks each one is. That is the data, and it
 * is already here.
 *
 * Pure: what is near, what is new, and how often to say so.
 */

export interface NamedPlace {
	name: string;
	x: number;
	z: number;
	/** The map's own idea of how important it is; bigger is more prominent. */
	priority: number;
}

/**
 * How close you have to get, metres.
 *
 * Measured rather than chosen. A railway runs through open country between
 * towns: standing at four stations on the built-in map, the nearest named
 * place was 89 m, 157 m, 870 m and — at one rural stop — five kilometres.
 * At 140 m a whole run found nothing at all. Three hundred is about what you
 * can pick out from a train window, and it puts the finding where the places
 * actually are, which is in towns and at stations.
 */
export const DISCOVER_RADIUS_M = 300;
/**
 * The least important label worth announcing.
 *
 * Without a floor the first minute of any city is a stream of toasts for every
 * corner shop, which turns finding somewhere into noise. Measured on the
 * built-in map: 194 labels across the loaded tiles, priorities running 3 to 71
 * with a median of 14 — most of them a school's individual sports halls. Ten
 * drops the smallest of those while keeping the things that have a name worth
 * reading, including the station buildings the line actually passes.
 */
export const MIN_PRIORITY = 10;
/** Quietest gap between two announcements, seconds. */
export const ANNOUNCE_GAP_S = 10;

/** Trim a label to something that reads as a place name. */
export function tidyName(raw: string): string {
	return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Is this worth announcing at all?
 *
 * Nameless labels, numbers on their own ("14"), and anything the map itself
 * considers minor are skipped: a discovery you cannot tell anyone about is not
 * a discovery.
 */
export function worthFinding(place: NamedPlace): boolean {
	const name = tidyName(place.name);

	if (name.length < 3) return false;
	if (!/[A-Za-zͰ-῿Ⰰ-퟿]/.test(name)) return false;

	return place.priority >= MIN_PRIORITY;
}

/**
 * The nearest place worth finding that has not been found yet.
 *
 * Nearest rather than first, so passing a cluster announces the one you
 * actually went by.
 */
export function nearestNewPlace(
	places: NamedPlace[],
	x: number,
	z: number,
	found: ReadonlySet<string>,
	radius: number = DISCOVER_RADIUS_M,
): NamedPlace | null {
	let best: NamedPlace | null = null;
	let bestDistance = radius;

	for (const place of places) {
		const name = tidyName(place.name);

		if (found.has(name) || !worthFinding(place)) continue;

		const distance = Math.hypot(place.x - x, place.z - z);

		if (distance <= bestDistance) {
			bestDistance = distance;
			best = {...place, name};
		}
	}

	return best;
}

/** How it is said. */
export function describeFind(name: string, total: number): string {
	return total === 1
		? `📍 Found ${name} — your first place`
		: `📍 Found ${name}`;
}
