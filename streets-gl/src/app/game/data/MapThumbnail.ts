/**
 * A map, small.
 *
 * The network-map overlay (🗺) draws a map's lines from its own geometry. A
 * list of maps wants the same picture at the size of a fingertip, so the part
 * of the overlay that turns lat/lng into a picture lives here, once: the
 * overlay uses `fitProjection`, and a list row uses `renderMapThumbnail`.
 *
 * A thumbnail is drawn from a `MapSketch` — the map's lines, simplified and
 * already projected into a 1000-unit box — rather than from the full map,
 * because the sketch is what gets cached: a whole MetroDreamin map runs to
 * hundreds of kilobytes, its sketch to a couple.
 *
 * Pure: strings in, strings out. No DOM, so it is testable and so the same
 * picture can be baked ahead of time for the Featured maps.
 */

import type {MetroMapData} from './RouteParser';

export interface LatLng {
	lat: number;
	lng: number;
}

/**
 * The projection the network map uses: equirectangular with a latitude
 * correction, fitted into `width × height` with `pad` on every side and the
 * map centred. Shared by the overlay and the sketch so the two pictures agree.
 */
export function fitProjection(
	points: readonly LatLng[],
	width: number,
	height: number,
	pad: number,
): (lat: number, lng: number) => [number, number] {
	const b = projectedBounds(points);
	const spanX = Math.max(1e-9, b.maxX - b.minX);
	const spanY = Math.max(1e-9, b.maxY - b.minY);
	const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
	const offX = (width - spanX * scale) / 2;
	const offY = (height - spanY * scale) / 2;

	return (lat: number, lng: number): [number, number] => {
		const [x, y] = b.proj(lat, lng);

		return [(x - b.minX) * scale + offX, (y - b.minY) * scale + offY];
	};
}

/** The projected extent of a set of points, before any fitting. */
function projectedBounds(points: readonly LatLng[]): {
	proj: (lat: number, lng: number) => [number, number];
	minX: number; maxX: number; minY: number; maxY: number;
} {
	let latSum = 0;

	for (const p of points) latSum += p.lat;

	const cosLat = Math.cos((latSum / Math.max(1, points.length)) * Math.PI / 180);
	const proj = (lat: number, lng: number): [number, number] => [lng * cosLat, -lat];
	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

	for (const p of points) {
		const [x, y] = proj(p.lat, p.lng);

		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}

	if (!Number.isFinite(minX)) minX = maxX = minY = maxY = 0;

	return {proj, minX, maxX, minY, maxY};
}

/** A map's picture, small enough to keep: lines in a 1000-unit box. */
export interface MapSketch {
	v: 1;
	/** The box the points live in; the longer side is SKETCH_SIZE. */
	w: number;
	h: number;
	/** Each line: its colour and its points as x,y,x,y… integers. */
	lines: {c: string; p: number[]}[];
	/** Every line on the map, including any too short to draw. */
	lineCount: number;
	/** Distinct real stations (not waypoints) the lines call at. */
	stationCount: number;
}

export const SKETCH_SIZE = 1000;
/** How far a simplified line may wander from the real one, sketch units. */
const SIMPLIFY_TOLERANCE = 3;
/** The most points a sketch keeps in all; past this it simplifies harder. */
const MAX_SKETCH_POINTS = 2400;
const FALLBACK_COLOUR = '#8899aa';

/**
 * A colour safe to put in an attribute.
 *
 * Line colours come from other people's maps and go into SVG markup, so
 * anything that is not a plain hex colour is replaced rather than escaped.
 */
export function safeColour(raw: unknown): string {
	if (typeof raw !== 'string') return FALLBACK_COLOUR;

	const c = raw.trim();

	return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(c) ? c : FALLBACK_COLOUR;
}

/** Ramer–Douglas–Peucker on a flat x,y list. */
function simplify(points: number[], tolerance: number): number[] {
	const n = points.length / 2;

	if (n <= 2) return points;

	const keep = new Uint8Array(n);

	keep[0] = 1;
	keep[n - 1] = 1;

	const stack: [number, number][] = [[0, n - 1]];

	while (stack.length > 0) {
		const [a, b] = stack.pop() as [number, number];
		const ax = points[a * 2], ay = points[a * 2 + 1];
		const bx = points[b * 2], by = points[b * 2 + 1];
		const dx = bx - ax, dy = by - ay;
		const len2 = dx * dx + dy * dy;
		let worst = -1;
		let worstD = tolerance;

		for (let i = a + 1; i < b; i++) {
			const px = points[i * 2], py = points[i * 2 + 1];
			let d: number;

			if (len2 === 0) {
				d = Math.hypot(px - ax, py - ay);
			} else {
				const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));

				d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
			}

			if (d > worstD) {
				worstD = d;
				worst = i;
			}
		}

		if (worst >= 0) {
			keep[worst] = 1;
			stack.push([a, worst], [worst, b]);
		}
	}

	const out: number[] = [];

	for (let i = 0; i < n; i++) {
		if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
	}

	return out;
}

