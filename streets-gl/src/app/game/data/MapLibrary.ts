/**
 * The maps you have played, and what the game remembers about each.
 *
 * Two records, both in localStorage:
 *
 * - **Recents** (`metrorider-saved-maps`, the key the start screen always
 *   used): the maps you picked or drove, newest first, each with when you
 *   last drove it and its line and station counts.
 * - **Sketches** (`metrorider-map-sketches`): each map's thumbnail, kept so a
 *   list of maps can draw its pictures without fetching every map again.
 *   Bounded; the least recently stored go first.
 *
 * Everything that decides anything is a pure function over plain arrays;
 * `MapLibrary` at the bottom is only the storage wrapper.
 */

import {isSketch, sketchMap, type MapSketch} from './MapThumbnail';
import type {MetroMapData} from './RouteParser';

export interface RecentMap {
	url: string;
	name: string;
	/** When it was last picked or driven, ms. */
	ts: number;
	type?: 'map' | 'user';
	/** When it was last actually driven, ms. Absent: loaded, never driven. */
	drivenTs?: number;
	lines?: number;
	stations?: number;
}

/** The key the built-in Tel Aviv map is remembered under: it has no URL. */
export const SAMPLE_KEY = 'builtin:tel-aviv';
export const RECENTS_KEY = 'metrorider-saved-maps';
export const SKETCHES_KEY = 'metrorider-map-sketches';
/** Most recents kept. */
export const MAX_RECENTS = 50;
/**
 * Most sketches kept. A sketch is 0.4–6 KB (measured on the Featured maps:
 * Jerusalem 0.4 KB, Israel Railways 3.7 KB, New York 5.9 KB), so forty of
 * them stay well under 250 KB of a 5 MB store.
 */
export const MAX_SKETCHES = 40;

/**
 * One identity per map, whatever its URL looks like.
 *
 * The same MetroDreamin map turns up as `…/view/abc%3D%3D` (the default map's
 * URL) and `…/view/abc==` (built from an id), and those must be one Recent,
 * not two. Idempotent: a key passed in comes back unchanged.
 */
