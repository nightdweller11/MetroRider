import {
	mapKey, parseRecents, rememberPicked, rememberDriven, forget, orderRecents, describeWhen,
	progressOn, recentFacts, parseSketches, cacheSketch, MapLibrary, SAMPLE_KEY, MAX_RECENTS,
	RECENTS_KEY, type RecentMap,
} from '~/app/game/data/MapLibrary';
import {sketchMap} from '~/app/game/data/MapThumbnail';
import {SAMPLE_MAP} from '~/app/game/data/StartMaps';

/**
 * Recents and the thumbnail cache.
 *
 * The traps: the same map under two URL spellings showing up twice; the map
 * the start screen fetches by itself pretending to be something you played;
 * and a cache that grows until the store is full.
 */

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 7, 15, 0).getTime();
const ENCODED = 'https://metrodreamin.com/view/QVQ2V2ZIYVpyUFEzNE1acEVLcGhlVkdqR3BPMnwxNg%3D%3D';
const PLAIN = 'https://metrodreamin.com/view/QVQ2V2ZIYVpyUFEzNE1acEVLcGhlVkdqR3BPMnwxNg==';

function memoryStore(): Storage & {data: Map<string, string>} {
	const data = new Map<string, string>();

	return {
		data,
		getItem: (k: string): string | null => data.get(k) ?? null,
		setItem: (k: string, v: string): void => void data.set(k, v),
	} as unknown as Storage & {data: Map<string, string>};
}

describe('mapKey', () => {
	it('is one key for both spellings of a MetroDreamin URL', () => {
		expect(mapKey(ENCODED)).toBe(mapKey(PLAIN));
		expect(mapKey(PLAIN)).toBe('md:QVQ2V2ZIYVpyUFEzNE1acEVLcGhlVkdqR3BPMnwxNg==');
	});

	it('is idempotent, and leaves the built-in key and profile URLs alone', () => {
		expect(mapKey(mapKey(PLAIN))).toBe(mapKey(PLAIN));
		expect(mapKey(SAMPLE_KEY)).toBe(SAMPLE_KEY);
		expect(mapKey('https://metrodreamin.com/user/abc')).toBe('https://metrodreamin.com/user/abc');
	});
});

describe('recents', () => {
	it('a pick goes to the top; a second spelling of the same map replaces it', () => {
		let list: RecentMap[] = [];

		list = rememberPicked(list, {url: ENCODED, name: 'Israel'}, NOW - 2 * DAY);
		list = rememberPicked(list, {url: 'https://metrodreamin.com/view/b', name: 'B'}, NOW - DAY);
		list = rememberPicked(list, {url: PLAIN, name: 'Israel'}, NOW);

		expect(list.map(e => e.name)).toEqual(['Israel', 'B']);
	});

	it('driving stamps the date and adds the map when it was not there', () => {
		const list = rememberDriven([], {url: SAMPLE_KEY, name: 'Tel Aviv Metro', lines: 3, stations: 20}, NOW);

		expect(list).toEqual([{url: SAMPLE_KEY, name: 'Tel Aviv Metro', lines: 3, stations: 20, type: 'map', ts: NOW, drivenTs: NOW}]);
	});

	it('a later pick keeps when the map was last driven, and its counts', () => {
		let list = rememberDriven([], {url: PLAIN, name: 'Israel', lines: 26, stations: 84}, NOW - 3 * DAY);

		list = rememberPicked(list, {url: ENCODED, name: 'Israel'}, NOW);

		expect(list[0].drivenTs).toBe(NOW - 3 * DAY);
		expect(list[0].lines).toBe(26);
		expect(list[0].ts).toBe(NOW);
	});

	it('orders by the latest of picked and driven, newest first, folding duplicates', () => {
		const list: RecentMap[] = [
			{url: 'https://metrodreamin.com/view/a', name: 'A', ts: NOW - 5 * DAY},
			{url: 'https://metrodreamin.com/view/b', name: 'B', ts: NOW - 9 * DAY, drivenTs: NOW - DAY},
			{url: 'https://metrodreamin.com/view/c', name: 'C', ts: NOW - 2 * DAY},
			{url: 'https://metrodreamin.com/view/a%3D', name: 'A old copy', ts: NOW - 10 * DAY},
		];

		expect(orderRecents(list).map(e => e.name)).toEqual(['B', 'C', 'A', 'A old copy']);
	});

	it('forget removes every spelling of a map', () => {
		const list: RecentMap[] = [{url: ENCODED, name: 'I', ts: 1}, {url: 'x', name: 'X', ts: 2}];

		expect(forget(list, PLAIN).map(e => e.name)).toEqual(['X']);
	});

	it('is capped', () => {
		let list: RecentMap[] = [];

		for (let i = 0; i < MAX_RECENTS + 10; i++) list = rememberPicked(list, {url: `u${i}`, name: `${i}`}, i);

		expect(list).toHaveLength(MAX_RECENTS);
		expect(list[0].name).toBe(String(MAX_RECENTS + 9));
	});

	it('reads old and broken storage without falling over', () => {
		expect(parseRecents(null)).toEqual([]);
		expect(parseRecents('not json')).toEqual([]);
		expect(parseRecents('{"a":1}')).toEqual([]);
		// The 2.x format: no drivenTs, no counts.
		expect(parseRecents('[{"url":"u","name":"n","ts":5,"type":"user"},{"bad":true}]'))
			.toEqual([{url: 'u', name: 'n', ts: 5, type: 'user'}]);
	});
});

