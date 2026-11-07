import {featuredMaps, isFeatured, withoutFeatured, sketchFor} from '~/app/game/data/FeaturedMaps';
import {featuredCards, recentRows, sheetRecents, MAX_SHEET_RECENTS} from '~/app/game/data/MapBrowserModel';
import {SAMPLE_KEY, mapKey, type RecentMap} from '~/app/game/data/MapLibrary';
import {sketchMap} from '~/app/game/data/MapThumbnail';
import {SAMPLE_MAP} from '~/app/game/data/StartMaps';

/**
 * Featured and Recent, as the lists show them.
 */

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 7, 15, 0).getTime();
const ISRAEL = 'https://metrodreamin.com/view/QVQ2V2ZIYVpyUFEzNE1acEVLcGhlVkdqR3BPMnwxNg%3D%3D';

describe('Featured', () => {
	it('starts with the built-in map, which needs no fetch, then Israel Railways', () => {
		const list = featuredMaps();

		expect(list[0]).toMatchObject({id: null, key: SAMPLE_KEY, title: 'Tel Aviv Metro'});
		expect(list[1].title).toBe('Israel Railways');
		expect(list[1].key).toBe(mapKey(ISRAEL));
	});

	it('is a handful, every one with a picture', () => {
		const list = featuredMaps();

		expect(list.length).toBeGreaterThanOrEqual(5);
		expect(list.length).toBeLessThanOrEqual(8);
		for (const f of list) expect(f.sketch.lines.length).toBeGreaterThan(0);
	});

	it('the cards keep their curated order and say the size', () => {
		const cards = featuredCards(new Map());

		expect(cards.map(c => c.title)).toEqual(featuredMaps().map(f => f.title));
		expect(cards[0].meta).toBe(`3 lines · ${sketchMap(SAMPLE_MAP).stationCount} stops`);
	});

	it('a map\'s own load replaces its baked picture', () => {
		const fresh = sketchMap(SAMPLE_MAP);
		const cards = featuredCards(new Map([[mapKey(ISRAEL), fresh]]));

		expect(cards[1].sketch).toBe(fresh);
	});

	it('is not offered twice on the long list', () => {
		const israelId = featuredMaps()[1].id as string;
		const rest = withoutFeatured([{id: israelId}, {id: 'somewhere-else'}]);

		expect(rest).toEqual([{id: 'somewhere-else'}]);
		expect(isFeatured(ISRAEL)).toBe(true);
		expect(isFeatured('https://metrodreamin.com/view/nope')).toBe(false);
	});

	it('sketchFor: cached first, then baked, then nothing', () => {
		const fresh = sketchMap(SAMPLE_MAP);

		expect(sketchFor(ISRAEL, new Map())).toBe(featuredMaps()[1].sketch);
		expect(sketchFor(ISRAEL, new Map([[mapKey(ISRAEL), fresh]]))).toBe(fresh);
		expect(sketchFor('https://metrodreamin.com/view/unknown', new Map())).toBeNull();
	});
});

describe('Recent rows', () => {
	const recents: RecentMap[] = [
		{url: SAMPLE_KEY, name: 'Tel Aviv Metro', ts: NOW, drivenTs: NOW, lines: 3, stations: 20},
		{url: 'https://metrodreamin.com/user/abc', name: 'abc (12 maps)', ts: NOW - DAY, type: 'user'},
		{url: ISRAEL, name: 'Israel railways', ts: NOW - 2 * DAY, drivenTs: NOW - 2 * DAY},
		{url: 'https://metrodreamin.com/view/never-driven', name: 'Picked once', ts: NOW - 3 * DAY},
	];
	const journey = {lines: ['Tel Aviv Metro::red', 'Israel railways::1', 'Israel railways::2'], stations: [] as string[]};

	it('each row has its picture and its facts', () => {
		const rows = recentRows(recents, new Map(), journey, NOW);

		expect(rows.map(r => r.name)).toEqual(recents.map(r => r.name));
		expect(rows[0]).toMatchObject({key: SAMPLE_KEY, counts: '3 lines · 20 stops', driven: 'Driven today · 1 of 3 lines'});
		// Featured: drawn from the baked picture though it was never cached.
		expect(rows[2].sketch).not.toBeNull();
		expect(rows[2].counts).toBe('26 lines · 84 stops');
		expect(rows[2].driven).toBe('Driven 2 days ago · 2 of 26 lines');
		// A profile has no picture and no counts; a map never driven says only what it is.
		expect(rows[1]).toMatchObject({isUser: true, sketch: null, counts: '', driven: ''});
		expect(rows[3]).toMatchObject({sketch: null, counts: '', driven: ''});
	});

	it('the in-game sheet offers maps you drove, not profiles, not the one you are on', () => {
		const list = sheetRecents(recents, mapKey(ISRAEL));

		expect(list.map(r => r.name)).toEqual(['Tel Aviv Metro']);
		expect(sheetRecents(recents, null).map(r => r.name)).toEqual(['Tel Aviv Metro', 'Israel railways']);
	});

	it('the in-game sheet keeps it short', () => {
		const many = Array.from({length: 10}, (_, i) => ({url: `u${i}`, name: `${i}`, ts: i, drivenTs: i}));

		expect(sheetRecents(many, null)).toHaveLength(MAX_SHEET_RECENTS);
	});
});