export function mapKey(url: string): string {
	if (url === SAMPLE_KEY) return SAMPLE_KEY;

	const m = url.match(/\/view\/([^/?#]+)/);

	if (!m) return url;

	try {
		return `md:${decodeURIComponent(m[1])}`;
	} catch {
		return `md:${m[1]}`;
	}
}

/** Read recents out of storage, keeping only entries that make sense. */
export function parseRecents(raw: string | null): RecentMap[] {
	if (!raw) return [];

	try {
		const data = JSON.parse(raw) as unknown;

		if (!Array.isArray(data)) return [];

		return data.filter((e): e is RecentMap => !!e && typeof e.url === 'string'
			&& typeof e.name === 'string' && Number.isFinite(e.ts));
	} catch {
		return [];
	}
}

function upsert(list: RecentMap[], entry: RecentMap): RecentMap[] {
	const key = mapKey(entry.url);
	const old = list.find(e => mapKey(e.url) === key);
	const merged: RecentMap = {...old, ...entry};

	// Keep what was known: a pick does not forget when it was last driven,
	// and an entry without counts does not erase the counts already there.
	if (old?.drivenTs && !entry.drivenTs) merged.drivenTs = old.drivenTs;
	if (entry.lines === undefined && old?.lines !== undefined) merged.lines = old.lines;
	if (entry.stations === undefined && old?.stations !== undefined) merged.stations = old.stations;

	const next = [merged, ...list.filter(e => mapKey(e.url) !== key)];

	return next.slice(0, MAX_RECENTS);
}

/** The player picked this map (or a profile). It goes to the top. */
export function rememberPicked(
	list: RecentMap[],
	entry: {url: string; name: string; type?: 'map' | 'user'; lines?: number; stations?: number},
	now: number,
): RecentMap[] {
	return upsert(list, {...entry, type: entry.type ?? 'map', ts: now});
}

/** The player drove this map. Added if it was not there. */
export function rememberDriven(
	list: RecentMap[],
	entry: {url: string; name: string; lines?: number; stations?: number},
	now: number,
): RecentMap[] {
	return upsert(list, {...entry, type: 'map', ts: now, drivenTs: now});
}

export function forget(list: RecentMap[], url: string): RecentMap[] {
	const key = mapKey(url);

	return list.filter(e => mapKey(e.url) !== key);
}

/**
 * Newest first, by when the map was last picked or driven.
 *
 * Duplicates (two spellings of one map, written by an older version) are
 * folded into the newest.
 */
export function orderRecents(list: RecentMap[]): RecentMap[] {
	const seen = new Set<string>();

	return [...list]
		.sort((a, b) => Math.max(b.ts, b.drivenTs ?? 0) - Math.max(a.ts, a.drivenTs ?? 0))
		.filter(e => {
			const key = mapKey(e.url);

			if (seen.has(key)) return false;
			seen.add(key);

			return true;
		});
}

/** When, said the way a person says it. */
export function describeWhen(ts: number, now: number): string {
	const day = (t: number): number => {
		const d = new Date(t);

		return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
	};
	const days = Math.round(day(now) - day(ts));

	if (days <= 0) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 7) return `${days} days ago`;
	if (days < 14) return 'last week';
	if (days < 31) return `${Math.floor(days / 7)} weeks ago`;
	if (days < 60) return 'last month';
	if (days < 365) return `${Math.floor(days / 30)} months ago`;

	return 'over a year ago';
}

/**
 * How much of a map the journey record says you have driven.
 *
 * The record keys lines as `map::line` and stations as `map::line::index`,
 * where `map` is the map's NAME — so two different maps that share a name
 * share a record. Rare (a handful of auto-titled "Oceanside, California"
 * maps), and the alternative is a record that cannot say anything at all.
 */
export function progressOn(
	journey: {lines: readonly string[]; stations: readonly string[]} | null | undefined,
	mapName: string,
): {lines: number; stations: number} {
	if (!journey || !mapName) return {lines: 0, stations: 0};

	const prefix = `${mapName}::`;

	return {
		lines: journey.lines.filter(k => k.startsWith(prefix)).length,
		stations: journey.stations.filter(k => k.startsWith(prefix)).length,
	};
}

/** What a Recents row says under the map's name. */
export interface RecentFacts {
	/** "26 lines · 84 stops", or '' when not known yet. */
	counts: string;
	/** "Driven yesterday · 3 of 26 lines", or '' when never driven. */
	driven: string;
}

export function recentFacts(
	entry: RecentMap,
	progress: {lines: number; stations: number},
	now: number,
	sketch?: MapSketch | null,
): RecentFacts {
	const lines = entry.lines ?? sketch?.lineCount;
	const stations = entry.stations ?? sketch?.stationCount;
	const counts = entry.type === 'user' || lines === undefined || stations === undefined
		? ''
		: `${lines} line${lines === 1 ? '' : 's'} · ${stations} stop${stations === 1 ? '' : 's'}`;
	let driven = '';

	if (entry.drivenTs) {
		driven = `Driven ${describeWhen(entry.drivenTs, now)}`;

		if (progress.lines > 0) {
			driven += lines
				? ` · ${Math.min(progress.lines, lines)} of ${lines} line${lines === 1 ? '' : 's'}`
				: ` · ${progress.lines} line${progress.lines === 1 ? '' : 's'}`;
		}
	}

	return {counts, driven};
}

// ── Sketch cache ────────────────────────────────────────────────────────────

export type SketchCache = Record<string, {at: number; s: MapSketch}>;

export function parseSketches(raw: string | null): SketchCache {
	if (!raw) return {};

	try {
		const data = JSON.parse(raw) as Record<string, {at: number; s: unknown}>;
		const out: SketchCache = {};

		if (!data || typeof data !== 'object') return {};

		for (const [key, value] of Object.entries(data)) {
			if (value && Number.isFinite(value.at) && isSketch(value.s)) out[key] = {at: value.at, s: value.s};
		}

		return out;
	} catch {
		return {};
	}
}

/** Store a map's sketch, dropping the oldest past `max`. */
export function cacheSketch(
	cache: SketchCache,
	key: string,
	sketch: MapSketch,
	now: number,
	max: number = MAX_SKETCHES,
): SketchCache {
	const next: SketchCache = {...cache, [key]: {at: now, s: sketch}};
	const keys = Object.keys(next);

	if (keys.length <= max) return next;

	for (const old of keys.sort((a, b) => next[a].at - next[b].at).slice(0, keys.length - max)) {
		delete next[old];
	}

	return next;
}

/**
 * The storage wrapper. Every read and write is guarded: a blocked or full
 * store means no Recents, never a start screen that fails to draw.
 */
export class MapLibrary {
	public constructor(
		private readonly store: Pick<Storage, 'getItem' | 'setItem'> | null,
		private readonly clock: () => number = Date.now,
	) {}

	/** The library over this browser's localStorage (none when it is blocked). */
	public static forBrowser(): MapLibrary {
		let store: Storage | null = null;

		try {
			store = window.localStorage;
		} catch {
			store = null;
		}

		return new MapLibrary(store);
	}

	private read(key: string): string | null {
		try {
			return this.store?.getItem(key) ?? null;
		} catch {
			return null;
		}
	}

	private write(key: string, value: unknown): void {
		try {
			this.store?.setItem(key, JSON.stringify(value));
		} catch {
			// Full or blocked: the list just stays as it was.
		}
	}

	public recents(): RecentMap[] {
		return orderRecents(parseRecents(this.read(RECENTS_KEY)));
	}

	public picked(url: string, name: string, type: 'map' | 'user' = 'map', map?: MetroMapData): void {
		const counts = map ? this.remember(url, map) : null;

		this.write(RECENTS_KEY, rememberPicked(parseRecents(this.read(RECENTS_KEY)), {
			url, name, type, lines: counts?.lineCount, stations: counts?.stationCount,
		}, this.clock()));
	}

	public driven(url: string, name: string): void {
		const sketch = this.sketch(url);

		this.write(RECENTS_KEY, rememberDriven(parseRecents(this.read(RECENTS_KEY)), {
			url, name, lines: sketch?.lineCount, stations: sketch?.stationCount,
		}, this.clock()));
	}

	public remove(url: string): void {
		this.write(RECENTS_KEY, forget(parseRecents(this.read(RECENTS_KEY)), url));
	}

	/** Keep this map's sketch; returns it. */
	public remember(url: string, map: MetroMapData): MapSketch {
		const sketch = sketchMap(map);

		this.write(SKETCHES_KEY, cacheSketch(parseSketches(this.read(SKETCHES_KEY)), mapKey(url), sketch, this.clock()));

		return sketch;
	}

	public sketch(url: string): MapSketch | null {
		return parseSketches(this.read(SKETCHES_KEY))[mapKey(url)]?.s ?? null;
	}

	/** Every cached sketch at once, for drawing a list without re-reading. */
	public sketches(): Map<string, MapSketch> {
		return new Map(Object.entries(parseSketches(this.read(SKETCHES_KEY))).map(([k, v]) => [k, v.s]));
	}
}
