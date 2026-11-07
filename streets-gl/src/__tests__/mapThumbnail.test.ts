import {
	fitProjection, sketchMap, renderMapThumbnail, safeColour, isSketch, SKETCH_SIZE,
} from '~/app/game/data/MapThumbnail';
import {SAMPLE_MAP} from '~/app/game/data/StartMaps';
import {FEATURED_SKETCHES} from '~/app/game/data/FeaturedSketches';
import type {MetroMapData} from '~/app/game/data/RouteParser';

/**
 * Map thumbnails.
 *
 * What matters: the picture is of THIS map (its lines, its colours, its
 * shape), it stays small enough to cache, and nothing from someone else's map
 * can get into the markup as anything but a number or a hex colour.
 */

function count(svg: string, tag: string): number {
	return (svg.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length;
}

const TWO_LINES: MetroMapData = {
	name: 'Two lines',
	stations: {
		a: {name: 'A', lat: 32.0, lng: 34.0},
		w: {name: 'way', lat: 32.05, lng: 34.0, isWaypoint: true},
		b: {name: 'B', lat: 32.1, lng: 34.0},
		c: {name: 'C', lat: 32.1, lng: 34.2},
	},
	lines: [
		{id: '1', name: 'North', color: '#ff0000', stationIds: ['a', 'w', 'b']},
		{id: '2', name: 'East', color: '#00ff00', stationIds: ['b', 'c']},
	],
};

describe('fitProjection', () => {
	it('fits the points inside the padded box and centres them', () => {
		const pts = [{lat: 0, lng: 0}, {lat: 1, lng: 2}];
		const toSvg = fitProjection(pts, 1000, 700, 50);
		const [x0, y0] = toSvg(0, 0);
		const [x1, y1] = toSvg(1, 2);

		for (const v of [x0, x1]) expect(v).toBeGreaterThanOrEqual(49.9);
		for (const v of [x0, x1]) expect(v).toBeLessThanOrEqual(950.1);
		for (const v of [y0, y1]) expect(v).toBeGreaterThanOrEqual(49.9);
		for (const v of [y0, y1]) expect(v).toBeLessThanOrEqual(650.1);
		// North is up: the higher latitude has the smaller y.
		expect(y1).toBeLessThan(y0);
		// Wider than tall, so it spans the full padded width.
		expect(Math.abs(x1 - x0)).toBeCloseTo(900, 0);
	});

	it('does not fall over on a single point or none', () => {
		expect(fitProjection([{lat: 5, lng: 5}], 100, 100, 10)(5, 5).every(Number.isFinite)).toBe(true);
		expect(fitProjection([], 100, 100, 10)(0, 0).every(Number.isFinite)).toBe(true);
	});
});

describe('sketchMap', () => {
	it('keeps every line, its colour and the real counts', () => {
		const sketch = sketchMap(TWO_LINES);

		expect(sketch.lineCount).toBe(2);
		// a, b, c — the waypoint is not a station, and b is counted once.
		expect(sketch.stationCount).toBe(3);
		expect(sketch.lines.map(l => l.c)).toEqual(['#ff0000', '#00ff00']);
		expect(Math.max(sketch.w, sketch.h)).toBe(SKETCH_SIZE);
	});

	it('keeps the map\'s shape: a north–south line is taller than wide', () => {
		const tall = sketchMap({
			name: 't',
			stations: {a: {name: 'a', lat: 0, lng: 0}, b: {name: 'b', lat: 1, lng: 0.1}},
			lines: [{id: '1', name: '1', color: '#fff', stationIds: ['a', 'b']}],
		});

		expect(tall.h).toBe(SKETCH_SIZE);
		expect(tall.w).toBeLessThan(200);
	});

	it('simplifies a dense line without losing its ends', () => {
		const stations: MetroMapData['stations'] = {};
		const ids: string[] = [];

		for (let i = 0; i <= 200; i++) {
			stations[`s${i}`] = {name: `s${i}`, lat: i * 0.001, lng: 0.0000001 * (i % 2), isWaypoint: i % 10 !== 0};
			ids.push(`s${i}`);
		}

		const sketch = sketchMap({name: 'dense', stations, lines: [{id: '1', name: '1', color: '#123456', stationIds: ids}]});

		const p = sketch.lines[0].p;

		expect(p.length / 2).toBeLessThan(10);
		// South end at the bottom of the box, north end at the top.
		expect(p[1]).toBe(sketch.h);
		expect(p[p.length - 1]).toBe(0);
		expect(sketch.stationCount).toBe(21);
	});

	it('drops what cannot be drawn but still counts the line', () => {
		const sketch = sketchMap({
			name: 'stub',
			stations: {a: {name: 'a', lat: 0, lng: 0}},
			lines: [{id: '1', name: 'one stop', color: '#fff', stationIds: ['a', 'missing']}],
		});

		expect(sketch.lineCount).toBe(1);
		expect(sketch.lines).toHaveLength(0);
	});

	it('the built-in Tel Aviv map sketches as its three coloured lines', () => {
		const sketch = sketchMap(SAMPLE_MAP);

		expect(sketch.lineCount).toBe(3);
		expect(sketch.lines).toHaveLength(3);
		expect(isSketch(JSON.parse(JSON.stringify(sketch)))).toBe(true);
	});
});

describe('safeColour', () => {
	it('lets hex colours through and nothing else', () => {
		expect(safeColour('#e6194b')).toBe('#e6194b');
		expect(safeColour('#fff')).toBe('#fff');
		expect(safeColour('red')).toBe('#8899aa');
		expect(safeColour('#fff" onload="alert(1)')).toBe('#8899aa');
		expect(safeColour(undefined)).toBe('#8899aa');
	});
});

describe('renderMapThumbnail', () => {
	it('draws one polyline per line, and says the counts', () => {
		const svg = renderMapThumbnail(TWO_LINES, 96, 64);

		expect(svg.startsWith('<svg')).toBe(true);
		expect(count(svg, 'polyline')).toBe(2);
		expect(svg).toContain('data-lines="2"');
		expect(svg).toContain('data-stations="3"');
		expect(svg).toContain('aria-label="2 lines, 3 stations"');
		expect(svg).toContain('viewBox="0 0 96 64"');
	});

	it('gives the same picture from the map or from its sketch', () => {
		expect(renderMapThumbnail(sketchMap(TWO_LINES), 60, 40)).toBe(renderMapThumbnail(TWO_LINES, 60, 40));
	});

	it('keeps every point inside the thumbnail', () => {
		const svg = renderMapThumbnail(FEATURED_SKETCHES[Object.keys(FEATURED_SKETCHES)[0]], 60, 40);
		const numbers = [...svg.matchAll(/points="([^"]+)"/g)]
			.flatMap(m => m[1].split(/[ ,]/).map(Number));

		expect(numbers.length).toBeGreaterThan(20);
		for (let i = 0; i < numbers.length; i += 2) {
			expect(numbers[i]).toBeGreaterThanOrEqual(0);
			expect(numbers[i]).toBeLessThanOrEqual(60);
			expect(numbers[i + 1]).toBeGreaterThanOrEqual(0);
			expect(numbers[i + 1]).toBeLessThanOrEqual(40);
		}
	});

	it('puts no text from the map into the markup', () => {
		const hostile: MetroMapData = {
			name: '<script>alert(1)</script>',
			stations: {
				a: {name: '<img src=x onerror=alert(1)>', lat: 0, lng: 0},
				b: {name: 'b', lat: 1, lng: 1},
			},
			lines: [{id: '1', name: '<b>x</b>', color: 'url(javascript:alert(1))', stationIds: ['a', 'b']}],
		};
		const svg = renderMapThumbnail(hostile, 60, 40);

		expect(svg).not.toMatch(/script|onerror|javascript|<img|<b>/);
	});

	it('the baked Featured sketches are real and small', () => {
		const ids = Object.keys(FEATURED_SKETCHES);

		expect(ids.length).toBeGreaterThanOrEqual(5);
		for (const id of ids) {
			const sketch = FEATURED_SKETCHES[id];

			expect(isSketch(sketch)).toBe(true);
			expect(sketch.lines.length).toBeGreaterThan(0);
			expect(JSON.stringify(sketch).length).toBeLessThan(8000);
		}
	});
});
