/**
 * Speed limits along a line, derived from the track itself.
 *
 * Real limits come from curve radius: a train can hold about
 * `v = sqrt(a · r)` through a curve of radius r before the lateral
 * acceleration is more than passengers accept. With a comfort figure of
 * ~0.9 m/s² (a normal metro value) a 200 m curve is ~48 km/h and a 1 km curve
 * is ~108 km/h, which is why suburban track feels fast and city track does not.
 *
 * The whole thing is pure: it takes the spline points a line was built from and
 * produces segments, so it can be unit-tested without an engine and reused by
 * the HUD, the score and (later) the track-side boards.
 */

export interface SpeedSegment {
	/** Distance along the track where this limit starts, meters. */
	startDist: number;
	/** Distance where it ends (exclusive), meters. */
	endDist: number;
	/** Limit in m/s. */
	limit: number;
}

export interface SpeedProfileOptions {
	/** Lateral acceleration passengers tolerate, m/s². */
	comfort?: number;
	/** Nothing on the line may exceed this (rolling stock / mode cap), m/s. */
	lineMax?: number;
	/** Limits are rounded to this step (m/s) so the HUD shows tidy numbers. */
	step?: number;
	/** Segments shorter than this are merged into their neighbours, meters. */
	minSegment?: number;
	/** Slowest limit the profile will ever produce, m/s. */
	floor?: number;
	/** Comfortable service braking used to back-propagate limits, m/s². */
	braking?: number;
}

const DEFAULTS = {
	comfort: 0.9,
	lineMax: 55,
	step: 5 / 3.6,   // 5 km/h
	minSegment: 120,
	floor: 25 / 3.6, // 25 km/h
	braking: 1.0,
};

export interface Point {
	x: number;
	y: number;
}

/**
 * Radius of the circle through three points. Returns Infinity for a straight
 * line (or coincident points), which reads naturally as "no curve, no limit".
 */
export function curveRadius(a: Point, b: Point, c: Point): number {
	const abx = b.x - a.x, aby = b.y - a.y;
	const bcx = c.x - b.x, bcy = c.y - b.y;

	const cross = abx * bcy - aby * bcx;
	if (Math.abs(cross) < 1e-9) return Infinity;

	const ab = Math.hypot(abx, aby);
	const bc = Math.hypot(bcx, bcy);
	const ca = Math.hypot(c.x - a.x, c.y - a.y);
	if (ab < 1e-6 || bc < 1e-6 || ca < 1e-6) return Infinity;

	return (ab * bc * ca) / (2 * Math.abs(cross));
}

/** The comfortable speed through a curve of `radius` metres. */
export function limitForRadius(radius: number, options: SpeedProfileOptions = {}): number {
	const o = {...DEFAULTS, ...options};
	if (!Number.isFinite(radius)) return o.lineMax;

	const raw = Math.sqrt(Math.max(0, o.comfort) * Math.max(1, radius));
	const stepped = Math.round(raw / o.step) * o.step;
	return Math.max(o.floor, Math.min(o.lineMax, stepped));
}

/**
 * Build the limit segments for a line.
 *
 * `points` are the track spline points and `cumDist[i]` the distance along the
 * track at each one — exactly what `buildTrackData` already produces.
 */
export function buildSpeedProfile(
	points: Point[],
	cumDist: number[],
	isLoop: boolean,
	options: SpeedProfileOptions = {},
): SpeedSegment[] {
	const o = {...DEFAULTS, ...options};
	const n = Math.min(points.length, cumDist.length);
	if (n < 3) {
		return [{startDist: 0, endDist: cumDist[n - 1] ?? 0, limit: o.lineMax}];
	}

	// A per-point limit first: the curve through this point and its neighbours.
	const perPoint: number[] = new Array(n);
	for (let i = 0; i < n; i++) {
		const prev = i === 0 ? (isLoop ? n - 2 : 0) : i - 1;
		const next = i === n - 1 ? (isLoop ? 1 : n - 1) : i + 1;
		if (prev === i || next === i) {
			perPoint[i] = o.lineMax;
			continue;
		}
		perPoint[i] = limitForRadius(curveRadius(points[prev], points[i], points[next]), o);
	}

	// A limit has to appear far enough ahead that the train can actually reach
	// it: braking from 50 m/s to 11 m/s at 1 m/s² takes about a kilometre, so a
	// fixed look-ahead window (or a few spline points) is the wrong unit
	// entirely. Instead the profile is back-propagated the way a real one is —
	// walking backwards, no point may allow more than
	//   v(i) = sqrt(v(i+1)² + 2·a·ds)
	// so the limit falls gradually on the approach and is in force by the time
	// the curve starts.
	//
	// The rounding to sign-friendly steps happens INSIDE that walk, downward.
	// Doing it afterwards breaks the very guarantee the walk establishes:
	// flooring the slower value increases the gap, and the segment before it is
	// then too short to brake in. Flooring inside keeps every value on the grid
	// and never raises one, so the invariant survives.
	const toGrid = (v: number): number => Math.max(o.floor, Math.floor(v / o.step + 1e-9) * o.step);

	const smoothed = perPoint.map(toGrid);
	const passes = isLoop ? 3 : 2;
	for (let pass = 0; pass < passes; pass++) {
		for (let i = n - 2; i >= 0; i--) {
			const ds = Math.max(1e-3, cumDist[i + 1] - cumDist[i]);
			const reachable = toGrid(Math.sqrt(smoothed[i + 1] * smoothed[i + 1] + 2 * o.braking * ds));
			smoothed[i] = Math.min(smoothed[i], reachable);
		}
		if (isLoop && n > 1) {
			const ds = Math.max(1e-3, cumDist[n - 1] - cumDist[n - 2]);
			const reachable = toGrid(Math.sqrt(smoothed[0] * smoothed[0] + 2 * o.braking * ds));
			smoothed[n - 1] = Math.min(smoothed[n - 1], reachable);
		}
	}

	// Runs of equal limit become segments.
	const segments: SpeedSegment[] = [];
	let startIdx = 0;
	for (let i = 1; i <= n; i++) {
		const ended = i === n || Math.abs(smoothed[i] - smoothed[startIdx]) > 1e-6;
		if (!ended) continue;
		segments.push({
			startDist: cumDist[startIdx],
			endDist: cumDist[Math.min(i, n - 1)],
			limit: smoothed[startIdx],
		});
		startIdx = i;
	}

	return mergeShortSegments(segments, o.minSegment);
}