describe('describeWhen', () => {
	it('says it the way a person would', () => {
		expect(describeWhen(NOW - 60_000, NOW)).toBe('today');
		expect(describeWhen(NOW - DAY, NOW)).toBe('yesterday');
		expect(describeWhen(NOW - 3 * DAY, NOW)).toBe('3 days ago');
		expect(describeWhen(NOW - 9 * DAY, NOW)).toBe('last week');
		expect(describeWhen(NOW - 20 * DAY, NOW)).toBe('2 weeks ago');
		expect(describeWhen(NOW - 45 * DAY, NOW)).toBe('last month');
		expect(describeWhen(NOW - 100 * DAY, NOW)).toBe('3 months ago');
		expect(describeWhen(NOW - 400 * DAY, NOW)).toBe('over a year ago');
	});

	it('goes by the calendar: late last night is yesterday', () => {
		const morning = new Date(2026, 10, 7, 8, 0).getTime();
		const lastNight = new Date(2026, 10, 6, 23, 30).getTime();

		expect(describeWhen(lastNight, morning)).toBe('yesterday');
	});
});

describe('progress and facts', () => {
	const journey = {
		lines: ['Israel::1', 'Israel::4', 'Paris::1', 'Israel Extra::1'],
		stations: ['Israel::1::0', 'Israel::1::1', 'Paris::1::3'],
	};

	it('counts only this map\'s lines and stations', () => {
		expect(progressOn(journey, 'Israel')).toEqual({lines: 2, stations: 2});
		expect(progressOn(journey, 'London')).toEqual({lines: 0, stations: 0});
		expect(progressOn(null, 'Israel')).toEqual({lines: 0, stations: 0});
	});

	it('says what the map is and what you did on it', () => {
		const entry: RecentMap = {url: PLAIN, name: 'Israel', ts: NOW, drivenTs: NOW - DAY, lines: 26, stations: 84};

		expect(recentFacts(entry, {lines: 2, stations: 2}, NOW)).toEqual({
			counts: '26 lines · 84 stops',
			driven: 'Driven yesterday · 2 of 26 lines',
		});
	});

	it('says nothing it does not know', () => {
		expect(recentFacts({url: 'u', name: 'n', ts: NOW}, {lines: 0, stations: 0}, NOW))
			.toEqual({counts: '', driven: ''});
		expect(recentFacts({url: 'u', name: 'profile', ts: NOW, type: 'user'}, {lines: 0, stations: 0}, NOW).counts)
			.toBe('');
	});

	it('takes counts from the cached sketch when the entry has none', () => {
		const sketch = sketchMap(SAMPLE_MAP);
		const facts = recentFacts({url: SAMPLE_KEY, name: 'Tel Aviv Metro', ts: NOW, drivenTs: NOW}, {lines: 1, stations: 3}, NOW, sketch);

		expect(facts.counts).toBe(`3 lines · ${sketch.stationCount} stops`);
		expect(facts.driven).toBe('Driven today · 1 of 3 lines');
	});
});

