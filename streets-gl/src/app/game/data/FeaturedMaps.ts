/**
 * Featured maps: a handful of good places to start.
 *
 * Every one is a real map that was loaded through the game's own importer and
 * route parser before it went on this list (`scripts/featured/
 * bake-featured-maps.ts --check <id>` says so for each), and each was picked
 * to drive well: real lines in real places, small enough to load quickly,
 * every line with at least two stops.
 *
 * The built-in Tel Aviv map comes first. It ships inside the game, so it loads
 * with no fetch at all — the one that always works.
 *
 * Titles are written here rather than taken from the map, because a map's own
 * title can run to a paragraph and a card has room for three words.
 */

import {SAMPLE_MAP} from './StartMaps';
import {FEATURED_SKETCHES} from './FeaturedSketches';
import {sketchMap, type MapSketch} from './MapThumbnail';
import {SAMPLE_KEY, mapKey} from './MapLibrary';

export interface FeaturedMap {
	/** The MetroDreamin id, or null for the built-in map. */
	id: string | null;
	/** The key a Recent for this map has (`mapKey`). */
	key: string;
	title: string;
	sketch: MapSketch;
}

const MD = 'QVQ2V2ZIYVpyUFEzNE1acEVLcGhlVkdqR3BPMnw';

/** In the order they are shown. */
const LIST: {id: string | null; title: string}[] = [
	{id: null, title: 'Tel Aviv Metro'},
	{id: `${MD}xNg==`, title: 'Israel Railways'},
	{id: `${MD}xOTU=`, title: 'Jerusalem Light Rail'},
	{id: `${MD}xNDM=`, title: 'Paris Métro'},
	{id: `${MD}xMTM=`, title: 'Washington Metro'},
	{id: `${MD}xNjc=`, title: 'San Francisco BART'},
];

let built: FeaturedMap[] | null = null;

/** The Featured maps, each with a sketch to draw. Maps without one are left out. */
export function featuredMaps(): FeaturedMap[] {
	if (built) return built;

	built = [];

	for (const entry of LIST) {
		const sketch = entry.id === null ? sketchMap(SAMPLE_MAP) : FEATURED_SKETCHES[entry.id];

		if (!sketch) continue;

		built.push({
			id: entry.id,
			key: entry.id === null ? SAMPLE_KEY : `md:${entry.id}`,
			title: entry.title,
			sketch,
		});
	}

	return built;
}

/** Is this map (by URL or key) one of the Featured ones? */
export function isFeatured(urlOrKey: string): boolean {
	const key = mapKey(urlOrKey);

	return featuredMaps().some(f => f.key === key);
}

/**
 * A long list of maps with the Featured ones taken out, so a map is not
 * offered twice on one sheet.
 */
export function withoutFeatured<T extends {id: string}>(maps: readonly T[]): T[] {
	const featured = new Set(featuredMaps().map(f => f.id));

	return maps.filter(m => !featured.has(m.id));
}

/**
 * The sketch to draw for a map: the one cached from its own load when there
 * is one (it is the newest), else the baked Featured one, else none.
 */
export function sketchFor(
	urlOrKey: string,
	cached: ReadonlyMap<string, MapSketch>,
): MapSketch | null {
	const key = mapKey(urlOrKey);

	return cached.get(key) ?? featuredMaps().find(f => f.key === key)?.sketch ?? null;
}
