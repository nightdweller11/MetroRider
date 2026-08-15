import {
	buildMiniMapView, buildPathData, describeSpan, type MiniMapLineInput,
} from '../app/game/ui/MiniMap';

const centre = {x: 0, y: 0};

describe('buildPathData', () => {
	test('puts the centre of the window at the middle of the viewBox', () => {
		expect(buildPathData([{x: 0, y: 0}, {x: 0, y: 0}], centre, 1000)).toBe('M50 50L50 50');
	});

	test('north is up — a point north of the train draws ABOVE the middle', () => {
		// Projected metres grow northwards and SVG y grows downwards, so this is
		// the one place a sign error would silently mirror the whole map.
		const d = buildPathData([{x: 0, y: 250}, {x: 0, y: -250}], centre, 1000);

		expect(d).toBe('M50 25L50 75');
	});

	test('east is right', () => {
		expect(buildPathData([{x: 250, y: 0}], centre, 1000)).toBe('M75 50');
	});

	test('a line running clean through the window is not broken up', () => {
		// Both ends far outside, crossing the middle. Dropping points strictly
		// outside the viewBox would have left this line invisible.
		const d = buildPathData([{x: -5000, y: 0}, {x: 0, y: 0}, {x: 5000, y: 0}], centre, 1000);

		expect(d.startsWith('M')).toBe(true);
		expect(d.split('M').length - 1).toBe(1);
		expect(d).toContain('50 50');
	});

	test('a line that leaves and comes back starts a new subpath', () => {
		const far = 100000;
		const d = buildPathData(
			[{x: 0, y: 0}, {x: far, y: far}, {x: far, y: -far}, {x: 10, y: 10}],
			centre, 1000,
		);

		expect(d.split('M').length - 1).toBeGreaterThan(1);
	});

	test('a line nowhere near the window draws nothing', () => {
		expect(buildPathData([{x: 1e6, y: 1e6}, {x: 1.1e6, y: 1e6}], centre, 1000)).toBe('');
	});
});

describe('buildMiniMapView', () => {
	const line = (color: string, isCurrent: boolean): MiniMapLineInput => ({
		points: [{x: -400, y: 0}, {x: 400, y: 0}], color, isCurrent,
	});

	test('draws the line being driven LAST so it paints over the others', () => {
		const view = buildMiniMapView(
			[line('#f00', true), line('#0f0', false), line('#00f', false)],
			[], centre, 1000,
		);

		expect(view.paths).toHaveLength(3);
		expect(view.paths[view.paths.length - 1].current).toBe(true);
		expect(view.paths[view.paths.length - 1].color).toBe('#f00');
	});

	test('keeps only the stations inside the window', () => {
		const view = buildMiniMapView(
			[], [{x: 0, y: 0}, {x: 100, y: 100}, {x: 90000, y: 0}], centre, 1000,
		);

		expect(view.stations).toHaveLength(2);
		expect(view.stations[0]).toEqual({x: 50, y: 50});
	});

	test('a single-point line is not a line', () => {
		const view = buildMiniMapView([{points: [{x: 0, y: 0}], color: '#fff', isCurrent: false}], [], centre, 1000);

		expect(view.paths).toHaveLength(0);
	});

	test('survives a zero or negative span rather than dividing by it', () => {
		expect(() => buildMiniMapView([line('#f00', true)], [], centre, 0)).not.toThrow();
		expect(buildMiniMapView([line('#f00', true)], [], centre, 0).spanM).toBe(1);
	});

	test('recentring moves the world under the train, not the train', () => {
		const a = buildMiniMapView([line('#f00', true)], [{x: 0, y: 0}], {x: 0, y: 0}, 1000);
		const b = buildMiniMapView([line('#f00', true)], [{x: 0, y: 0}], {x: 250, y: 0}, 1000);

		expect(a.stations[0].x).toBe(50);
		expect(b.stations[0].x).toBe(25);
	});
});

describe('describeSpan', () => {
	test('says metres below a kilometre and kilometres above', () => {
		expect(describeSpan(800)).toBe('800 m across');
		expect(describeSpan(1500)).toBe('1.5 km across');
		expect(describeSpan(12000)).toBe('12 km across');
	});
});
