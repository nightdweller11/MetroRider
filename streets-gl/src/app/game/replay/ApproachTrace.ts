/**
 * How you drove the last three hundred metres, as a shape.
 *
 * "Good stop, 65" is a grade with no mark scheme. The child cannot tell
 * whether they braked late, braked hard, or crept the last thirty metres —
 * and those are three different lessons. A line of speed against distance
 * shows all three at a glance: late braking is a cliff near the mark, a
 * creep is a long flat tail, and a good stop is a smooth curve into the line.
 *
 * Pure projection: samples in, coordinates out. No DOM, so the shape of the
 * drawing can be tested without a browser — which matters because a graph that
 * silently plots nothing looks exactly like a graph of standing still.
 */

import {metresToGo, type RunSample} from './RunRecorder';

/** How much of the run-in is drawn, metres. */
export const TRACE_WINDOW_M = 300;

/**
 * A trace needs this many samples to be worth drawing.
 *
 * Two points is a straight line between wherever the recorder happened to
 * sample, which says nothing true about the braking and everything false about
 * how confident the game is.
 */
export const MIN_POINTS = 5;

export interface ApproachTrace {
	/** SVG path through the approach, `M x y L x y …`. */
	path: string;
	/** Where the train came to a stand, in the same coordinates. */
	stop: {x: number; y: number} | null;
	/** Where the marker's line goes. */
	markerX: number;
	/** The top of the speed axis, km/h — a round number above the fastest. */
	topKmh: number;
	/** The left-hand end of the distance axis, metres before the mark. */
	fromM: number;
	width: number;
	height: number;
}

/** Round up to something a person would put on an axis. */
function niceCeiling(kmh: number): number {
	for (const step of [20, 40, 60, 80, 100, 120, 160, 200, 240]) {
		if (kmh <= step) return step;
	}

	return Math.ceil(kmh / 40) * 40;
}

/**
 * Project an approach into a box `width` × `height`.
 *
 * Distance runs left (far out) to right (the mark); speed runs bottom (stopped)
 * to top. Returns null when there is not enough to say anything honest, and the
 * caller draws nothing rather than an empty pair of axes.
 */
export function buildApproachTrace(
	samples: RunSample[],
	markerDist: number,
	direction: number,
	width: number,
	height: number,
	windowM: number = TRACE_WINDOW_M,
): ApproachTrace | null {
	if (!Array.isArray(samples) || samples.length < MIN_POINTS) return null;
	if (!Number.isFinite(markerDist) || width <= 0 || height <= 0) return null;

	const points = samples
		.map(s => ({to: metresToGo(s, markerDist, direction), kmh: Math.abs(s.speed) * 3.6}))
		.filter(p => Number.isFinite(p.to) && Number.isFinite(p.kmh));

	if (points.length < MIN_POINTS) return null;

	const fromM = Math.max(windowM, Math.ceil(Math.max(...points.map(p => p.to)) / 50) * 50);
	const topKmh = niceCeiling(Math.max(10, ...points.map(p => p.kmh)));

	// Overshoot needs room on the right, or a stop past the mark is drawn
	// clamped ON the mark — which is precisely the mistake being shown.
	const pastM = Math.max(0, -Math.min(...points.map(p => p.to)));
	const tailM = Math.max(pastM, fromM * 0.06);
	const spanM = fromM + tailM;

	const x = (to: number): number => ((fromM - to) / spanM) * width;
	const y = (kmh: number): number => height - (kmh / topKmh) * height;

	const path = points
		.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.to).toFixed(1)} ${y(p.kmh).toFixed(1)}`)
		.join(' ');

	// Where it came to a stand: the first sample at walking pace or below,
	// which is the moment the stop actually happened rather than the last
	// sample the recorder took while the doors were open.
	const stopped = points.find(p => p.kmh < 1.5) ?? null;

	return {
		path,
		stop: stopped ? {x: x(stopped.to), y: y(stopped.kmh)} : null,
		markerX: x(0),
		topKmh,
		fromM,
		width,
		height,
	};
}
