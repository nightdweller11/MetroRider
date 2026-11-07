/**
 * Service patterns: which lines belong together, and which stations a train
 * runs through without stopping.
 *
 * What the MetroDreamin payload actually carries (read off the live
 * Israel-railways map, 2026-11-07, not assumed):
 *
 * - `map.lineGroups` — `{id, label}` per group ("2" → "A", "4" → "C", …), and
 *   `line.lineGroupId` on every line. The A group is four services: A1-A2, the
 *   full run; A1-A3 and A1-A4, shorter workings of it; and A1-A5, the express.
 * - `line.waypointOverrides` — a list of station ids that THIS line treats as
 *   waypoints: it runs through them and does not call. That is the express
 *   pattern, stated by the map's author, station by station. A1-A5 passes Bat
 *   Yam Komemuyot, Bat Yam Yoseftal, Holon Wolfson and Holon Junction; the
 *   D1-D2 Beach Express passes sixteen.
 * - `line.icon` — 'diamond' on exactly the five lines whose names say
 *   "Express" (the New York convention for an express bullet), 'circle' or
 *   'solid' or nothing on the rest.
 *
 * The overrides list is not clean. It is left behind when a line is redrawn:
 * the G lines still list Lod Ganei Aviv and Kfar Chabad, which they no longer
 * go anywhere near, and two lines name a station id that no longer exists. So
 * an override only counts when the station is a real station on the line's own
 * path — and never at either end, because a train cannot run through the
 * station it starts or terminates at.
 *
 * No line on that map passes through another line's station without listing
 * it (checked: no unlisted station within 30 m of any route), so the skip list
 * is the whole truth and nothing has to be guessed from geometry. What IS
 * derived here is the "part of" relation — a line in a group whose every stop
 * is also a stop of a longer sibling is a short working of it — because the
 * data has no field for it and a picker of four near-identical rows needs it.
 *
 * Pure: no DOM, no systems.
 */

/** A line as the grouping needs to see it. */
export interface GroupableLine {
	name: string;
	color?: string;
	groupId?: string;
	groupLabel?: string;
	/** The ids of the stations it CALLS at, in order. */
	stopIds: string[];
}

export type PickerEntry =
	| {kind: 'header'; label: string; count: number; color?: string}
	| {
		kind: 'line';
		/** Index into the map's line list — never reordered, links depend on it. */
		index: number;
		/** Sits under a group header. */
		grouped: boolean;
		/** The longer sibling this one is a part of, by index, or null. */
		partOf: number | null;
	};

/**
 * The stations a line runs through without stopping.
 *
 * `stopIds` is the line's real stations in path order (waypoints already
 * dropped); `overrides` is whatever the map put in `waypointOverrides`. Stale
 * and malformed entries are dropped — see the header.
 */
export function effectiveSkips(stopIds: string[], overrides: unknown): string[] {
	if (!Array.isArray(overrides) || overrides.length === 0 || stopIds.length < 3) return [];

	const wanted = new Set(overrides.filter((o): o is string => typeof o === 'string'));
	const first = stopIds[0];
	const last = stopIds[stopIds.length - 1];
	const out: string[] = [];
	const seen = new Set<string>();

	for (let i = 1; i < stopIds.length - 1; i++) {
		const id = stopIds[i];

		// The ends are never skipped, and neither is a station the line also
		// starts or ends at (a loop revisits its first station).
		if (id === first || id === last) continue;
		if (!wanted.has(id) || seen.has(id)) continue;

		seen.add(id);
		out.push(id);
	}

	return out;
}

/**
 * Whether the map's author marked this line as an express.
 *
 * The name says so, or the line wears the diamond bullet. Read from the
 * author's own marking rather than from "it skips something": B1-B2 is a
 * "Beach Local" that passes two stations, and calling it an express would be
 * putting words in the author's mouth.
 */
export function authorMarkedExpress(name: string | undefined, icon: unknown): boolean {
	if (icon === 'diamond') return true;

	return /\bexpress\b/i.test(name ?? '');
}

/** The few words a picker row adds about the pattern, or '' for an ordinary line. */
export function patternNote(line: {express?: boolean; skippedCount: number}, partOfCode: string | null = null): string {
	const parts: string[] = [];

	if (line.express) parts.push('Express');
	if (line.skippedCount > 0) parts.push(`skips ${line.skippedCount}`);
	if (partOfCode) parts.push(`part of ${partOfCode}`);

	return parts.join(' · ');
}

/**
 * The picker's list: lines in the map's order, each group gathered under one
 * header at the place its first line appears.
 *
 * A group of one gets no header — a heading over a single row is a label
 * repeating the row beneath it. A map with no groups at all (the built-in Tel
 * Aviv map, most hand-drawn ones) comes back as a plain list, exactly as
 * before.
 *
 * Within a group the longest service leads and the short workings follow,
 * because "which one goes all the way" is the first thing a driver asks.
 */
export function groupLinesForPicker(lines: GroupableLine[]): PickerEntry[] {
	const byGroup = new Map<string, number[]>();

	lines.forEach((line, index) => {
		const g = line.groupId;

		if (!g) return;

		const members = byGroup.get(g);

		if (members) members.push(index);
		else byGroup.set(g, [index]);
	});

	const out: PickerEntry[] = [];
	const placed = new Set<string>();

	lines.forEach((line, index) => {
		const g = line.groupId;
		const members = g ? byGroup.get(g) : undefined;

		if (!g || !members || members.length < 2) {
			out.push({kind: 'line', index, grouped: false, partOf: null});
			return;
		}

		if (placed.has(g)) return;

		placed.add(g);

		out.push({
			kind: 'header',
			label: groupLabelFor(members.map(i => lines[i]), g),
			count: members.length,
			color: lines[members[0]].color,
		});

		const ordered = [...members].sort(
			(a, b) => lines[b].stopIds.length - lines[a].stopIds.length || a - b,
		);

		for (const i of ordered) {
			out.push({kind: 'line', index: i, grouped: true, partOf: partOfSibling(lines, i, members)});
		}
	});

	return out;
}