/** Turn a whole map into its sketch. */
export function sketchMap(map: MetroMapData): MapSketch {
	const linePoints: {colour: string; pts: LatLng[]}[] = [];
	const stationIds = new Set<string>();

	for (const line of map.lines ?? []) {
		const pts: LatLng[] = [];

		for (const id of line.stationIds ?? []) {
			const st = map.stations?.[id];

			if (!st || !Number.isFinite(st.lat) || !Number.isFinite(st.lng)) continue;

			pts.push({lat: st.lat, lng: st.lng});
			if (!st.isWaypoint) stationIds.add(id);
		}

		linePoints.push({colour: safeColour(line.color), pts});
	}

	const all = linePoints.flatMap(l => l.pts);

	// Fit into a box whose longer side is SKETCH_SIZE, keeping the map's shape.
	const b = projectedBounds(all);
	const spanX = Math.max(1e-9, b.maxX - b.minX);
	const spanY = Math.max(1e-9, b.maxY - b.minY);
	const w = spanX >= spanY ? SKETCH_SIZE : Math.max(1, Math.round(SKETCH_SIZE * spanX / spanY));
	const h = spanX >= spanY ? Math.max(1, Math.round(SKETCH_SIZE * spanY / spanX)) : SKETCH_SIZE;

	const toBox = fitProjection(all, w, h, 0);
	const project = (tolerance: number): {c: string; p: number[]}[] => linePoints
		.filter(l => l.pts.length >= 2)
		.map(l => {
			const flat: number[] = [];

			for (const pt of l.pts) {
				const [x, y] = toBox(pt.lat, pt.lng);

				flat.push(Math.round(x), Math.round(y));
			}

			return {c: l.colour, p: simplify(flat, tolerance)};
		});

	let tolerance = SIMPLIFY_TOLERANCE;
	let lines = project(tolerance);

	// A hundred-line map must not become a hundred-kilobyte cache entry.
	while (lines.reduce((n, l) => n + l.p.length / 2, 0) > MAX_SKETCH_POINTS && tolerance < 200) {
		tolerance *= 2;
		lines = project(tolerance);
	}

	return {
		v: 1, w, h, lines,
		lineCount: (map.lines ?? []).length,
		stationCount: stationIds.size,
	};
}

/** Is this a sketch (and not some other thing that came out of storage)? */
export function isSketch(value: unknown): value is MapSketch {
	const s = value as MapSketch;

	return !!s && s.v === 1 && Number.isFinite(s.w) && Number.isFinite(s.h)
		&& Array.isArray(s.lines) && Number.isFinite(s.lineCount) && Number.isFinite(s.stationCount);
}

/** "26 lines, 86 stations" — the counts said plainly. */
export function describeCounts(lines: number, stations: number): string {
	return `${lines} line${lines === 1 ? '' : 's'} · ${stations} station${stations === 1 ? '' : 's'}`;
}

/**
 * The thumbnail itself: an `<svg>` string, `width × height`, the map's lines
 * on a dark tile.
 *
 * Accepts a whole map or its sketch. Line widths shrink as line counts grow,
 * so a 130-line map reads as a network rather than a solid block of colour.
 */
export function renderMapThumbnail(source: MetroMapData | MapSketch, width: number, height: number): string {
	const sketch = isSketch(source) ? source : sketchMap(source);
	const pad = Math.max(3, Math.round(Math.min(width, height) * 0.1));
	const scale = Math.min((width - 2 * pad) / Math.max(1, sketch.w), (height - 2 * pad) / Math.max(1, sketch.h));
	const offX = (width - sketch.w * scale) / 2;
	const offY = (height - sketch.h * scale) / 2;
	const drawn = sketch.lines.length;
	const stroke = Math.max(0.9, Math.min(width, height) / (drawn > 40 ? 44 : drawn > 12 ? 30 : 20));
	const polylines = sketch.lines.map(line => {
		const pts: string[] = [];

		for (let i = 0; i + 1 < line.p.length; i += 2) {
			pts.push(`${(line.p[i] * scale + offX).toFixed(1)},${(line.p[i + 1] * scale + offY).toFixed(1)}`);
		}

		return `<polyline points="${pts.join(' ')}" fill="none" stroke="${safeColour(line.c)}" `
			+ `stroke-width="${stroke.toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"/>`;
	});
	const label = describeCounts(sketch.lineCount, sketch.stationCount).replace(' · ', ', ');

	return `<svg xmlns="http://www.w3.org/2000/svg" class="map-thumb" viewBox="0 0 ${width} ${height}" `
		+ `width="${width}" height="${height}" role="img" aria-label="${label}" `
		+ `data-lines="${sketch.lineCount}" data-stations="${sketch.stationCount}">`
		+ `<rect width="${width}" height="${height}" rx="${Math.round(Math.min(width, height) * 0.16)}" fill="#0e1720"/>`
		+ polylines.join('')
		+ '</svg>';
}
