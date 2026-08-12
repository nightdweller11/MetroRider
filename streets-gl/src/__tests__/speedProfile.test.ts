import {
	buildSpeedProfile, curveRadius, limitAt, limitForRadius, mergeShortSegments,
	nextChange, speedState, toSignKmh, Point, SpeedSegment,
} from '~/app/game/limits/SpeedProfile';

/** A straight line of `count` points, `spacing` metres apart. */
function straight(count: number, spacing = 50): {points: Point[]; cumDist: number[]} {
	const points: Point[] = [];
	const cumDist: number[] = [];
	for (let i = 0; i < count; i++) {
		points.push({x: i * spacing, y: 0});
		cumDist.push(i * spacing);
	}
	return {points, cumDist};
}

/** An arc of `radius` metres sampled every `spacing` metres. */
function arc(radius: number, count: number, spacing = 20, startDist = 0): {points: Point[]; cumDist: number[]} {
	const points: Point[] = [];
	const cumDist: number[] = [];
	for (let i = 0; i < count; i++) {
		const theta = (i * spacing) / radius;
		points.push({x: radius * Math.sin(theta), y: radius * (1 - Math.cos(theta))});
		cumDist.push(startDist + i * spacing);
	}
	return {points, cumDist};
}

describe('curveRadius', () => {
	it('is infinite on a straight line', () => {
		expect(curveRadius({x: 0, y: 0}, {x: 1, y: 0}, {x: 2, y: 0})).toBe(Infinity);
	});

	it('recovers the radius of a known circle', () => {
		const r = 300;
		const p = (deg: number): Point => ({x: r * Math.cos(deg * Math.PI / 180), y: r * Math.sin(deg * Math.PI / 180)});

		expect(curveRadius(p(0), p(5), p(10))).toBeCloseTo(r, 1);
	});

	it('does not blow up on coincident points', () => {
		expect(curveRadius({x: 1, y: 1}, {x: 1, y: 1}, {x: 1, y: 1})).toBe(Infinity);
	});
});

describe('limitForRadius', () => {
	it('gives a tight curve a slow limit and a gentle one a fast limit', () => {
		const tight = limitForRadius(150);
		const gentle = limitForRadius(1200);

		expect(tight).toBeLessThan(gentle);
		expect(tight * 3.6).toBeGreaterThan(40);
		expect(gentle * 3.6).toBeGreaterThan(120);
	});

	/**
	 * Sanity against the real world, which is what these numbers exist for.
	 * Typical mainline practice with cant + a little cant deficiency:
	 * 300 m ≈ 80 km/h, 600 m ≈ 110 km/h, 1000 m ≈ 145 km/h. A tolerance of
	 * ±20% keeps the test about the physics, not about one railway's tables.
	 */
	it('matches real railway curve speeds within 20%', () => {
		const cases: [number, number][] = [[300, 80], [600, 110], [1000, 145]];

		for (const [radius, expectedKmh] of cases) {
			const kmh = limitForRadius(radius, {lineMax: 200 / 3.6}) * 3.6;
			expect(kmh).toBeGreaterThan(expectedKmh * 0.8);
			expect(kmh).toBeLessThan(expectedKmh * 1.2);
		}
	});

	it('does not post a crawl on gentle track', () => {
		// A 45 km/h limit on 500 m radius track (what the first version did)
		// is wrong by a factor of two.
		expect(limitForRadius(500, {lineMax: 200 / 3.6}) * 3.6).toBeGreaterThan(85);
	});

	it('never exceeds the line maximum', () => {
		expect(limitForRadius(Infinity, {lineMax: 30})).toBe(30);
		expect(limitForRadius(100000, {lineMax: 30})).toBe(30);
	});

	it('never drops below the floor, however tight the curve', () => {
		expect(limitForRadius(1, {floor: 5})).toBeGreaterThanOrEqual(5);
		expect(limitForRadius(0, {floor: 5})).toBeGreaterThanOrEqual(5);
	});

	it('rounds to tidy numbers a sign could show', () => {
		expect(toSignKmh(limitForRadius(400)) % 5).toBe(0);
	});
});