describe('sketch cache', () => {
	const sketch = sketchMap(SAMPLE_MAP);

	it('drops the oldest past the cap', () => {
		let cache = {};

		for (let i = 0; i < 5; i++) cache = cacheSketch(cache, `k${i}`, sketch, i, 3);

		expect(Object.keys(cache).sort()).toEqual(['k2', 'k3', 'k4']);
	});

	it('re-storing a map refreshes it rather than adding a second', () => {
		let cache = cacheSketch({}, 'a', sketch, 1, 2);

		cache = cacheSketch(cache, 'b', sketch, 2, 2);
		cache = cacheSketch(cache, 'a', sketch, 3, 2);
		cache = cacheSketch(cache, 'c', sketch, 4, 2);

		expect(Object.keys(cache).sort()).toEqual(['a', 'c']);
	});

	it('ignores anything in storage that is not a sketch', () => {
		const raw = JSON.stringify({good: {at: 1, s: sketch}, bad: {at: 1, s: {v: 2}}, worse: 7});

		expect(Object.keys(parseSketches(raw))).toEqual(['good']);
		expect(parseSketches('{')).toEqual({});
	});
});

describe('MapLibrary', () => {
	it('a picked map with its data is remembered with counts and a picture', () => {
		const store = memoryStore();
		const library = new MapLibrary(store, () => NOW);

		library.picked(ENCODED, 'Tel Aviv Metro', 'map', SAMPLE_MAP);

		const [entry] = library.recents();

		expect(entry.lines).toBe(3);
		expect(entry.drivenTs).toBeUndefined();
		expect(library.sketch(PLAIN)?.lineCount).toBe(3);
	});

	it('remember() keeps the picture without adding a Recent', () => {
		const library = new MapLibrary(memoryStore(), () => NOW);

		library.remember(ENCODED, SAMPLE_MAP);

		expect(library.recents()).toEqual([]);
		expect(library.sketches().get(mapKey(ENCODED))).toBeTruthy();
	});

	it('driven() uses the cached counts', () => {
		const library = new MapLibrary(memoryStore(), () => NOW);

		library.remember(SAMPLE_KEY, SAMPLE_MAP);
		library.driven(SAMPLE_KEY, 'Tel Aviv Metro');

		expect(library.recents()[0]).toMatchObject({url: SAMPLE_KEY, lines: 3, drivenTs: NOW});
	});

	it('a store that throws is just an empty library', () => {
		const broken = {
			getItem: (): string => { throw new Error('blocked'); },
			setItem: (): void => { throw new Error('full'); },
		} as unknown as Storage;
		const library = new MapLibrary(broken, () => NOW);

		expect(() => library.picked('u', 'n')).not.toThrow();
		expect(library.recents()).toEqual([]);
		expect(new MapLibrary(null).sketch('u')).toBeNull();
	});

	it('keeps the storage key the start screen always used', () => {
		const store = memoryStore();

		store.setItem(RECENTS_KEY, JSON.stringify([{url: PLAIN, name: 'From 2.50', ts: 5}]));

		expect(new MapLibrary(store).recents()[0].name).toBe('From 2.50');
	});
});
