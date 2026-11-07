/**
 * Line groups and express patterns (F4) and the no-spawn rule for skipped
 * stations (F5).
 *
 * The fixture is the REAL Israel-railways MetroDreamin map, fetched through
 * the importer's own path on 2026-11-07 — every line, group, icon and
 * `waypointOverrides` list exactly as the payload carries them. Only the bend
 * points (waypoints) were dropped from each line's path to keep the file
 * small; nothing about stopping depends on them.
 */
import * as fs from 'fs';
import * as path from 'path';
import {convertToMetroMapData} from '~/app/game/data/MetroDreaminImporter';
import {parseMetroMap, type MetroMapData, type ParsedLine} from '~/app/game/data/RouteParser';
import {buildTrackData} from '~/app/game/data/TrackBuilder';
import {TEL_AVIV_METRO} from '~/app/game/data/SampleRoutes';
import {buildInterchangeIndex, linesServing} from '~/app/game/data/Interchanges';
import {
	authorMarkedExpress, boardName, effectiveSkips, groupLinesForPicker, partOfSibling,
	passingAhead, patternNote, skippedBetween, skipsPerLeg, type GroupableLine,
} from '~/app/game/data/ServicePatterns';
import {linePickerRows} from '~/app/game/ui/LinePicker';
import {buildRibbon} from '~/app/game/ui/RouteRibbon';
import {buildTimetable} from '~/app/game/service/ServiceTimetable';
import {PassengerModel} from '~/app/game/passengers/PassengerModel';

const pageProps = JSON.parse(
	fs.readFileSync(path.join(__dirname, 'fixtures', 'israel-railways-stops.json'), 'utf8'),
);

function israel(): {map: MetroMapData; parsed: ParsedLine[]} {
	const map = convertToMetroMapData(pageProps);

	return {map, parsed: parseMetroMap(map)};
}

function byCode(parsed: ParsedLine[], prefix: string): ParsedLine {
	const line = parsed.find(l => l.name.startsWith(prefix));

	if (!line) throw new Error(`no line ${prefix}`);

	return line;
}

/** The same dists TrainSystem works out per line. */
function dists(line: ParsedLine): {stops: number[]; skipped: number[]; total: number} {
	const track = buildTrackData(line.allPoints, line.isLoop);

	return {
		stops: line.stationPointIndices.map(i => track.stationDists[i]),
		skipped: line.skippedPointIndices.map(i => track.stationDists[i]),
		total: track.totalLength,
	};
}

describe('what the real Israel-railways payload carries', () => {
	test('26 drivable lines, each with its group and the group label', () => {
		const {map} = israel();

		expect(map.lines).toHaveLength(26);
		expect(map.lines.every(l => typeof l.groupId === 'string')).toBe(true);

		const a = map.lines.filter(l => l.groupId === '2');

		expect(a.map(l => l.name.slice(0, 7))).toEqual(['A1 - A2', 'A1 - A3', 'A1 - A4', 'A1 - A5']);
		expect(a.every(l => l.groupLabel === 'A')).toBe(true);
	});

	test('A1-A5 runs through four named stations without stopping', () => {
		const {map, parsed} = israel();
		const a5 = byCode(parsed, 'A1 - A5');

		expect(map.stations[a5.skipped[0].id]).toBeDefined();
		// In the order the train meets them, Herzliya southwards.
		expect(a5.skipped.map(s => boardName(s.name))).toEqual([
			'Holon Junction', 'Holon Wolfson', 'Bat Yam Yoseftal', 'Bat Yam Komemuyot',
		]);
		expect(a5.stations).toHaveLength(16);
		expect(a5.express).toBe(true);
		// None of the skipped stations is also a stop.
		const stopIds = new Set(a5.stations.map(s => s.id));

		expect(a5.skipped.some(s => stopIds.has(s.id))).toBe(false);
	});

	test('the five lines the author marked express are the five called Express', () => {
		const {parsed} = israel();
		const express = parsed.filter(l => l.express).map(l => l.name.slice(0, 7));

		expect(express.sort()).toEqual(['A1 - A5', 'D1 - D2', 'E1 - E2', 'F1 - F2', 'H1 - H3']);
	});

	test('stale overrides are ignored: the G lines list stations they no longer go near', () => {
		const {parsed} = israel();

		expect(byCode(parsed, 'G1 - G2').skipped).toHaveLength(0);
		expect(byCode(parsed, 'G1 - G3').skipped).toHaveLength(0);
		// D1-D2 lists 17 entries: one id that no longer exists and one twice.
		expect(byCode(parsed, 'D1 - D2').skipped).toHaveLength(15);
	});

	test('a local that passes stations says how many, but is not called express', () => {
		const b = byCode(israel().parsed, 'B1 - B2');

		expect(b.skipped).toHaveLength(2);
		expect(b.express).toBeFalsy();
	});
});