describe('buildSpeedProfile', () => {
	it('gives a straight line one segment at the line maximum', () => {
		const {points, cumDist} = straight(12);
		const segments = buildSpeedProfile(points, cumDist, false, {lineMax: 50});

		expect(segments).toHaveLength(1);
		expect(segments[0].limit).toBe(50);
	});

	it('slows the profile down where the track bends', () => {
		const s = straight(10, 60);
		const a = arc(180, 12, 20, s.cumDist[9]);
		const points = [...s.points, ...a.points];
		const cumDist = [...s.cumDist, ...a.cumDist];

		const segments = buildSpeedProfile(points, cumDist, false, {lineMax: 50, minSegment: 20});
		const straightLimit = limitAt(segments, 100, 50);
		const curveLimit = limitAt(segments, s.cumDist[9] + 100, 50);

		expect(curveLimit).toBeLessThan(straightLimit);
	});

	it('ramps the limit DOWN on the approach so the curve is reachable', () => {
		const s = straight(8, 40);
		const a = arc(150, 10, 20, s.cumDist[7]);
		const segments = buildSpeedProfile(
			[...s.points, ...a.points], [...s.cumDist, ...a.cumDist], false, {lineMax: 50, minSegment: 10},
		);

		const atCurve = limitAt(segments, s.cumDist[7] + 40, 50);
		const near = limitAt(segments, s.cumDist[7] - 60, 50);
		const far = limitAt(segments, s.cumDist[7] - 200, 50);

		// Already below the line maximum well before the bend, and falling.
		expect(far).toBeLessThan(50);
		expect(near).toBeLessThan(far);
		expect(atCurve).toBeLessThan(near);
	});

	it('never asks for more braking than the profile allows', () => {
		const s = straight(6, 50);
		const a = arc(140, 14, 20, s.cumDist[5]);
		const cumDist = [...s.cumDist, ...a.cumDist];
		const braking = 1.0;
		const segments = buildSpeedProfile([...s.points, ...a.points], cumDist, false, {lineMax: 50, braking, minSegment: 10});

		// The promise of the back-propagation: wherever the limit drops, the
		// segment BEFORE the drop is long enough to brake into it. (The check
		// is per segment, not per metre — limits are rounded to 5 km/h steps,
		// so a single step lands as an instant drop at a boundary and only the
		// run-up to it can absorb it.)
		for (let i = 1; i < segments.length; i++) {
			const before = segments[i - 1];
			const drop = segments[i];
			if (drop.limit >= before.limit) continue;

			const runUp = before.endDist - before.startDist;
			const needed = (before.limit * before.limit - drop.limit * drop.limit) / (2 * braking);
			expect(needed).toBeLessThanOrEqual(runUp + 1e-6);
		}
		expect(segments.length).toBeGreaterThan(1); // the fixture really does slow down
	});

	it('covers the whole line without gaps', () => {
		const s = straight(6, 100);
		const a = arc(200, 8, 25, s.cumDist[5]);
		const cumDist = [...s.cumDist, ...a.cumDist];
		const segments = buildSpeedProfile([...s.points, ...a.points], cumDist, false);

		for (let i = 1; i < segments.length; i++) {
			expect(segments[i].startDist).toBeCloseTo(segments[i - 1].endDist, 5);
		}
	});

	it('handles a degenerate two-point line instead of throwing', () => {
		const segments = buildSpeedProfile([{x: 0, y: 0}, {x: 10, y: 0}], [0, 10], false);

		expect(segments).toHaveLength(1);
		expect(segments[0].limit).toBeGreaterThan(0);
	});
});

describe('mergeShortSegments', () => {
	const seg = (startDist: number, endDist: number, limit: number): SpeedSegment => ({startDist, endDist, limit});

	it('swallows a short fast stretch between two slow ones', () => {
		const merged = mergeShortSegments([seg(0, 500, 10), seg(500, 540, 30), seg(540, 1000, 10)], 120);

		expect(merged).toHaveLength(1);
		expect(merged[0].limit).toBe(10);
		expect(merged[0].endDist).toBe(1000);
	});

	it('keeps a short SLOW stretch — that is a real constraint', () => {
		const merged = mergeShortSegments([seg(0, 500, 30), seg(500, 560, 10), seg(560, 1000, 30)], 120);

		expect(merged.some(s => s.limit === 10)).toBe(true);
	});

	it('joins neighbours that share a limit', () => {
		const merged = mergeShortSegments([seg(0, 300, 20), seg(300, 900, 20)], 120);

		expect(merged).toHaveLength(1);
		expect(merged[0].endDist).toBe(900);
	});
});

describe('nextChange', () => {
	const segments: SpeedSegment[] = [
		{startDist: 0, endDist: 500, limit: 30},
		{startDist: 500, endDist: 900, limit: 12},
		{startDist: 900, endDist: 1500, limit: 30},
	];

	it('counts down to the next slower limit ahead', () => {
		const change = nextChange(segments, 300, 1, 1500, false);

		expect(change).not.toBeNull();
		expect(change!.distance).toBeCloseTo(200, 5);
		expect(change!.limit).toBe(12);
	});

	it('looks the other way when the train reverses', () => {
		const change = nextChange(segments, 1000, -1, 1500, false);

		expect(change!.limit).toBe(12);
		expect(change!.distance).toBeCloseTo(100, 5);
	});

	it('reports nothing once past the last change on a straight line', () => {
		expect(nextChange(segments, 1400, 1, 1500, false)).toBeNull();
	});

	it('wraps around on a loop instead of running out of line', () => {
		const change = nextChange(segments, 1400, 1, 1500, true);

		expect(change).not.toBeNull();
		expect(change!.limit).toBe(12);
	});

	it('ignores a boundary between two identical limits', () => {
		const same: SpeedSegment[] = [
			{startDist: 0, endDist: 400, limit: 20},
			{startDist: 400, endDist: 800, limit: 20},
			{startDist: 800, endDist: 1200, limit: 8},
		];

		expect(nextChange(same, 100, 1, 1200, false)!.limit).toBe(8);
	});
});

describe('speedState', () => {
	it('is fine at and just under the limit', () => {
		expect(speedState(10, 20)).toBe('ok');
		expect(speedState(18, 20)).toBe('approaching');
		expect(speedState(20, 20)).toBe('approaching');
	});

	it('does not cry over a rounding-error overspeed', () => {
		expect(speedState(20.5, 20)).toBe('approaching');
	});

	it('calls a real overspeed', () => {
		expect(speedState(24, 20)).toBe('over');
	});
});
