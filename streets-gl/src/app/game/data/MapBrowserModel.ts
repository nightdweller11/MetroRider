/**
 * What the map lists say, decided away from the DOM.
 *
 * The start screen and the in-game "Drive another map" sheet both show
 * Featured maps and Recent ones; this is where the rows are worked out — the
 * order, which picture, which facts — so both say the same thing and it can
 * be tested without a browser.
 */

import {featuredMaps, sketchFor, type FeaturedMap} from './FeaturedMaps';
import {mapKey, progressOn, recentFacts, type RecentMap} from './MapLibrary';
import type {MapSketch} from './MapThumbnail';

type Journey = {lines: readonly string[]; stations: readonly string[]} | null | undefined;

export interface RecentRowModel {
	url: string;
	key: string;
	name: string;
	isUser: boolean;
	sketch: MapSketch | null;
	counts: string;
	driven: string;
}

/** Most Recent rows the start screen lists. */
export const MAX_RECENT_ROWS = 20;
/** Most Recent rows on the in-game sheet, which has Featured and the rest under them. */
export const MAX_SHEET_RECENTS = 4;

/** The Recent list: newest first, each with its picture and its facts. */
export function recentRows(
	recents: readonly RecentMap[],
	cached: ReadonlyMap<string, MapSketch>,
	journey: Journey,
	now: number,
	limit: number = MAX_RECENT_ROWS,
): RecentRowModel[] {
	return recents.slice(0, limit).map(entry => {
		const isUser = entry.type === 'user';
		const sketch = isUser ? null : sketchFor(entry.url, cached);
		const facts = recentFacts(entry, progressOn(journey, entry.name), now, sketch);

		return {
			url: entry.url,
			key: mapKey(entry.url),
			name: entry.name,
			isUser,
			sketch,
			counts: facts.counts,
			driven: facts.driven,
		};
	});
}

/** The Recents worth offering on the in-game sheet: maps you drove, not profiles, not this one. */
export function sheetRecents(
	recents: readonly RecentMap[],
	currentKey: string | null,
	limit: number = MAX_SHEET_RECENTS,
): RecentMap[] {
	return recents
		.filter(r => r.type !== 'user' && !!r.drivenTs && mapKey(r.url) !== currentKey)
		.slice(0, limit);
}

export interface FeaturedCardModel {
	key: string;
	id: string | null;
	title: string;
	sketch: MapSketch;
	meta: string;
}

/**
 * The Featured cards, in their curated order. A map's own cached sketch
 * replaces the baked one once it has been loaded.
 */
export function featuredCards(cached: ReadonlyMap<string, MapSketch>): FeaturedCardModel[] {
	return featuredMaps().map((f: FeaturedMap) => {
		const sketch = cached.get(f.key) ?? f.sketch;
		const lines = sketch.lineCount;

		return {
			key: f.key,
			id: f.id,
			title: f.title,
			sketch,
			meta: `${lines} line${lines === 1 ? '' : 's'} · ${sketch.stationCount} stops`,
		};
	});
}
