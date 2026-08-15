import {
	emptyTrace, recordProgress, finishTrace, ghostSecondsAt, ghostDelta, ghostChip,
	describeGhostDelta, isFaster, isUsableTrace, packTrace, parseTrace, pruneTraces, deltaAtCommonDistance,
	traceKey, CHECKPOINT_M, DEAD_BAND_S, MAX_CHECKPOINTS, MAX_KEPT, type GhostTrace,
} from '../app/game/replay/GhostTrace';

/**
 * The ghost.
 *
 * The thing being tested is a claim the game makes to a child's face — "you
 * are four seconds up on your best" — so the interesting cases are the ones
 * where it would be a lie: comparing runs that went different distances,
 * reading a time from a stretch the ghost never drove, and keeping a record
 * set by a run that barely left the platform.
 */

/** A trace for a train holding a steady speed. */
function steady(speedMs: number, metres: number, key = 'k'): GhostTrace {
	let trace = emptyTrace(key);

	for (let m = 0; m <= metres; m += 10) {
		trace = recordProgress(trace, m, m / speedMs);
	}

	return finishTrace(trace, metres, metres / speedMs, 1000);
}

describe('recordProgress', () => {
	test('fills a checkpoint when one is crossed', () => {
		let t = emptyTrace('k');

		t = recordProgress(t, CHECKPOINT_M, 5);

		expect(t.times.length).toBe(2);
		expect(t.times[1]).toBeCloseTo(5);
	});

	test('returns the same object when nothing new was crossed', () => {
		const t = emptyTrace('k');

		expect(recordProgress(t, CHECKPOINT_M - 1, 4)).toBe(t);
	});

	test('fills every checkpoint a fast frame skipped over', () => {
		// The case that makes a table with holes: one long frame at speed.
		let t = emptyTrace('k');

		t = recordProgress(t, CHECKPOINT_M * 4, 8);

		expect(t.times.length).toBe(5);
		// Interpolated across the frame, so the intermediate ones are spread.
		expect(t.times[1]).toBeCloseTo(2);
		expect(t.times[2]).toBeCloseTo(4);
		expect(t.times[4]).toBeCloseTo(8);
	});

	test('never goes backwards in time', () => {
		let t = emptyTrace('k');

		t = recordProgress(t, 200, 20);
		const before = t.times.length;

		t = recordProgress(t, 400, 5);

		expect(t.times.length).toBe(before);
	});

	test('nonsense is ignored rather than stored', () => {
		const t = emptyTrace('k');

		expect(recordProgress(t, NaN, 5)).toBe(t);
		expect(recordProgress(t, 100, NaN)).toBe(t);
		expect(recordProgress(t, -100, 5)).toBe(t);
	});

	test('stops growing at the cap', () => {
		let t = emptyTrace('k');

		t = recordProgress(t, CHECKPOINT_M * (MAX_CHECKPOINTS + 500), 9000);

		expect(t.times.length).toBe(MAX_CHECKPOINTS + 1);
	});

	test('times only ever rise', () => {
		const t = steady(20, 2000);

		for (let i = 1; i < t.times.length; i++) {
			expect(t.times[i]).toBeGreaterThanOrEqual(t.times[i - 1]);
		}
	});
});

describe('ghostSecondsAt', () => {
	const t = steady(20, 1000); // 50 s over a kilometre

	test('reads a time at a checkpoint', () => {
		expect(ghostSecondsAt(t, 500)).toBeCloseTo(25, 1);
	});

	test('interpolates between checkpoints', () => {
		expect(ghostSecondsAt(t, 525)).toBeCloseTo(26.25, 1);
	});

	test('says nothing about ground the ghost never covered', () => {
		expect(ghostSecondsAt(t, 5000)).toBeNull();
	});

	test('a run too short to race against reads as nothing at all', () => {
		let short = emptyTrace('k');

		short = recordProgress(short, 60, 3);

		expect(isUsableTrace(short)).toBe(false);
		expect(ghostSecondsAt(short, 50)).toBeNull();
	});

	test('covers the tail past the final checkpoint', () => {
		// A run does not end on a round fifty metres, and the last stretch is
		// exactly where a stop is scored — losing it would blank the chip in
		// the one place it matters most.
		const tail = finishTrace(steady(20, 1000), 1030, 51.5, 1000);

		expect(ghostSecondsAt(tail, 1015)).toBeCloseTo(50.75, 1);
	});
});

describe('ghostDelta', () => {
	const best = steady(20, 1000);

	test('ahead is positive', () => {
		// 500 m reached in 20 s where the ghost took 25.
		expect(ghostDelta(best, 500, 20)).toBeCloseTo(5, 1);
	});

	test('behind is negative', () => {
		expect(ghostDelta(best, 500, 30)).toBeCloseTo(-5, 1);
	});

	test('no ghost, no number', () => {
		expect(ghostDelta(null, 500, 20)).toBeNull();
	});
});