describe('effectiveSkips', () => {
	const stops = ['a', 'b', 'c', 'd', 'e'];

	test('keeps interior stations on the path, in path order', () => {
		expect(effectiveSkips(stops, ['d', 'b'])).toEqual(['b', 'd']);
	});

	test('never skips either end', () => {
		expect(effectiveSkips(stops, ['a', 'e', 'c'])).toEqual(['c']);
	});

	test('drops ids not on the line, duplicates and junk', () => {
		expect(effectiveSkips(stops, ['zz', 'c', 'c', 7, null])).toEqual(['c']);
		expect(effectiveSkips(stops, undefined)).toEqual([]);
		expect(effectiveSkips(stops, 'c')).toEqual([]);
	});

	test('a loop never skips the station it closes on', () => {
		expect(effectiveSkips(['a', 'b', 'c', 'a'], ['a', 'b'])).toEqual(['b']);
	});
});

describe('authorMarkedExpress / patternNote', () => {
	test('diamond bullet or the word', () => {
		expect(authorMarkedExpress('Anything', 'diamond')).toBe(true);
		expect(authorMarkedExpress('Haifa Express - Bet Shean Local', 'circle')).toBe(true);
		expect(authorMarkedExpress('Beach Local', 'circle')).toBe(false);
		expect(authorMarkedExpress(undefined, undefined)).toBe(false);
		// "Expressway" is a road, not a service pattern.
		expect(authorMarkedExpress('Expressway Shuttle', undefined)).toBe(false);
	});

	test('notes', () => {
		expect(patternNote({express: true, skippedCount: 4})).toBe('Express · skips 4');
		expect(patternNote({skippedCount: 2})).toBe('skips 2');
		expect(patternNote({skippedCount: 0}, 'A1-A2')).toBe('part of A1-A2');
		expect(patternNote({skippedCount: 0})).toBe('');
	});
});

describe('the parser keeps skipped stations out of the stops', () => {
	const map: MetroMapData = {
		name: 'T',
		stations: {
			a: {name: 'A', lat: 32.0, lng: 34.8},
			b: {name: 'B', lat: 32.01, lng: 34.8},
			c: {name: 'C', lat: 32.02, lng: 34.8},
			d: {name: 'D', lat: 32.03, lng: 34.8},
		},
		lines: [
			{id: 'x', name: 'X', color: '#f00', stationIds: ['a', 'b', 'c', 'd'], skipStationIds: ['b']},
			{id: 'y', name: 'Y', color: '#0f0', stationIds: ['a', 'b', 'c', 'd']},
		],
	};

	test('stops, skipped and their point indices line up', () => {
		const [x, y] = parseMetroMap(map);

		expect(x.stations.map(s => s.id)).toEqual(['a', 'c', 'd']);
		expect(x.stationPointIndices).toEqual([0, 2, 3]);
		expect(x.skipped.map(s => s.id)).toEqual(['b']);
		expect(x.skippedPointIndices).toEqual([1]);
		expect(y.skipped).toEqual([]);
	});

	test('a skip list that would leave one stop is ignored, not obeyed', () => {
		const broken: MetroMapData = {
			...map,
			lines: [{id: 'z', name: 'Z', color: '#f00', stationIds: ['a', 'b'], skipStationIds: ['a']}],
		};
		const [z] = parseMetroMap(broken);

		expect(z.stations.map(s => s.id)).toEqual(['a', 'b']);
		expect(z.skipped).toEqual([]);
	});

	test('a line that skips a station does not "serve" it for interchanges', () => {
		const parsed = parseMetroMap(map);

		expect(linesServing(parsed, 'b', '').map(l => l.id)).toEqual(['y']);
		// Only one line calls at b, so it is not an interchange at all.
		expect(buildInterchangeIndex(parsed).has('b')).toBe(false);
	});
});

