/**
 * What else stops here.
 *
 * A map is a network, and the thing that makes it one is the stations two
 * lines share.
 *
 * **`isInterchange` is NOT that flag, and using it here was wrong.** It comes
 * from MetroDreamin's `interchanges` collection, which is the map author's
 * hand-curated list of physically SEPARATE stations that should be treated as
 * one — the Bank/Monument case, where you walk between them. On the Israel
 * railways map the author declared three; the map has seventy stations served
 * by more than one line, and Herzliya, served by eleven, is not one of the
 * three. A feature gated on that flag would have offered a connection at 3
 * stops out of 70 and looked like it worked.
 *
 * What a passenger actually asks is "can I change here, and to what", and the
 * answer is in the lines themselves: the same station id appearing on more
 * than one of them. No flag needed. The index is built once per map because
 * the board asks this question every frame.
 *
 * Pure: lines in, names out.
 */

import {lineCode} from './LineLabel';

/** The shape this needs from a parsed line — no more. */
export interface InterchangeLine {
	id: string;
	name: string;
	stations: {id: string}[];
}

/** How many connecting lines are named before it becomes a count. */
export const MAX_NAMED = 3;

/**
 * Which other lines call at this station.
 *
 * Matched on station ID, never on name: two different stations can share a
 * name (every network has more than one "Central"), and two spellings of the
 * same station are still one station because the map gave them one id.
 */
export function linesServing(
	lines: InterchangeLine[],
	stationId: string,
	exceptLineId: string,
): InterchangeLine[] {
	if (!stationId || !Array.isArray(lines)) return [];

	const out: InterchangeLine[] = [];
	const seen = new Set<string>();

	for (const line of lines) {
		if (!line || line.id === exceptLineId || seen.has(line.id)) continue;
		if (!Array.isArray(line.stations)) continue;
		if (!line.stations.some(s => s?.id === stationId)) continue;

		seen.add(line.id);
		out.push(line);
	}

	return out;
}

/**
 * Every station that more than one line calls at, worked out once.
 *
 * The destination board asks this on every frame, and a scan over 26 lines of
 * 20 stations each is 500 comparisons a frame to answer a question whose
 * answer cannot change until the map does.
 */
export type InterchangeIndex = Map<string, InterchangeLine[]>;

export function buildInterchangeIndex(lines: InterchangeLine[]): InterchangeIndex {
	const index: InterchangeIndex = new Map();

	if (!Array.isArray(lines)) return index;

	for (const line of lines) {
		if (!line || !Array.isArray(line.stations)) continue;

		// A line may call at the same station twice — a loop closing on itself,
		// or a branch doubling back — and it is still one line serving it.
		const seenOnThisLine = new Set<string>();

		for (const station of line.stations) {
			const id = station?.id;

			if (!id || seenOnThisLine.has(id)) continue;

			seenOnThisLine.add(id);

			const at = index.get(id);

			if (at) at.push(line);
			else index.set(id, [line]);
		}
	}

	// Only shared stations are worth keeping: on a typical map that is a small
	// fraction, and a smaller map is a faster lookup.
	for (const [id, serving] of index) {
		if (serving.length < 2) index.delete(id);
	}

	return index;
}

/** The other lines at this station, from the prebuilt index. */
export function connectionsAt(
	index: InterchangeIndex | null | undefined,
	stationId: string,
	exceptLineId: string,
): InterchangeLine[] {
	if (!index || !stationId) return [];

	return (index.get(stationId) ?? []).filter(l => l.id !== exceptLineId);
}

/**
 * "CHANGE FOR B1-B2, C6-C5", or empty when there is nothing to change to.
 *
 * Named by their codes rather than their full names: a board that reads
 * "change for B1 - B2 Beach Local - Beersheba West Local" is a paragraph, and
 * the code is what is painted on the front of the train you are looking for.
 */
export function describeInterchange(others: InterchangeLine[]): string {
	if (!Array.isArray(others) || others.length === 0) return '';

	// `lineCode`, not `lineBadge`: the badge falls back to a row NUMBER, which
	// means something in the picker and nothing on a platform sign. A line with
	// no code in its name is better named by its own id.
	const badges = others
		.map(l => lineCode(l.name) || l.id)
		.filter(Boolean);

	if (badges.length === 0) return '';
	if (badges.length <= MAX_NAMED) return `CHANGE FOR ${badges.join(', ')}`;

	// Naming eleven lines is not information, it is a wall. Say the first few
	// and how many more, which is what a real board does.
	const rest = badges.length - MAX_NAMED;

	return `CHANGE FOR ${badges.slice(0, MAX_NAMED).join(', ')} +${rest}`;
}

/** The same thing said aloud, where codes read badly and names read well. */
export function speakInterchange(others: InterchangeLine[]): string {
	if (!Array.isArray(others) || others.length === 0) return '';

	const badges = others.map(l => lineCode(l.name) || l.id).filter(Boolean);

	if (badges.length === 0) return '';
	if (badges.length === 1) return `Change here for the ${badges[0]} line.`;

	const named = badges.slice(0, MAX_NAMED);
	const list = named.length === 2
		? `${named[0]} and ${named[1]}`
		: `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;

	return badges.length > MAX_NAMED
		? `Change here for the ${list} lines, and others.`
		: `Change here for the ${list} lines.`;
}