describe('deltaAtCommonDistance', () => {
	const best = steady(20, 1000);   // 50 s over a kilometre

	test('a run that goes FURTHER than the record still gets a number', () => {
		// The bug this exists for: two runs never end on the same metre, so
		// asking the record about ground it never covered returned nothing and
		// the card drew an empty row where a sentence should have been.
		const mine = finishTrace(steady(25, 1200), 1200, 48, 1);

		const delta = deltaAtCommonDistance(mine, best, 1200, 48);

		expect(delta).not.toBeNull();
		// Compared at 1000 m, where the record took 50 s and this run took 40.
		expect(delta!).toBeCloseTo(10, 0);
	});

	test('a run cut short is compared over the ground it did cover', () => {
		const mine = finishTrace(steady(25, 500), 500, 20, 1);

		expect(deltaAtCommonDistance(mine, best, 500, 20)).toBeCloseTo(5, 0);
	});

	test('mid-run, past our own last checkpoint, still reads', () => {
		// A live chip asks this every frame, and the answer must not blink out
		// between one checkpoint and the next.
		let mine = emptyTrace('k');

		for (let m = 0; m <= 620; m += 10) mine = recordProgress(mine, m, m / 25);

		// 637 m is past the last 50 m checkpoint at 600.
		expect(deltaAtCommonDistance(mine, best, 637, 25.5)).not.toBeNull();
	});

	test('no record, no number', () => {
		expect(deltaAtCommonDistance(steady(20, 500), null, 500, 25)).toBeNull();
	});

	test('nonsense in, nothing out', () => {
		expect(deltaAtCommonDistance(steady(20, 500), best, NaN, 25)).toBeNull();
		expect(deltaAtCommonDistance(steady(20, 500), best, 500, NaN)).toBeNull();
	});
});

describe('ghostChip', () => {
	test('a hair either way reads as level', () => {
		expect(ghostChip(DEAD_BAND_S / 2)?.state).toBe('level');
		expect(ghostChip(-DEAD_BAND_S / 2)?.state).toBe('level');
	});

	test('ahead and behind are named, not signed', () => {
		expect(ghostChip(4)).toEqual({text: '4.0s up', state: 'ahead'});
		expect(ghostChip(-4)).toEqual({text: '4.0s down', state: 'behind'});
	});

	test('a big gap is said in minutes', () => {
		expect(ghostChip(95)?.text).toBe('1:35 up');
	});

	test('no delta, no chip', () => {
		expect(ghostChip(null)).toBeNull();
		expect(ghostChip(NaN)).toBeNull();
	});
});

describe('describeGhostDelta', () => {
	test('says which way round it went', () => {
		expect(describeGhostDelta(12)).toBe('12s faster than your best');
		expect(describeGhostDelta(-12)).toBe('12s slower than your best');
		expect(describeGhostDelta(0.1)).toBe('Level with your best run');
	});

	test('nothing to compare against says nothing', () => {
		expect(describeGhostDelta(null)).toBe('');
	});
});

describe('isFaster', () => {
	test('the first run always sets the record', () => {
		expect(isFaster(steady(20, 1000), null)).toBe(true);
	});

	test('a quicker run over the same ground wins', () => {
		expect(isFaster(steady(25, 1000), steady(20, 1000))).toBe(true);
		expect(isFaster(steady(15, 1000), steady(20, 1000))).toBe(false);
	});

	test('a longer run is not slower for being longer', () => {
		// The trap: total time says the 2 km run lost. It was quicker over
		// every metre they shared.
		const best = steady(20, 1000);
		const longer = steady(25, 2000);

		expect(longer.totalSeconds).toBeGreaterThan(best.totalSeconds);
		expect(isFaster(longer, best)).toBe(true);
	});

	test('giving up early does not set a record', () => {
		expect(isFaster(steady(40, 200), steady(20, 1000))).toBe(false);
	});

	test('a run that never went anywhere is never the best', () => {
		let stub = emptyTrace('k');

		stub = recordProgress(stub, 60, 2);

		expect(isFaster(finishTrace(stub, 60, 2, 1), null)).toBe(false);
	});
});

describe('storage', () => {
	test('a packed trace survives the round trip', () => {
		const t = steady(20, 500);
		const back = parseTrace(JSON.parse(JSON.stringify(packTrace(t))));

		expect(back).not.toBeNull();
		expect(back!.times.length).toBe(t.times.length);
		expect(ghostSecondsAt(back, 250)).toBeCloseTo(12.5, 1);
	});

	test('packing rounds to a tenth', () => {
		let t = emptyTrace('k');

		t = recordProgress(t, CHECKPOINT_M, 1.23456);

		expect(packTrace(t).times[1]).toBe(1.2);
	});

	test('junk out of storage is refused, not half-read', () => {
		expect(parseTrace(null)).toBeNull();
		expect(parseTrace('a string')).toBeNull();
		expect(parseTrace({key: 'k'})).toBeNull();
		expect(parseTrace({key: 'k', times: [0, 'x']})).toBeNull();
		expect(parseTrace({key: 5, times: [0, 1]})).toBeNull();
	});

	test('a trace written before totals existed still reads', () => {
		const back = parseTrace({key: 'k', times: [0, 1, 2, 3, 4, 5, 6]});

		expect(back).not.toBeNull();
		expect(back!.totalSeconds).toBe(0);
		expect(back!.step).toBe(CHECKPOINT_M);
	});

	test('the oldest records are the ones forgotten', () => {
		const traces: Record<string, GhostTrace> = {};

		for (let i = 0; i < MAX_KEPT + 10; i++) {
			traces[`k${i}`] = {...steady(20, 400, `k${i}`), savedAt: i};
		}

		const kept = pruneTraces(traces);

		expect(Object.keys(kept).length).toBe(MAX_KEPT);
		expect(kept['k0']).toBeUndefined();
		expect(kept[`k${MAX_KEPT + 9}`]).toBeDefined();
	});

	test('nothing is dropped while there is room', () => {
		const traces = {a: steady(20, 400, 'a')};

		expect(pruneTraces(traces)).toBe(traces);
	});
});

describe('traceKey', () => {
	test('two directions from the same station are different races', () => {
		expect(traceKey('m', 'l', 0, 1)).not.toBe(traceKey('m', 'l', 0, -1));
	});

	test('two starting points on the same line are different races', () => {
		expect(traceKey('m', 'l', 0, 1)).not.toBe(traceKey('m', 'l', 3, 1));
	});

	test('the same journey is the same race', () => {
		expect(traceKey('m', 'l', 2, 1)).toBe(traceKey('m', 'l', 2, 1));
	});
});
