/**
 * The little map in the corner — what is actually around the train.
 *
 * It used to draw a hard-coded diagonal with five evenly spaced dots on it,
 * because the route geometry it was written to render was never passed in. It
 * looked like a route and was the same picture on every line, in every city, at
 * every moment of a run.
 *
 * This builds the real thing: a window of ground centred on the train, with
 * every line that crosses it drawn in its own colour. North is up and the
 * window does not rotate — a map that spins under you is harder to read than
 * one that stays put, and the train carries its own heading marker.
 *
 * Pure: world metres in, `viewBox="0 0 100 100"` path data out. No DOM.
 */

export interface MiniMapPoint {
	x: number;
	y: number;
}

export interface MiniMapLineInput {
	/** The line's geometry in projected metres, in order along the line. */
	points: MiniMapPoint[];
	color: string;
	/** The line being driven — drawn last, brighter and thicker. */
	isCurrent: boolean;
}

export interface MiniMapPath {
	/** SVG path data in the 0–100 viewBox. */
	d: string;
	color: string;
	current: boolean;
}

export interface MiniMapView {
	paths: MiniMapPath[];
	/** Station positions inside the window, in viewBox coordinates. */
	stations: MiniMapPoint[];
	/** How wide the window is on the ground, metres — for the caption. */
	spanM: number;
}

/**
 * How far outside the window a point may be and still be worth drawing.
 *
 * A segment with both ends off-screen can still cross the middle of the view,
 * so dropping points strictly outside 0–100 puts holes in every line that runs
 * straight through. The margin is in viewBox units.
 */
const KEEP_MARGIN = 60;

/** Round hard: this string is rebuilt several times a second. */
function fmt(v: number): string {
	return (Math.round(v * 10) / 10).toString();
}

function project(p: MiniMapPoint, centre: MiniMapPoint, spanM: number): MiniMapPoint {
	const half = spanM / 2;

	return {
		x: 50 + ((p.x - centre.x) / half) * 50,
		// Flipped: projected metres grow northwards, SVG y grows downwards.
		y: 50 - ((p.y - centre.y) / half) * 50,
	};
}

function isNear(p: MiniMapPoint): boolean {
	return p.x >= -KEEP_MARGIN && p.x <= 100 + KEEP_MARGIN
		&& p.y >= -KEEP_MARGIN && p.y <= 100 + KEEP_MARGIN;
}

/**
 * Path data for one line, split into subpaths wherever it leaves the window and
 * comes back — one `M` per run of visible points, so a line that exits the
 * corner and re-enters is not joined by a wrong straight line across the view.
 */
export function buildPathData(points: MiniMapPoint[], centre: MiniMapPoint, spanM: number): string {
	let d = '';
	let drawing = false;
	let previousNear = false;

	for (let i = 0; i < points.length; i++) {
		const p = project(points[i], centre, spanM);
		const near = isNear(p);
		// Keep the first point on each side of the boundary so the line reaches
		// the edge of the view instead of stopping short of it.
		const keep = near || previousNear;

		if (keep) {
			d += `${drawing ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`;
			drawing = true;
		} else {
			drawing = false;
		}

		previousNear = near;
	}

	return d;
}

/**
 * Build the whole view.
 *
 * `spanM` is the width of the window on the ground. The current line is always
 * last in `paths` so it paints over the others.
 */
export function buildMiniMapView(
	lines: MiniMapLineInput[],
	stations: MiniMapPoint[],
	centre: MiniMapPoint,
	spanM: number,
): MiniMapView {
	const span = spanM > 0 ? spanM : 1;
	const paths: MiniMapPath[] = [];

	const ordered = [...lines].sort((a, b) => Number(a.isCurrent) - Number(b.isCurrent));

	for (const line of ordered) {
		if (line.points.length < 2) continue;

		const d = buildPathData(line.points, centre, span);

		if (d) paths.push({d, color: line.color, current: line.isCurrent});
	}

	const visible: MiniMapPoint[] = [];

	for (const st of stations) {
		const p = project(st, centre, span);

		// Stations are dots, not lines — one outside the window is simply not
		// drawn, with a little slack so a dot on the edge is not clipped away.
		if (p.x >= -4 && p.x <= 104 && p.y >= -4 && p.y <= 104) visible.push(p);
	}

	return {paths, stations: visible, spanM: span};
}

/** The caption under the map: how much ground it covers, said plainly. */
export function describeSpan(spanM: number): string {
	if (spanM >= 1000) {
		const km = spanM / 1000;

		return `${km >= 10 ? Math.round(km) : Math.round(km * 10) / 10} km across`;
	}

	return `${Math.round(spanM)} m across`;
}
