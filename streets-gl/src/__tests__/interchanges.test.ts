import {
	linesServing, describeInterchange, speakInterchange, MAX_NAMED,
	buildInterchangeIndex, connectionsAt,
	type InterchangeLine,
} from '../app/game/data/Interchanges';

/**
 * Interchanges.
 *
 * The trap worth testing for is matching stations by NAME. Every real network
 * has more than one station called some variant of "Central", and a name match
 * would cheerfully tell a child to change at a station forty miles away.
 */

function line(id: string, name: string, stationIds: string[]): InterchangeLine {
	return {id, name, stations: stationIds.map(s => ({id: s}))};
}

const NETWORK: InterchangeLine[] = [
	line('1', 'A1 - A2 Sharon Local', ['tsc', 'ths', 'thg']),
	line('2', 'B1 - B2 Beach Local', ['tsc', 'beach', 'south']),
	line('3', 'C6 - C5 Part Route', ['tsc', 'ths', 'lod']),
	line('4', 'D1 - D2 Express', ['far', 'away']),
];

describe('linesServing', () => {
	test('finds the other lines calling at a shared station', () => {
		const others = linesServing(NETWORK, 'tsc', '1');

		expect(others.map(l => l.id)).toEqual(['2', '3']);
	});

	test('never includes the line you are already on', () => {
		expect(linesServing(NETWORK, 'tsc', '2').map(l => l.id)).toEqual(['1', '3']);
	});

	test('a station only one line serves is not an interchange', () => {
		expect(linesServing(NETWORK, 'thg', '1')).toEqual([]);
	});

	test('a station nobody serves gives nothing', () => {
		expect(linesServing(NETWORK, 'nowhere', '1')).toEqual([]);
	});

	test('matches on ID, never on name', () => {
		// Two DIFFERENT stations that happen to share a name. Matching on the
		// name would send a child to change forty miles away.
		const twoCentrals: InterchangeLine[] = [
			{id: '1', name: 'A1 - A2', stations: [{id: 'north-central'}]},
			{id: '2', name: 'B1 - B2', stations: [{id: 'south-central'}]},
		];

		expect(linesServing(twoCentrals, 'north-central', '1')).toEqual([]);
	});

	test('junk in, nothing out', () => {
		expect(linesServing(NETWORK, '', '1')).toEqual([]);
		expect(linesServing(null as never, 'tsc', '1')).toEqual([]);
		expect(linesServing([null as never, ...NETWORK], 'tsc', '1').length).toBe(2);
	});

	test('a line with no stations is skipped, not thrown over', () => {
		const broken = [...NETWORK, {id: '9', name: 'X', stations: undefined as never}];

		expect(linesServing(broken, 'tsc', '1').map(l => l.id)).toEqual(['2', '3']);
	});
});

describe('buildInterchangeIndex', () => {
	test('keeps only the stations more than one line calls at', () => {
		const index = buildInterchangeIndex(NETWORK);

		expect([...index.keys()].sort()).toEqual(['ths', 'tsc']);
	});

	test('the same answer as scanning, without the scan', () => {
		const index = buildInterchangeIndex(NETWORK);

		expect(connectionsAt(index, 'tsc', '1').map(l => l.id))
			.toEqual(linesServing(NETWORK, 'tsc', '1').map(l => l.id));
	});

	test('a line calling twice at one station is still one line', () => {
		// A loop closes back on its first station, and a branch can double
		// back. Counting the visits instead of the lines would call a single
		// line an interchange with itself.
		const loop = [line('1', 'A1 - A2', ['a', 'b', 'c', 'a'])];

		expect(buildInterchangeIndex(loop).size).toBe(0);
	});

	test('a station on nothing, and junk, give an empty index', () => {
		expect(buildInterchangeIndex([]).size).toBe(0);
		expect(buildInterchangeIndex(null as never).size).toBe(0);
		expect(connectionsAt(null, 'tsc', '1')).toEqual([]);
		expect(connectionsAt(buildInterchangeIndex(NETWORK), '', '1')).toEqual([]);
	});

	test('a station nobody shares is absent, not an empty list', () => {
		expect(connectionsAt(buildInterchangeIndex(NETWORK), 'thg', '1')).toEqual([]);
	});
});

describe('describeInterchange', () => {
	test('names the lines by their codes', () => {
		expect(describeInterchange(linesServing(NETWORK, 'tsc', '1')))
			.toBe('CHANGE FOR B1-B2, C6-C5');
	});

	test('nothing to change to says nothing at all', () => {
		expect(describeInterchange([])).toBe('');
		expect(describeInterchange(null as never)).toBe('');
	});

	test('a big junction says how many more rather than listing them', () => {
		const many = Array.from({length: 8}, (_, i) => line(`x${i}`, `L${i} - M${i}`, ['tsc']));
		const text = describeInterchange(many);

		expect(text).toContain(`+${8 - MAX_NAMED}`);
		expect(text.split(',').length).toBeLessThanOrEqual(MAX_NAMED);
	});

	test('falls back to the id when a line has no code in its name', () => {
		expect(describeInterchange([line('77', 'The Riverside Shuttle', ['tsc'])]))
			.toContain('77');
	});
});

describe('speakInterchange', () => {
	test('one line reads as one line', () => {
		expect(speakInterchange([line('2', 'B1 - B2 Beach', ['tsc'])]))
			.toBe('Change here for the B1-B2 line.');
	});

	test('two are joined with "and", not a comma', () => {
		expect(speakInterchange(linesServing(NETWORK, 'tsc', '1')))
			.toBe('Change here for the B1-B2 and C6-C5 lines.');
	});

	test('a big junction does not read out eleven codes', () => {
		const many = Array.from({length: 8}, (_, i) => line(`x${i}`, `L${i} - M${i}`, ['tsc']));

		expect(speakInterchange(many)).toContain('and others');
	});

	test('nothing to say, nothing said', () => {
		expect(speakInterchange([])).toBe('');
	});
});