describe('grouping for the picker', () => {
	const line = (name: string, stopIds: string[], groupId?: string, groupLabel?: string): GroupableLine =>
		({name, stopIds, groupId, groupLabel});

	test('no groups: the same flat list as before', () => {
		const entries = groupLinesForPicker([line('R', ['a', 'b']), line('G', ['c', 'd'])]);

		expect(entries).toEqual([
			{kind: 'line', index: 0, grouped: false, partOf: null},
			{kind: 'line', index: 1, grouped: false, partOf: null},
		]);
	});

	test('a group of one gets no header', () => {
		const entries = groupLinesForPicker([line('J1', ['a', 'b'], '10', 'J')]);

		expect(entries.filter(e => e.kind === 'header')).toHaveLength(0);
	});

	test('a group is gathered where its first line stands, longest first', () => {
		const entries = groupLinesForPicker([
			line('C2 - C7', ['x', 'y'], '4', 'C'),
			line('Other', ['p', 'q']),
			line('C1 - C2', ['a', 'x', 'y', 'z'], '4', 'C'),
		]);

		expect(entries.map(e => (e.kind === 'header' ? `H:${e.label}:${e.count}` : e.index))).toEqual([
			'H:C:2', 2, 0, 1,
		]);
	});

	test('a short working is part of the longest sibling that calls everywhere it does', () => {
		const lines = [
			line('A1 - A2', ['h', 'a', 'b', 'c', 'd'], '2'),
			line('A1 - A3', ['h', 'a', 'b'], '2'),
			line('A1 - A5', ['h', 'c', 'd', 'e'], '2'),
		];

		expect(partOfSibling(lines, 1, [0, 1, 2])).toBe(0);
		expect(partOfSibling(lines, 2, [0, 1, 2])).toBeNull();
		expect(partOfSibling(lines, 0, [0, 1, 2])).toBeNull();
	});

	test('the header falls back to the shared code letter, then the group number', () => {
		const letter = groupLinesForPicker([line('K1 - K2', ['a', 'b'], '11'), line('K3-K4', ['c', 'd'], '11')]);
		const number = groupLinesForPicker([line('North', ['a', 'b'], '9'), line('South', ['c', 'd'], '9')]);

		expect(letter[0]).toMatchObject({kind: 'header', label: 'K'});
		expect(number[0]).toMatchObject({kind: 'header', label: 'Group 9'});
	});
});

describe('the picker on the real Israel map', () => {
	const {parsed} = israel();
	const lines = parsed.map(p => ({parsed: p, track: {totalLength: 50000}}));
	const picked: number[] = [];
	const rows = linePickerRows(lines, i => picked.push(i));
	const headers = rows.filter(r => r.section);
	const lineRows = rows.filter(r => !r.section);

	test('every line is still offered exactly once', () => {
		expect(lineRows).toHaveLength(26);
		lineRows.forEach(r => r.onSelect());
		expect([...picked].sort((a, b) => a - b)).toEqual(parsed.map((_, i) => i));
	});

	test('the A family sits under one A header, most stops first', () => {
		const at = rows.findIndex(r => r.section && r.title === 'A');

		expect(at).toBeGreaterThanOrEqual(0);
		expect(rows[at].subtitle).toBe('4 services');
		expect(rows.slice(at + 1, at + 5).map(r => r.badge)).toEqual(['A1-A2', 'A1-A3', 'A1-A5', 'A1-A4']);
		expect(rows.slice(at + 1, at + 5).every(r => r.inGroup)).toBe(true);
	});

	test('rows say express, how many are skipped, and what a short working is part of', () => {
		const row = (badge: string): string => lineRows.find(r => r.badge === badge)?.subtitle ?? '';

		expect(row('A1-A5')).toContain('16 stops · Express · skips 4');
		expect(row('A1-A3')).toContain('part of A1-A2');
		expect(row('A1-A2')).not.toMatch(/Express|skips|part of/);
	});

	test('groups of one get no header (J, M, I)', () => {
		expect(headers.map(h => h.title).sort()).toEqual(['A', 'B', 'C', 'E', 'G', 'H', 'K', 'P']);
	});

	test('the Tel Aviv sample has no groups and renders as a plain list', () => {
		const sample = parseMetroMap(TEL_AVIV_METRO).map(p => ({parsed: p, track: {totalLength: 8000}}));
		const plain = linePickerRows(sample, () => undefined);

		expect(plain).toHaveLength(3);
		expect(plain.some(r => r.section || r.inGroup)).toBe(false);
		expect(plain.every(r => !/Express|skips|part of/.test(r.subtitle ?? ''))).toBe(true);
	});
});