/**
 * Drop segments too short to be worth a sign. A short FAST stretch between two
 * slow ones is swallowed by the slower limit (you would never get up to speed);
 * a short SLOW stretch survives by extending into its neighbours, because that
 * is a real constraint, not noise.
 */
export function mergeShortSegments(segments: SpeedSegment[], minLength: number): SpeedSegment[] {
	if (segments.length <= 1) return segments;

	const out: SpeedSegment[] = [];
	for (const segment of segments) {
		const length = segment.endDist - segment.startDist;
		const previous = out[out.length - 1];

		if (previous && Math.abs(previous.limit - segment.limit) < 1e-6) {
			previous.endDist = segment.endDist;
			continue;
		}

		if (length < minLength && previous) {
			if (segment.limit >= previous.limit) {
				// Too short to speed up in — stay slow.
				previous.endDist = segment.endDist;
				continue;
			}
			// A brief slow point: keep it, but let it own the space it needs.
			out.push({...segment});
			continue;
		}

		out.push({...segment});
	}

	return out;
}

/** The limit in force at `dist`. */
export function limitAt(segments: SpeedSegment[], dist: number, fallback: number): number {
	for (const segment of segments) {
		if (dist >= segment.startDist && dist < segment.endDist) return segment.limit;
	}
	return segments.length > 0 ? segments[segments.length - 1].limit : fallback;
}

export interface NextChange {
	/** Meters until the limit changes; Infinity when it never does. */
	distance: number;
	/** The limit that takes effect there. */
	limit: number;
}

/**
 * The next change AHEAD of the train, in its direction of travel. This is what
 * the HUD counts down to, so it only reports changes that matter: a slower
 * limit you must brake for, or a faster one you may accelerate into.
 */
export function nextChange(
	segments: SpeedSegment[],
	dist: number,
	direction: number,
	totalLength: number,
	isLoop: boolean,
): NextChange | null {
	if (segments.length === 0) return null;

	const forward = direction >= 0;
	const current = limitAt(segments, dist, segments[0].limit);

	// Walk boundaries in travel order; wrap once on a loop.
	const boundaries = forward
		? segments.map(s => ({at: s.startDist, limit: s.limit}))
		: segments.map(s => ({at: s.endDist, limit: s.limit})).reverse();

	for (const boundary of boundaries) {
		const raw = forward ? boundary.at - dist : dist - boundary.at;
		const ahead = isLoop ? ((raw % totalLength) + totalLength) % totalLength : raw;
		if (ahead <= 0.5 || !Number.isFinite(ahead)) continue;
		if (Math.abs(boundary.limit - current) < 1e-6) continue;
		return {distance: ahead, limit: boundary.limit};
	}

	return null;
}

export type SpeedState = 'ok' | 'approaching' | 'over';

/** How far over the limit before the game says something, as a fraction. */
export const OVERSPEED_TOLERANCE = 0.05;
/** Within this fraction of the limit, the HUD warns you are close. */
export const APPROACHING_FRACTION = 0.9;
/** Past this, the train applies its own brakes. */
export const PENALTY_BRAKE_OVER = 0.25;

export function speedState(speed: number, limit: number): SpeedState {
	if (speed > limit * (1 + OVERSPEED_TOLERANCE)) return 'over';
	if (speed >= limit * APPROACHING_FRACTION) return 'approaching';
	return 'ok';
}

/** km/h, rounded to something a sign would show. */
export function toSignKmh(limitMs: number): number {
	return Math.max(5, Math.round((limitMs * 3.6) / 5) * 5);
}