/**
 * The longest sibling this line is a short working of: a sibling with more
 * stops that calls, in the same order and with nothing left out in between,
 * at exactly the stops this line calls at. A1-A3 calls at the first eighteen
 * stops of A1-A2 and nowhere else, so it is part of A1-A2.
 *
 * An express is NOT part of the all-stops line it shadows, even though every
 * station it calls at is one the all-stops line calls at too: it leaves out
 * stations in between, and "part of A1-A2" would tell the driver it stops
 * where A1-A2 stops.
 */
export function partOfSibling(lines: GroupableLine[], index: number, members: number[]): number | null {
	const mine = lines[index]?.stopIds ?? [];

	if (mine.length < 2) return null;

	let best: number | null = null;

	for (const j of members) {
		if (j === index) continue;

		const theirs = lines[j].stopIds;

		if (theirs.length <= mine.length) continue;
		if (!isContiguousRun(mine, theirs)) continue;
		if (best === null || theirs.length > lines[best].stopIds.length) best = j;
	}

	return best;
}

/** `run` appears in `whole` as consecutive entries, forwards or backwards. */
function isContiguousRun(run: string[], whole: string[]): boolean {
	const at = whole.indexOf(run[0]);

	if (at < 0) return false;

	const forwards = run.every((id, k) => whole[at + k] === id);
	const backwards = run.every((id, k) => whole[at - k] === id);

	return forwards || backwards;
}

/**
 * What a group's header says.
 *
 * The map's own label when it has one ("A"). Otherwise the letter every member's
 * code starts with, and only as a last resort the bare group number.
 */
function groupLabelFor(members: GroupableLine[], groupId: string): string {
	const own = members.find(m => m.groupLabel && m.groupLabel.trim())?.groupLabel?.trim();

	if (own) return own;

	const letters = new Set(members.map(m => (m.name.match(/^([A-Z]{1,2})\d/) ?? [])[1] ?? ''));

	if (letters.size === 1) {
		const [only] = [...letters];

		if (only) return only;
	}

	return `Group ${groupId}`;
}

/**
 * Indices of the skipped stations on the leg from one point to another,
 * travelling in `direction`, ordered as the train meets them.
 *
 * On a loop (`loopLength` > 0) the leg may run across the seam where the track
 * distance wraps back to zero; distances are measured ahead modulo the loop,
 * so the leg from the last stop round to the first is still one short leg and
 * not the whole of the rest of the line.
 */
export function skippedBetween(
	fromDist: number,
	toDist: number,
	skippedDists: number[],
	direction: number = toDist >= fromDist ? 1 : -1,
	loopLength: number = 0,
): number[] {
	const ahead = (d: number): number => {
		let a = direction >= 0 ? d - fromDist : fromDist - d;

		if (loopLength > 0) a = ((a % loopLength) + loopLength) % loopLength;

		return a;
	};
	const leg = ahead(toDist);
	const found: {i: number; a: number}[] = [];

	skippedDists.forEach((d, i) => {
		const a = ahead(d);

		if (a > 0 && a < leg) found.push({i, a});
	});

	return found.sort((x, y) => x.a - y.a).map(f => f.i);
}

/**
 * How many stations the train runs through on each leg between stops.
 *
 * One entry per leg, the same shape as the ribbon's speed legs: entry i is the
 * leg from stop i to stop i+1.
 */
export function skipsPerLeg(stopDists: number[], skippedDists: number[]): number[] {
	const out: number[] = [];

	for (let i = 1; i < stopDists.length; i++) {
		out.push(skippedBetween(stopDists[i - 1], stopDists[i], skippedDists).length);
	}

	return out;
}

/**
 * The skipped station the train is about to run through, if any.
 *
 * Only one that lies before the next stop and within `withinM` metres: the
 * board is for what is coming up, not for a station three legs away.
 */
export function passingAhead(
	skippedDists: number[],
	trainDist: number,
	direction: number,
	nextStopAheadM: number,
	withinM: number,
	loopLength: number = 0,
): number {
	let best = -1;
	let bestAhead = Infinity;

	skippedDists.forEach((d, i) => {
		let ahead = direction >= 0 ? d - trainDist : trainDist - d;

		if (loopLength > 0) ahead = ((ahead % loopLength) + loopLength) % loopLength;

		if (ahead <= 0 || ahead > withinM || ahead >= nextStopAheadM) return;
		if (ahead < bestAhead) {
			bestAhead = ahead;
			best = i;
		}
	});

	return best;
}

/**
 * A station name short enough for the board: the Latin part, before the local
 * script and the station code. "Holon Junction צומת חולון HLJ" reads "Holon
 * Junction".
 */
export function boardName(name: string): string {
	const latin = (name ?? '').split(/[\u0590-\u05FF\u0600-\u06FF]/)[0].trim();
	const out = (latin || name || '').replace(/[\s\-–—:]+$/, '').trim();

	return out || name;
}