describe('along the track', () => {
	test('skippedBetween, both directions, in the order the train meets them', () => {
		const skipped = [150, 120, 400];

		expect(skippedBetween(100, 300, skipped)).toEqual([1, 0]);
		expect(skippedBetween(300, 100, skipped)).toEqual([0, 1]);
		expect(skippedBetween(300, 500, skipped)).toEqual([2]);
	});

	test('on a loop the leg across the seam is short, not the rest of the line', () => {
		// 1000 m loop, stops at 900 and 100, a skipped station at 950 and one at 500.
		expect(skippedBetween(900, 100, [950, 500], 1, 1000)).toEqual([0]);
		expect(skippedBetween(100, 900, [950, 500], -1, 1000)).toEqual([0]);
	});

	test('skipsPerLeg on the real A1-A5: all four skips sit on legs between stops', () => {
		const a5 = byCode(israel().parsed, 'A1 - A5');
		const d = dists(a5);
		const legs = skipsPerLeg(d.stops, d.skipped);

		expect(legs).toHaveLength(15);
		expect(legs.reduce((s, n) => s + n, 0)).toBe(4);
	});

	test('passingAhead names the next skipped station only before the next stop', () => {
		expect(passingAhead([500, 800], 100, 1, 1000, 900)).toBe(0);
		expect(passingAhead([500, 800], 600, 1, 1000, 900)).toBe(1);
		// Further than the next stop: not this leg's business.
		expect(passingAhead([500], 100, 1, 300, 900)).toBe(-1);
		// Out of range.
		expect(passingAhead([1500], 100, 1, 5000, 900)).toBe(-1);
		// Behind the train.
		expect(passingAhead([50], 100, 1, 1000, 900)).toBe(-1);
		expect(passingAhead([50], 100, -1, 1000, 900)).toBe(0);
		// Across a loop's seam.
		expect(passingAhead([20], 980, 1, 500, 900, 1000)).toBe(0);
	});

	test('boardName keeps the Latin name', () => {
		expect(boardName('Holon Junction צומת חולון HLJ')).toBe('Holon Junction');
		expect(boardName('Arlozorov')).toBe('Arlozorov');
		expect(boardName('צומת חולון')).toBe('צומת חולון');
	});
});

describe('the ribbon marks legs an express runs through', () => {
	test('one ring per leg that has a skip', () => {
		const view = buildRibbon(4, 0, [], [0, 2, 0]);

		expect(view.legSkips).toEqual([0, 2, 0]);
	});

	test('compressed, every skip is still counted exactly once', () => {
		const skips = new Array(39).fill(0);

		skips[3] = 1;
		skips[20] = 2;
		skips[38] = 1;

		const view = buildRibbon(40, 0, [], skips);

		expect(view.compressed).toBe(true);
		expect(view.legSkips).toHaveLength(view.dots - 1);
		expect(view.legSkips.reduce((s, n) => s + n, 0)).toBe(4);
	});

	test('no skips given: all zero', () => {
		expect(buildRibbon(5, 0, []).legSkips).toEqual([0, 0, 0, 0]);
	});
});

describe('the timetable and the passengers follow the stops (F4 + F5)', () => {
	const a5 = byCode(israel().parsed, 'A1 - A5');
	const d = dists(a5);

	test('no due time is scheduled at a station the service runs through', () => {
		const stops = buildTimetable(d.stops, 0, 1, -Infinity);

		expect(stops).toHaveLength(a5.stations.length);
		expect(stops.every(s => s.stationIndex < a5.stations.length)).toBe(true);
		// Every stop's distance is a stop's, never a skipped station's.
		const skippedAt = new Set(d.skipped);

		expect(stops.some(s => skippedAt.has(d.stops[s.stationIndex]))).toBe(false);
	});

	test('nobody spawns, waits or is left behind at a skipped station', () => {
		const model = new PassengerModel({random: (): number => 0.5});

		// PassengerSystem binds the model to exactly this list.
		model.setStations(a5.stations.map(s => ({id: s.id, density: s.density ?? 0.5})));
		model.preload(10);
		model.accumulate(600);

		const skippedIds = new Set(a5.skipped.map(s => s.id));
		const modelIds = a5.stations.map(s => s.id);

		expect(modelIds.some(id => skippedIds.has(id))).toBe(false);
		// Demand exists — at the stops.
		const waiting = modelIds.map((_, i) => model.getWaitingExact(i));

		expect(waiting.reduce((s, n) => s + n, 0)).toBeGreaterThan(0);
		// And every destination a rider can be given is a stop.
		for (let i = 0; i < 50; i++) {
			const dest = model.sampleDestination(0);

			expect(dest).toBeGreaterThanOrEqual(0);
			expect(dest).toBeLessThan(a5.stations.length);
		}
	});

	test('the all-stops A1-A2 still stops at Holon Junction', () => {
		const a2 = byCode(israel().parsed, 'A1 - A2');

		expect(a2.stations.some(s => boardName(s.name) === 'Holon Junction')).toBe(true);
		expect(a2.skipped).toHaveLength(0);
	});
});
